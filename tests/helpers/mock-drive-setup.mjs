// Preload exclusivo do teste: bloqueia rede externa e simula secrets sem publicar Worker.
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { DRIVE_FOLDER_ID } from '../../js/permissions.js';
if (process.env.ACERVO_SETUP_MOCK !== '1') throw new Error('Preload permitido apenas no teste isolado.');
let reads = 0;
const failure = process.env.ACERVO_SETUP_MOCK_FAILURE;
globalThis.fetch = async (url, init = {}) => {
  url = String(url);
  if (url === 'https://oauth2.googleapis.com/token')
    return Response.json({
      access_token: 'fixture-temporary-access',
      expires_in: 3600,
      refresh_token: 'fixture-private-refresh',
      scope: 'https://www.googleapis.com/auth/drive.file' + (failure === 'extra-scope' ? ' https://www.googleapis.com/auth/drive.readonly' : ''),
      ...(failure === 'seven-day' ? { refresh_token_expires_in: 604800 } : {}),
    });
  if (url.startsWith('https://www.googleapis.com/drive/v3/about?')) {
    if (process.env.ACERVO_SETUP_MOCK_FAILURE === 'drive-disabled') return Response.json({ error: { message: 'fixture-private-refresh fixture-private-client', details: [{ reason: 'SERVICE_DISABLED' }] } }, { status: 403 });
    return Response.json({ user: { emailAddress: failure === 'wrong-owner' ? 'other@example.test' : 'owner@example.test' } });
  }
  if (url.startsWith(`https://www.googleapis.com/drive/v3/files/${DRIVE_FOLDER_ID}?`)) {
    if (init.method === 'PATCH') {
      const update = JSON.parse(init.body);
      if (update.appProperties.preserve !== 'existing') throw new Error('Propriedades existentes foram alteradas.');
      process.stdout.write('MOCK_FOLDER_PATCH\n');
      return Response.json({ id: DRIVE_FOLDER_ID });
    }
    if (reads++ === 0 && process.env.ACERVO_SETUP_MOCK_FAILURE !== 'reconnect') return new Response(null, { status: 404 });
    return Response.json({
      id: DRIVE_FOLDER_ID,
      name: 'PDFs',
      mimeType: 'application/vnd.google-apps.folder',
      owners: [{ me: true, emailAddress: 'owner@example.test' }],
      permissions: [{ type: 'user', role: 'owner' }],
      capabilities: { canAddChildren: true },
      appProperties: { preserve: 'existing', ...(process.env.ACERVO_SETUP_MOCK_FAILURE === 'reconnect' ? { acervoProject: 'manual-de-boardgame' } : {}) },
    });
  }
  throw new Error('Rede externa ou criação de pasta bloqueada pelo teste.');
};
childProcess.spawn = (command, args) => {
  if (args[0].endsWith('wrangler.js') && ['deployments', 'versions'].includes(args[1]) && args[2] === 'list') {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    const version = '11111111-1111-4111-8111-111111111111',
      other = '22222222-2222-4222-8222-222222222222';
    const data =
      args[1] === 'deployments'
        ? [{ created_on: '2026-10-22T00:00:00Z', versions: [{ version_id: failure === 'deployment-changed' ? other : version, percentage: 100 }] }]
        : [{ id: failure === 'latest-inactive' ? other : version, metadata: { created_on: '2026-10-22T00:00:00Z' } }];
    setImmediate(() => {
      child.stdout.end(JSON.stringify(data, null, 2));
      child.emit('exit', 0);
    });
    return child;
  }
  if (!args[0].endsWith('wrangler.js') || args[1] !== 'secret' || !['put', 'bulk'].includes(args[2])) throw new Error('Processo inesperado no teste.');
  if (args[2] === 'put') process.stdout.write(`MOCK_SECRET ${args[3]}\n`);
  let input = '';
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new Writable({
    write(chunk, encoding, callback) {
      input += chunk;
      callback();
    },
    final(callback) {
      if (args[2] === 'bulk') {
        const names = Object.keys(JSON.parse(input)).sort();
        if (JSON.stringify(names) !== JSON.stringify(['GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN'])) throw new Error('Bulk não pode alterar outros secrets.');
        process.stdout.write(`MOCK_BULK ${names.join(',')}\n`);
      }
      callback();
      setImmediate(() => child.emit('exit', 0));
    },
  });
  return child;
};
syncBuiltinESMExports();
