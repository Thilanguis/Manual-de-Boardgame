// Autorização única do proprietário. Tokens ficam em memória e entram no Wrangler por stdin.
import { createServer } from 'node:http';
import { readFile, access } from 'node:fs/promises';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_CONFIG } from '../config/app-config.js';
import { DRIVE_FOLDER_ID } from '../js/permissions.js';

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
if (args.includes('--folder-id') && option('--folder-id') !== DRIVE_FOLDER_ID) throw new Error('Use somente a pasta PDFs indicada pelo proprietário.');
const pickerKey = args.includes('--picker-key') ? option('--picker-key') : '';
if (pickerKey && !/^[A-Za-z0-9_-]{20,200}$/.test(pickerKey)) throw new Error('Chave pública Picker inválida.');
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
  if (!response.ok) {
    const error = new Error(`O Google recusou a operação (${response.status}). Confira a API Drive, o cliente OAuth e a conta proprietária.`);
    error.status = response.status;
    throw error;
  }
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
  finished = false,
  driveSession = null;
const localHeaders = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'strict-origin-when-cross-origin', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY' };
async function folderMetadata() {
  return google(`https://www.googleapis.com/drive/v3/files/${DRIVE_FOLDER_ID}?fields=id,name,mimeType,appProperties,owners(emailAddress,me),trashed,capabilities(canAddChildren),permissions(type,role)`, {
    headers: { Authorization: `Bearer ${driveSession.access_token}` },
  });
}
async function connectFolder() {
  const folder = await folderMetadata();
  if (
    folder.id !== DRIVE_FOLDER_ID ||
    folder.trashed ||
    folder.mimeType !== 'application/vnd.google-apps.folder' ||
    !folder.owners?.some((owner) => owner.me === true && owner.emailAddress?.toLowerCase() === ownerEmail) ||
    folder.capabilities?.canAddChildren !== true
  )
    throw new Error('A pasta PDFs não pertence à conta esperada ou não permite adicionar arquivos.');
  if (folder.permissions?.some((permission) => ['anyone', 'domain'].includes(permission.type)))
    throw new Error('A pasta tem compartilhamento público. Remova esse compartilhamento no Drive antes de conectar. O assistente não altera permissões de compartilhamento.');
  await google(`https://www.googleapis.com/drive/v3/files/${DRIVE_FOLDER_ID}?fields=id,appProperties`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${driveSession.access_token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ appProperties: { ...folder.appProperties, acervoProject: project } }),
  });
  const secrets = { GOOGLE_CLIENT_ID: client.client_id, GOOGLE_CLIENT_SECRET: client.client_secret, GOOGLE_REFRESH_TOKEN: driveSession.refresh_token, DRIVE_FOLDER_ID, DRIVE_OWNER_EMAIL: ownerEmail, TICKET_KEY: randomBytes(32).toString('base64url') };
  for (const [name, value] of Object.entries(secrets)) {
    await putSecret(name, value);
    console.log(`${name}: salvo no Worker.`);
  }
  finished = true;
  driveSession = null;
  console.log(`Pasta existente verificada e autorizada: https://drive.google.com/drive/folders/${DRIVE_FOLDER_ID}`);
  console.log('Publique o Worker, configure apiBase e valide um envio real pelo site. Nenhuma pasta foi criada.');
  setTimeout(() => server.close(), 2500);
}
function fail(response, error) {
  response.writeHead(500, { ...localHeaders, 'Content-Type': 'text/plain; charset=utf-8' });
  response.end('A conexão não foi concluída. Confira o terminal.');
  console.error(error.message);
  process.exitCode = 1;
  driveSession = null;
  server.close();
}
const server = createServer(async (request, response) => {
  const url = new URL(request.url, redirect);
  if (!['localhost:4180', '127.0.0.1:4180'].includes(request.headers.host)) {
    response.writeHead(403);
    response.end();
    return;
  }
  if (url.pathname === '/complete') {
    response.writeHead(200, { ...localHeaders, 'Content-Type': 'text/html; charset=utf-8' });
    response.end('<title>Acervo conectado</title><h1>Pasta PDFs conectada</h1><p>A configuração foi salva. Valide agora um upload real pelo site.</p>');
    return;
  }
  if (url.pathname === '/picker' && request.method === 'GET' && driveSession && pickerKey) {
    const template = await readFile(resolve(root, 'scripts/drive-picker.html'), 'utf8');
    response.writeHead(200, {
      ...localHeaders,
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': `default-src 'none'; script-src 'self' https://apis.google.com https://www.gstatic.com 'nonce-${state}'; connect-src 'self' https://*.googleapis.com https://*.google.com; frame-src https://*.google.com; style-src 'unsafe-inline'; img-src https: data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
    });
    response.end(template.replace('SETUP_NONCE', state).replace('SETUP_STATE', state));
    return;
  }
  if (url.pathname === '/picker.js' && request.method === 'GET') {
    response.writeHead(200, { ...localHeaders, 'Content-Type': 'text/javascript; charset=utf-8' });
    response.end(await readFile(resolve(root, 'scripts/drive-picker.js')));
    return;
  }
  const sameOrigin = request.headers.origin === 'http://localhost:4180';
  const receivedState = request.headers['x-setup-state'];
  if (url.pathname === '/local-config' && request.method === 'POST' && sameOrigin && receivedState === state && driveSession && pickerKey) {
    response.writeHead(200, { ...localHeaders, 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ accessToken: driveSession.access_token, apiKey: pickerKey, appId: /^\d+/.exec(client.client_id)?.[0], folderId: DRIVE_FOLDER_ID }));
    return;
  }
  if (url.pathname === '/select-folder' && request.method === 'POST' && sameOrigin && receivedState === state && driveSession) {
    try {
      let text = '';
      for await (const chunk of request) {
        text += chunk.toString();
        if (text.length > 2048) throw new Error('Dados da seleção inválidos.');
      }
      if (JSON.parse(text).folderId !== DRIVE_FOLDER_ID) throw new Error('Selecione exclusivamente a pasta PDFs indicada.');
      await connectFolder();
      response.writeHead(200, { ...localHeaders, 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ ok: true }));
    } catch (error) {
      fail(response, error);
    }
    return;
  }
  if (request.method !== 'GET' || url.pathname !== '/oauth/callback') {
    response.writeHead(404);
    response.end();
    return;
  }
  const received = url.searchParams.get('state') || '',
    bytes = Buffer.from(received),
    expected = Buffer.from(state);
  if (used || !/^[A-Za-z0-9_-]+$/.test(received) || bytes.length !== expected.length || !timingSafeEqual(bytes, expected) || !url.searchParams.get('code')) {
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
    const scopes = String(token.scope || '').split(' ');
    if (!token.refresh_token || !scopes.includes('https://www.googleapis.com/auth/drive.file') || scopes.some((scope) => scope.startsWith('https://www.googleapis.com/auth/drive') && scope !== 'https://www.googleapis.com/auth/drive.file'))
      throw new Error('A autorização precisa conter somente drive.file para o Drive e acesso offline. Revogue permissões antigas deste cliente e reconecte.');
    const about = await google('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress),storageQuota', { headers: { Authorization: `Bearer ${token.access_token}` } });
    if (about.user?.emailAddress?.toLowerCase() !== ownerEmail) throw new Error('A conta autorizada não é a conta proprietária informada.');
    driveSession = token;
    let needsPicker = false;
    try {
      await folderMetadata();
    } catch (error) {
      if ([403, 404].includes(error.status)) needsPicker = true;
      else throw error;
    }
    if (needsPicker) {
      if (!pickerKey)
        throw new Error('drive.file ainda não acessa a pasta existente. Habilite Google Picker API, prepare a chave pública restrita a localhost e reinicie com --picker-key. Não será criada outra pasta nem solicitado acesso amplo ao Drive.');
      response.writeHead(303, { ...localHeaders, Location: '/picker' });
      response.end();
    } else {
      await connectFolder();
      response.writeHead(303, { ...localHeaders, Location: '/complete' });
      response.end();
    }
  } catch (error) {
    fail(response, error);
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
