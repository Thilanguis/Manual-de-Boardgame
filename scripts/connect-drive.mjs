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
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const clientPath = option('--client-file'),
  ownerEmail = option('--owner-email')?.trim().toLowerCase(),
  project = 'manual-de-boardgame';
const checkConfig = args.includes('--check-config'),
  reconnect = args.includes('--reconnect'),
  initialize = args.includes('--initialize'),
  apply = args.includes('--apply'),
  rotateSecret = args.includes('--rotate-client-secret');
const productionConfirmed = args.includes('--production-confirmed'),
  expectedClientId = option('--expected-client-id'),
  expectedWorkerVersion = option('--expected-worker-version');
if (checkConfig && apply) throw new Error('--check-config não pode ser combinado com --apply.');
if (rotateSecret && !reconnect) throw new Error('--rotate-client-secret exige --reconnect e autorização específica para atualizar o segredo OAuth no Worker.');
if (!clientPath || clientPath.startsWith('--')) throw new Error('Informe --client-file com o caminho real do JSON privado do cliente OAuth Web existente.');
if (!checkConfig && (!ownerEmail?.includes('@') || ownerEmail.startsWith('--'))) throw new Error('Informe --owner-email com a conta Google proprietária da pasta existente.');
if (!checkConfig && reconnect === initialize) throw new Error('Escolha --reconnect para recuperar a conexão existente ou --initialize para a configuração inicial. Sem --apply, nenhuma alteração é salva.');
if (APP_CONFIG.firebase.projectId !== project) throw new Error('Projeto Firebase diferente do autorizado.');
let credentials;
try {
  credentials = JSON.parse(await readFile(resolve(clientPath), 'utf8'));
} catch {
  throw new Error('Não foi possível ler o JSON OAuth. Confira o caminho e baixe novamente o arquivo privado do cliente Web existente.');
}
const client = credentials.web;
if (!client?.client_id || !client.client_secret) throw new Error('Use um cliente OAuth do tipo Aplicativo da Web.');
if (client.project_id && client.project_id !== project) throw new Error('O JSON OAuth pertence a outro projeto. Baixe o cliente Web existente do projeto manual-de-boardgame.');
if (reconnect && !checkConfig) {
  if (!productionConfirmed) throw new Error('Confirme Em produção no Google Cloud antes de reconectar e informe --production-confirmed. Essa confirmação é do operador; o assistente não altera nem verifica o Console Google.');
  if (client.project_id !== project || !expectedClientId || expectedClientId !== client.client_id)
    throw new Error('Confira o ID completo do cliente Web existente no Google Cloud e informe --expected-client-id. O JSON deve pertencer ao projeto manual-de-boardgame. Nenhum cliente será substituído.');
  if (apply && !/^[a-f0-9-]{36}$/.test(expectedWorkerVersion || '')) throw new Error('Para aplicar a reconexão, informe --expected-worker-version com o ID da versão ativa previamente conferida.');
}
const redirect = 'http://localhost:4180/oauth/callback';
if (!client.redirect_uris?.includes(redirect)) throw new Error(`Cadastre ${redirect} como URI de redirecionamento no Google Cloud Console e baixe o JSON atualizado.`);
const workerConfig = resolve(root, args.includes('--worker-config') ? option('--worker-config') : 'worker/wrangler.jsonc');
if (args.includes('--folder-id') && option('--folder-id') !== DRIVE_FOLDER_ID) throw new Error('Use somente a pasta PDFs indicada pelo proprietário.');
const pickerKey = args.includes('--picker-key') ? option('--picker-key') : '';
if (pickerKey && !/^[A-Za-z0-9_-]{20,200}$/.test(pickerKey)) throw new Error('Chave pública Picker inválida.');
const wrangler = resolve(root, 'worker/node_modules/wrangler/bin/wrangler.js');
await access(wrangler);
await access(workerConfig);
if (checkConfig) {
  console.log('JSON OAuth Web legível; campos obrigatórios e callback local corretos. Nenhum valor privado foi exibido.');
  console.log(client.javascript_origins?.includes('http://localhost:4180') ? 'Origem local do Picker cadastrada.' : 'Se o Picker for necessário, cadastre http://localhost:4180 nas origens JavaScript do mesmo cliente.');
  console.log('Verificação local somente. Nenhuma autenticação, chamada Google, secret ou arquivo do Drive foi alterado. O modo Testing/Production deve ser conferido no Console.');
  process.exit(0);
}
async function checkWorkerVersion() {
  if (!reconnect || !apply) return;
  async function list(command) {
    return new Promise((resolveList, reject) => {
      const child = spawn(process.execPath, [wrangler, command, 'list', '--config', workerConfig, '--json'], {
        cwd: root,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, CLOUDFLARE_SEND_METRICS: 'false' },
      });
      let output = '';
      child.stdout.on('data', (chunk) => {
        output += chunk;
      });
      child.stderr.on('data', (chunk) => {
        output += chunk;
      });
      child.on('error', () => reject(new Error('Não foi possível conferir a versão do Worker. Nenhum secret foi atualizado.')));
      child.on('exit', (code) => {
        try {
          if (code !== 0) throw new Error();
          const clean = output.replace(/\x1b\[[0-9;]*m/g, ''),
            start = clean.search(/^\s*\[\s*\r?$/m);
          if (start < 0) throw new Error();
          const data = JSON.parse(clean.slice(start, clean.lastIndexOf(']') + 1));
          if (!Array.isArray(data) || !data.length) throw new Error();
          resolveList(data);
        } catch {
          reject(new Error('Não foi possível conferir a versão do Worker. Resposta bruta suprimida; nenhum secret foi atualizado.'));
        }
      });
    });
  }
  const deployments = (await list('deployments')).sort((a, b) => Date.parse(b.created_on) - Date.parse(a.created_on));
  const versions = (await list('versions')).sort((a, b) => Date.parse(b.metadata?.created_on || b.created_on) - Date.parse(a.metadata?.created_on || a.created_on));
  const active = deployments[0].versions;
  if (active?.length !== 1 || active[0].percentage !== 100 || active[0].version_id !== expectedWorkerVersion) throw new Error('A versão ativa do Worker diverge da versão autorizada. Reconexão interrompida antes de gravar secrets.');
  if (versions[0].id !== expectedWorkerVersion)
    throw new Error(
      'Há uma versão enviada mais recente que não está ativa. Interrompido antes de gravar secrets; não ativar versões antigas ou diagnósticos automaticamente. Prepare uma cópia idêntica da versão ativa mediante autorização específica.',
    );
}
await checkWorkerVersion();
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
    // Examinar apenas códigos conhecidos; nunca imprimir a resposta OAuth ou tokens.
    const details = await response.json().catch(() => ({}));
    const reasons = [details.error, ...(details.error?.errors || []).map((item) => item.reason), ...(details.error?.details || []).map((item) => item.reason)];
    let message = `O Google recusou a operação (${response.status}). Confira a API Drive, o cliente OAuth e a conta proprietária.`;
    if (reasons.some((reason) => ['SERVICE_DISABLED', 'accessNotConfigured'].includes(reason)))
      message = 'Google Drive API desativada no projeto manual-de-boardgame. Habilite drive.googleapis.com e reinicie a autorização; não é necessário ativar faturamento.';
    else if (reasons.includes('invalid_client')) message = 'O Google recusou o cliente OAuth. Confira o client secret atualizado no JSON privado.';
    else if (reasons.includes('invalid_grant')) message = 'O código OAuth expirou ou já foi usado. Reinicie o assistente e use o novo link.';
    const error = new Error(message);
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
function putOAuthPair(values) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [wrangler, 'secret', 'bulk', '--config', workerConfig], { cwd: root, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    child.stdout.resume();
    child.stderr.resume();
    child.on('error', () => reject(new Error('Não foi possível iniciar o Wrangler. Nenhum valor privado foi exibido.')));
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error('Não foi possível atualizar o par OAuth. Confira a autenticação Cloudflare; valores privados suprimidos.'))));
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify(values));
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
  if (reconnect && folder.appProperties?.acervoProject !== project) throw new Error('A pasta não apresenta a marca privada da conexão existente para este cliente OAuth. Confira se selecionou o mesmo cliente; nenhuma configuração foi alterada.');
  if (apply && initialize)
    await google(`https://www.googleapis.com/drive/v3/files/${DRIVE_FOLDER_ID}?fields=id,appProperties`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${driveSession.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ appProperties: { ...folder.appProperties, acervoProject: project } }),
    });
  const secrets = reconnect
    ? { GOOGLE_REFRESH_TOKEN: driveSession.refresh_token }
    : { GOOGLE_CLIENT_ID: client.client_id, GOOGLE_CLIENT_SECRET: client.client_secret, GOOGLE_REFRESH_TOKEN: driveSession.refresh_token, DRIVE_FOLDER_ID, DRIVE_OWNER_EMAIL: ownerEmail, TICKET_KEY: randomBytes(32).toString('base64url') };
  // Reconfere após o consentimento para não aplicar credenciais sobre outra publicação.
  await checkWorkerVersion();
  if (apply && rotateSecret) {
    await putOAuthPair({ GOOGLE_CLIENT_SECRET: client.client_secret, GOOGLE_REFRESH_TOKEN: driveSession.refresh_token });
    console.log('Par OAuth atualizado no Worker. Nenhuma chave Google foi desativada ou excluída pelo assistente.');
  }
  for (const [name, value] of Object.entries(apply && !rotateSecret ? secrets : {})) {
    await putSecret(name, value);
    console.log(`${name}: salvo no Worker.`);
  }
  finished = true;
  driveSession = null;
  console.log('Pasta existente, proprietário e permissões verificados. Nenhuma pasta foi criada.');
  console.log(
    !apply
      ? 'Validação concluída, sem salvar. O token obtido será descartado da memória. Nenhum secret ou arquivo foi alterado.'
      : rotateSecret
        ? 'Somente GOOGLE_CLIENT_SECRET e GOOGLE_REFRESH_TOKEN foram atualizados. Pasta, arquivos, permissões, cliente e TICKET_KEY preservados. Valide a leitura autenticada de capa e índice.'
        : reconnect
          ? 'Somente GOOGLE_REFRESH_TOKEN foi atualizado. Cliente OAuth, pasta, arquivos, permissões e TICKET_KEY preservados. Valide uma leitura autenticada de capa e índice no site.'
          : 'Configuração inicial salva. Valide o acesso autenticado pelo site.',
  );
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
    response.end(
      `<title>Conexão Acervo</title><h1>${apply ? 'Autorização salva' : 'Validação concluída'}</h1><p>${apply ? 'Valide a leitura autenticada de uma capa e de um índice no site.' : 'Nenhum secret ou arquivo foi alterado. O token obtido foi descartado da memória.'}</p>`,
    );
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
    if (typeof token.access_token !== 'string' || !token.access_token || typeof token.refresh_token !== 'string' || !token.refresh_token || scopes.length !== 1 || scopes[0] !== 'https://www.googleapis.com/auth/drive.file')
      throw new Error('A autorização precisa conter somente drive.file e acesso offline. Interrompido sem alterar secrets; confira a concessão sem revogá-la automaticamente.');
    if (reconnect && token.refresh_token_expires_in != null) {
      const lifetime = Number(token.refresh_token_expires_in);
      if (!Number.isFinite(lifetime) || lifetime <= 7 * 24 * 60 * 60)
        throw new Error('O Google informou prazo de sete dias ou menos para o refresh token. Reconexão interrompida sem gravar secrets; confira Em produção e eventuais acessos com prazo.');
      console.log(`O Google informou validade limitada de ${lifetime} segundos para o refresh token. Isso não representa autorização permanente.`);
    } else if (reconnect) {
      console.log('O Google não informou refresh_token_expires_in. Isso não prova duração ilimitada; a saída de Testing foi confirmada pelo operador.');
    }
    const about = await google('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)', { headers: { Authorization: `Bearer ${token.access_token}` } });
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
  console.log(
    !apply
      ? 'Modo de validação: não salva secrets nem altera arquivos.'
      : rotateSecret
        ? 'Modo rotação autorizado: atualiza somente o par GOOGLE_CLIENT_SECRET e GOOGLE_REFRESH_TOKEN.'
        : reconnect
          ? 'Modo reconexão autorizado: atualiza exclusivamente GOOGLE_REFRESH_TOKEN.'
          : 'Modo inicial autorizado: configura os secrets e a marca da pasta.',
  );
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
