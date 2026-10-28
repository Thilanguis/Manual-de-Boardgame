import test from 'node:test';
import assert from 'node:assert/strict';
import { diagnoseHealth, driveConfigured } from '../src/health-diagnostics.js';
import { DRIVE_FOLDER_ID } from '../../js/permissions.js';
const env = { OWNER_UID: 'health-owner', FIREBASE_PROJECT_ID: 'health-project', GOOGLE_CLIENT_ID: 'fixture-client', GOOGLE_CLIENT_SECRET: 'fixture-secret', GOOGLE_REFRESH_TOKEN: 'fixture-refresh', DRIVE_FOLDER_ID, DRIVE_OWNER_EMAIL: 'fixture@example.test', TICKET_KEY: 'fixture-ticket', GEMINI_API_KEY: 'fixture-gemini', ALLOW_MANUAL_AI: 'true' };
const identity = { uid: env.OWNER_UID, profile: { uid: env.OWNER_UID, role: 'superadmin', status: 'approved' } };
const folder = { id: DRIVE_FOLDER_ID, mimeType: 'application/vnd.google-apps.folder', owners: [{ me: true, emailAddress: env.DRIVE_OWNER_EMAIL }], appProperties: { acervoProject: env.FIREBASE_PROJECT_ID } };
test('configuração não comprova leitura e diagnóstico não chama Gemini nem escreve arquivos', async () => {
  assert(driveConfigured(env));
  const calls = [];
  const result = await diagnoseHealth(env, identity, async (url, init = {}) => {
    calls.push({ url, method: init.method || 'GET' });
    if (url === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'fake-access', expires_in: 3600 });
    assert(url.startsWith('https://www.googleapis.com/drive/v3/files/'));
    assert.equal(init.headers.Authorization, 'Bearer fake-access');
    return Response.json(folder);
  });
  assert.equal(result.drive.state, 'operational');
  assert.equal(result.drive.verified, true);
  assert.equal(result.firebase.check, 'authenticated-profile-read');
  assert.equal(result.gemini.state, 'configured');
  assert.equal(result.gemini.verified, false);
  assert(calls.some(c => c.url.includes('/drive/v3/files/')));
  assert(calls.every(c => c.method === 'GET' || c.url === 'https://oauth2.googleapis.com/token'));
  for (const secret of [env.GOOGLE_CLIENT_SECRET, env.GOOGLE_REFRESH_TOKEN, env.DRIVE_OWNER_EMAIL, env.GEMINI_API_KEY, env.DRIVE_FOLDER_ID, 'fake-access']) assert(!JSON.stringify(result).includes(secret));
});
for (const [name, code, state, status, body] of [
  ['revogado', 'drive/oauth-expired', 'oauth', 400, { error: 'invalid_grant', error_description: 'PRIVATE' }],
  ['cliente', 'drive/oauth-client', 'oauth', 400, { error: 'invalid_client' }],
  ['permissão OAuth', 'drive/permission', 'permission', 403, { error: 'access_denied' }],
  ['temporário', 'drive/unavailable', 'unavailable', 503, {}],
]) test('diagnóstico diferencia OAuth ' + name, async () => {
  let calls = 0;
  const data = await diagnoseHealth({ ...env, GOOGLE_REFRESH_TOKEN: name }, identity, async () => { calls++; return Response.json(body, { status }); });
  assert.equal(calls, 1);
  assert.equal(data.drive.configured, true);
  assert.equal(data.drive.verified, false);
  assert.equal(data.drive.code, code);
  assert.equal(data.drive.state, state);
  assert(!JSON.stringify(data).includes('PRIVATE'));
});
for (const [status, state, code] of [[404, 'missing', 'drive/file-missing'], [403, 'permission', 'drive/file-permission'], [429, 'limited', 'drive/rate-limit'], [503, 'unavailable', 'drive/unavailable']]) test('diagnóstico distingue resposta da pasta HTTP ' + status, async () => {
  const data = await diagnoseHealth({ ...env, GOOGLE_REFRESH_TOKEN: 'folder-' + status }, identity, async url => url.includes('oauth2') ? Response.json({ access_token: 'fake-access' }) : Response.json({}, { status }));
  assert.equal(data.drive.state, state);
  assert.equal(data.drive.code, code);
  assert.equal(data.drive.verified, false);
});
test('pasta com proprietário/projeto errado não é declarada operacional', async () => {
  const data = await diagnoseHealth({ ...env, GOOGLE_REFRESH_TOKEN: 'wrong-folder' }, identity, async url => url.includes('oauth2') ? Response.json({ access_token: 'fake-access' }) : Response.json({ ...folder, appProperties: {} }));
  assert.equal(data.drive.state, 'permission');
});
test('sem configuração e sem permissão administrativa não há consulta ao Google', async () => {
  const noFetch = () => assert.fail('nenhuma chamada externa');
  assert.equal((await diagnoseHealth({ ...env, GOOGLE_CLIENT_SECRET: '' }, identity, noFetch)).drive.state, 'configuration');
  const disabled = await diagnoseHealth({ ...env, GOOGLE_CLIENT_SECRET: '', ALLOW_MANUAL_AI: 'false' }, identity, noFetch);
  assert.equal(disabled.gemini.state, 'disabled');
  assert.equal(disabled.gemini.verified, false);
  for (const role of ['user', 'subadmin']) await assert.rejects(diagnoseHealth(env, { ...identity, profile: { ...identity.profile, role } }, noFetch), e => e.status === 403);
  await assert.rejects(diagnoseHealth(env, { ...identity, profile: { ...identity.profile, status: 'blocked' } }, noFetch), e => e.status === 403);
  await assert.rejects(diagnoseHealth(env, null, noFetch), e => e.status === 401);
});
