// Autorização única do proprietário. Tokens ficam em memória e entram no Wrangler por stdin.
import { createServer } from 'node:http';
import { readFile, access } from 'node:fs/promises';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_CONFIG } from '../config/app-config.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'),
  args = process.argv.slice(2);
const option = (name) => args[args.indexOf(name) + 1];
const clientPath = option('--client-file'),
  ownerEmail = option('--owner-email')?.trim().toLowerCase(),
  project = 'manual-de-boardgame';
if (!args.includes('--client-file') || !clientPath || !args.includes('--owner-email') || !ownerEmail?.includes('@'))
  throw new Error('Use node scripts/connect-drive.mjs --client-file CAMINHO_JSON_PRIVADO --owner-email SUA_CONTA_GOOGLE --worker-config worker/wrangler.jsonc');
if (APP_CONFIG.firebase.projectId !== project) throw new Error('Projeto Firebase diferente do autorizado.');
const credentials = JSON.parse(await readFile(resolve(clientPath), 'utf8')),
  client = credentials.web;
if (!client?.client_id || !client.client_secret) throw new Error('Use um cliente OAuth do tipo Aplicativo da Web.');
const redirect = 'http://localhost:4180/oauth/callback';
if (!client.redirect_uris?.includes(redirect)) throw new Error(`Cadastre ${redirect} como URI de redirecionamento no Google Cloud Console e baixe o JSON atualizado.`);
const workerConfig = resolve(root, args.includes('--worker-config') ? option('--worker-config') : 'worker/wrangler.jsonc');
const wrangler = resolve(root, 'worker/node_modules/wrangler/bin/wrangler.js');
await access(wrangler);
await access(workerConfig);
const state = randomBytes(32).toString('base64url'),
  verifier = randomBytes(48).toString('base64url'),
  challenge = createHash('sha256').update(verifier).digest('base64url');
const authorize = new URL('https://accounts.google.com/o/oauth2/v2/auth');
for (const [key, value] of Object.entries({
  client_id: client.client_id,
  redirect_uri: redirect,
  response_type: 'code',
  scope: 'https://www.googleapis.com/auth/drive.file',
  access_type: 'offline',
  prompt: 'consent',
  state,
  login_hint: ownerEmail,
  code_challenge: challenge,
  code_challenge_method: 'S256',
}))
  authorize.searchParams.set(key, value);
async function google(url, options = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`O Google recusou a operação (${response.status}). Confira a API Drive, o cliente OAuth e a conta proprietária.`);
  return response.json();
}
function putSecret(name, value) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [wrangler, 'secret', 'put', name, '--config', workerConfig], { cwd: root, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    // Não encaminhar saída: nenhuma resposta contendo um token deve ser impressa.
    child.stdout.resume();
    child.stderr.resume();
    child.on('error', () => reject(new Error(`Não foi possível iniciar a gravação de ${name}.`)));
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`Não foi possível salvar ${name}. Publique o Worker inicial e confirme o login do Wrangler. Tokens não foram gravados em arquivos locais.`))));
    child.stdin.on('error', () => {});
    child.stdin.end(value + '\n');
  });
}
let used = false,
  finished = false;
