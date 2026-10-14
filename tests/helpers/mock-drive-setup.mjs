// Preload exclusivo do teste: bloqueia rede externa e simula secrets sem publicar Worker.
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { DRIVE_FOLDER_ID } from '../../js/permissions.js';
if (process.env.ACERVO_SETUP_MOCK !== '1') throw new Error('Preload permitido apenas no teste isolado.');
let reads = 0;
globalThis.fetch = async (url, init = {}) => {
  url = String(url);
  if (url === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'fixture-temporary-access', refresh_token: 'fixture-private-refresh', scope: 'https://www.googleapis.com/auth/drive.file' });
  if (url.startsWith('https://www.googleapis.com/drive/v3/about?')) {
    if (process.env.ACERVO_SETUP_MOCK_FAILURE === 'drive-disabled') return Response.json({ error: { message: 'fixture-private-refresh fixture-private-client', details: [{ reason: 'SERVICE_DISABLED' }] } }, { status: 403 });
    return Response.json({ user: { emailAddress: 'owner@example.test' } });
  }
  if (url.startsWith(`https://www.googleapis.com/drive/v3/files/${DRIVE_FOLDER_ID}?`)) {
    if (init.method === 'PATCH') {
      const update = JSON.parse(init.body);
      if (update.appProperties.preserve !== 'existing') throw new Error('Propriedades existentes foram alteradas.');
      process.stdout.write('MOCK_FOLDER_PATCH\n');
      return Response.json({ id: DRIVE_FOLDER_ID });
    }
    if (reads++ === 0) return new Response(null, { status: 404 });
    return Response.json({
      id: DRIVE_FOLDER_ID,
      name: 'PDFs',
      mimeType: 'application/vnd.google-apps.folder',
      owners: [{ me: true, emailAddress: 'owner@example.test' }],
      permissions: [{ type: 'user', role: 'owner' }],
      capabilities: { canAddChildren: true },
      appProperties: { preserve: 'existing' },
    });
  }
  throw new Error('Rede externa ou criação de pasta bloqueada pelo teste.');
};
childProcess.spawn = (command, args) => {
  if (!args[0].endsWith('wrangler.js') || args[1] !== 'secret' || args[2] !== 'put') throw new Error('Processo inesperado no teste.');
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new Writable({
    write(chunk, encoding, callback) {
      callback();
    },
    final(callback) {
      callback();
      setImmediate(() => child.emit('exit', 0));
    },
  });
  return child;
};
syncBuiltinESMExports();
