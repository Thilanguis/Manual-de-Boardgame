import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { pathToFileURL } from 'node:url';
import { DRIVE_FOLDER_ID } from '../js/permissions.js';
async function setup(run) {
  const temporary = await mkdtemp(join(tmpdir(), 'acervo-drive-setup-')),
    clientFile = join(temporary, 'fixture-oauth.json');
  await writeFile(clientFile, JSON.stringify({ web: { client_id: '548436978015-fixture.apps.googleusercontent.com', client_secret: 'fixture-private-client', redirect_uris: ['http://localhost:4180/oauth/callback'] } }));
  const child = spawn(
    process.execPath,
    ['--import', pathToFileURL(resolve('tests/helpers/mock-drive-setup.mjs')).href, resolve('scripts/connect-drive.mjs'), '--client-file', clientFile, '--owner-email', 'owner@example.test', '--picker-key', 'AIzaFixturePublicPickerKey0000000000'],
    { env: { ...process.env, ACERVO_SETUP_MOCK: '1' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
  );
  let output = '';
  const exit = once(child, 'exit');
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Assistente local não iniciou.')), 10000);
    child.stdout.on('data', (chunk) => {
      output += chunk;
      const url = /https:\/\/accounts\.google\.com\/[^\s]+/.exec(output)?.[0];
      if (url) {
        clearTimeout(timer);
        resolve(new URL(url));
      }
    });
    child.on('error', reject);
    child.once('exit', (code) => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error('O assistente local encerrou antes de iniciar. Confira as dependências do Worker e o stderr do processo de teste.'));
    });
  });
  child.stderr.on('data', (chunk) => (output += chunk));
  try {
    const authorize = await ready;
    await run({ state: authorize.searchParams.get('state'), exit, output: () => output });
  } finally {
    child.kill();
    if (!resolve(temporary).startsWith(join(resolve(tmpdir()), 'acervo-drive-setup-'))) throw new Error('Pasta temporária de teste fora do destino esperado.');
    await rm(temporary, { recursive: true, force: true });
  }
}
const callback = (state) => fetch(`http://localhost:4180/oauth/callback?state=${encodeURIComponent(state)}&code=fixture-code`, { redirect: 'manual' });
const local = (state) => ({ 'Content-Type': 'application/json', Origin: 'http://localhost:4180', 'X-Setup-State': state });
test('assistente local valida CSRF, protege refresh/client secret e reutiliza apenas a pasta indicada', async () =>
  setup(async ({ state, exit, output }) => {
    assert.equal((await callback('ã')).status, 400);
    const authorized = await callback(state);
    assert.equal(authorized.status, 303);
    assert.equal(authorized.headers.get('Location'), '/picker');
    const html = await (await fetch('http://localhost:4180/picker')).text();
    assert.ok(!html.includes('fixture-private-refresh'));
    assert.ok(!html.includes('fixture-private-client'));
    for (const headers of [{ Origin: 'https://evil.example', 'X-Setup-State': state }, local('wrong-state')]) assert.equal((await fetch('http://localhost:4180/local-config', { method: 'POST', headers })).status, 404);
    const config = await (await fetch('http://localhost:4180/local-config', { method: 'POST', headers: local(state) })).json();
    assert.deepEqual(Object.keys(config).sort(), ['accessToken', 'apiKey', 'appId', 'folderId'].sort());
    assert.equal(config.folderId, DRIVE_FOLDER_ID);
    const connected = await fetch('http://localhost:4180/select-folder', { method: 'POST', headers: local(state), body: JSON.stringify({ folderId: DRIVE_FOLDER_ID }) });
    assert.equal(connected.status, 200);
    assert.equal((await exit)[0], 0);
    assert.ok(output().includes('MOCK_FOLDER_PATCH'));
    assert.ok(!output().includes('fixture-private-refresh'));
    assert.ok(!output().includes('fixture-private-client'));
  }));
test('seleção de outra pasta é rejeitada antes de alterar metadata ou publicar secrets', async () =>
  setup(async ({ state, exit, output }) => {
    await callback(state);
    const wrong = await fetch('http://localhost:4180/select-folder', { method: 'POST', headers: local(state), body: JSON.stringify({ folderId: 'other-personal-folder' }) });
    assert.equal(wrong.status, 500);
    assert.equal((await exit)[0], 1);
    assert.ok(!output().includes('MOCK_FOLDER_PATCH'));
    assert.ok(!output().includes('salvo no Worker'));
  }));