const server = createServer(async (request, response) => {
  const url = new URL(request.url, redirect);
  if (url.pathname === '/complete') {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end('<title>Acervo conectado</title><h1>Drive conectado ao Acervo</h1><p>Você pode fechar esta janela e voltar ao terminal.</p>');
    return;
  }
  if (request.method !== 'GET' || url.pathname !== '/oauth/callback') {
    response.writeHead(404);
    response.end();
    return;
  }
  const received = url.searchParams.get('state') || '';
  const receivedBytes = Buffer.from(received),
    stateBytes = Buffer.from(state);
  if (used || !/^[A-Za-z0-9_-]+$/.test(received) || receivedBytes.length !== stateBytes.length || !timingSafeEqual(receivedBytes, stateBytes) || !url.searchParams.get('code')) {
    response.writeHead(400);
    response.end('Autorização inválida. Reinicie a configuração.');
    return;
  }
  used = true;
  try {
    const token = await google('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: client.client_id, client_secret: client.client_secret, code: url.searchParams.get('code'), code_verifier: verifier, redirect_uri: redirect, grant_type: 'authorization_code' }),
    });
    if (
      !token.refresh_token ||
      !String(token.scope || '')
        .split(' ')
        .includes('https://www.googleapis.com/auth/drive.file')
    )
      throw new Error('A autorização não incluiu acesso offline ao escopo drive.file. Revogue a autorização anterior deste aplicativo e tente novamente.');
    const headers = { Authorization: `Bearer ${token.access_token}` };
    const about = await google('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress,displayName),storageQuota', { headers });
    if (about.user?.emailAddress?.toLowerCase() !== ownerEmail) throw new Error('A conta autorizada não é a conta proprietária informada. Nenhuma pasta foi criada.');
    let folder;
    if (args.includes('--folder-id')) folder = await google(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(option('--folder-id'))}?fields=id,name,mimeType,appProperties,owners(emailAddress,me)`, { headers });
    else {
      const query = `mimeType='application/vnd.google-apps.folder' and trashed=false and appProperties has { key='acervoProject' and value='${project}' }`;
      const found = await google(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name,mimeType,appProperties,owners(emailAddress,me))&pageSize=20`, { headers });
      if (found.files?.length > 1) throw new Error('Há mais de uma pasta deste aplicativo. Execute novamente com --folder-id e o ID da pasta que deseja usar.');
      folder = found.files?.[0];
      if (!folder)
        folder = await google('https://www.googleapis.com/drive/v3/files?fields=id,name,mimeType,appProperties,owners(emailAddress,me)', {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'Acervo — Manual de Boardgames', mimeType: 'application/vnd.google-apps.folder', appProperties: { acervoProject: project } }),
        });
    }
    if (folder.mimeType !== 'application/vnd.google-apps.folder' || folder.appProperties?.acervoProject !== project || !folder.owners?.some((owner) => owner.me === true && owner.emailAddress?.toLowerCase() === ownerEmail))
      throw new Error('A pasta não foi criada por este aplicativo ou não pertence à conta esperada.');
    const secrets = {
      GOOGLE_CLIENT_ID: client.client_id,
      GOOGLE_CLIENT_SECRET: client.client_secret,
      GOOGLE_REFRESH_TOKEN: token.refresh_token,
      DRIVE_FOLDER_ID: folder.id,
      DRIVE_OWNER_EMAIL: ownerEmail,
      TICKET_KEY: randomBytes(32).toString('base64url'),
    };
    for (const [name, value] of Object.entries(secrets)) {
      await putSecret(name, value);
      console.log(`${name}: salvo no Worker.`);
    }
    finished = true;
    response.writeHead(303, { Location: '/complete', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
    response.end();
    console.log(`Drive autorizado: ${ownerEmail}. Pasta verificada: https://drive.google.com/drive/folders/${folder.id}`);
    console.log('Nenhum refresh token ou client secret foi impresso ou gravado no projeto. Publique o Worker e configure apiBase no frontend.');
    setTimeout(() => server.close(), 2500);
  } catch (error) {
    response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end('A conexão não foi concluída. Confira o terminal.');
    console.error(error.message);
    process.exitCode = 1;
    server.close();
  }
});
server.on('error', (error) => {
  console.error(error.code === 'EADDRINUSE' ? 'A porta 4180 está em uso. Feche a outra configuração e tente novamente.' : 'Não foi possível iniciar a configuração local.');
  process.exitCode = 1;
});
server.listen(4180, '127.0.0.1', () => {
  console.log('Abra este link e autorize somente a conta que possui o Google One:');
  console.log(authorize.href);
});
const timeout = setTimeout(
  () => {
    if (!finished) {
      console.error('Autorização não concluída em 10 minutos. Execute o script novamente.');
      process.exitCode = 1;
      server.close();
    }
  },
  10 * 60 * 1000,
);
timeout.unref();
