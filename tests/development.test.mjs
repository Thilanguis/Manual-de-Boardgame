import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { APP_CONFIG } from '../config/app-config.js';
import { assertIsolatedConfiguration, DEV_CONFIG } from '../js/development.js';
import { instrumentFirestore } from '../js/development-metrics.js';
test('comando de teste recusa projeto real antes de executar a suíte', () => {
  const result = spawnSync(process.execPath, ['scripts/test-guard.mjs'], { encoding: 'utf8', env: { ...process.env, GCLOUD_PROJECT: 'manual-de-boardgame' } });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /GCLOUD_PROJECT.*demo-acervo/);
});
test('preload dos testes bloqueia fetch remoto antes de abrir uma conexão', () => {
  const result = spawnSync(process.execPath, ['--import', './scripts/test-guard.mjs', '--input-type=module', '-e', "await fetch('https://example.com/forbidden-test')"], { encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Teste bloqueado: requisição externa/);
  const legacy = spawnSync(process.execPath, ['tests/cloud-check.mjs'], { encoding: 'utf8' });
  assert.notEqual(legacy.status, 0);
  assert.match(legacy.stderr, /Verificação automática de produção desativada/);
});

test('ambiente fictício recusa configurações mistas antes de inicializar Firebase', () => {
  for (const hostname of ['localhost', '127.0.0.1', '::1']) {
    assert.doesNotThrow(() => assertIsolatedConfiguration(DEV_CONFIG, hostname));
    for (const config of [
      { ...DEV_CONFIG, firebase: { projectId: 'manual-de-boardgame' } },
      { ...DEV_CONFIG, emulators: null },
      { ...DEV_CONFIG, fileStorage: { apiBase: 'https://acervo.example.test' } },
      { ...DEV_CONFIG, emulators: { ...DEV_CONFIG.emulators, auth: 'https://accounts.google.com' } },
    ])
      assert.throws(() => assertIsolatedConfiguration(config, hostname), /bloqueada/);
  }
  assert.throws(() => assertIsolatedConfiguration(DEV_CONFIG, 'thilanguis.github.io'));
});

test('uso manual aceita serviços reais no localhost; modo de teste continua recusando configuração real', () => {
  assert.equal(APP_CONFIG.firebase.projectId, 'manual-de-boardgame');
  assert.equal(APP_CONFIG.emulators, undefined);
  for (const host of ['localhost', '127.0.0.1', '[::1]', '[fd12::1]', '127.1.2.3', '192.168.1.12', '10.0.0.2', '172.20.0.1', 'acervo.local']) assert.doesNotThrow(() => assertIsolatedConfiguration(APP_CONFIG, host));
  assert.throws(() => assertIsolatedConfiguration({ ...APP_CONFIG, development: true }, '127.0.0.1'), /bloqueada/);
  const previous = globalThis.document;
  try {
    globalThis.document = { querySelector: () => ({ content: 'isolated' }) };
    assert.throws(() => assertIsolatedConfiguration(APP_CONFIG, '127.0.0.1'), /bloqueada/);
    assert.doesNotThrow(() => assertIsolatedConfiguration(DEV_CONFIG, '127.0.0.1'));
  } finally {
    if (previous === undefined) delete globalThis.document;
    else globalThis.document = previous;
  }
});

test('servidor de testes seleciona emuladores e servidor habitual mantém serviços reais sem recarga automática', async () => {
  for (const isolated of [true, false]) {
    const child = spawn(process.execPath, ['scripts/serve.mjs'], {
      env: { ...process.env, PORT: '0', ACERVO_DEVELOPMENT: isolated ? '1' : '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    try {
      // Somente arquivos estáticos locais: nenhum SDK ou serviço Firebase é executado.
      const listening = await Promise.race([
        once(child.stdout, 'data').then(([data]) => data.toString()),
        once(child, 'exit').then(() => {
          throw new Error('Servidor encerrou antes de iniciar.');
        }),
      ]);
      const address = listening.match(/http:\/\/localhost:(\d+)/)[1];
      const response = await fetch(`http://127.0.0.1:${address}/config/app-config.js`);
      const text = await response.text();
      assert.equal(response.status, 200);
      assert.ok(text.includes(isolated ? 'export const APP_CONFIG = DEV_CONFIG;' : 'export const APP_CONFIG = HOSTED_CONFIG;'));
      assert.equal(Boolean(response.headers.get('content-security-policy')), isolated);
      const html = await (await fetch(`http://127.0.0.1:${address}/`)).text();
      assert.equal(html.includes('name="acervo-environment" content="isolated"'), isolated);
      assert.equal(html.includes('window.location.reload()'), false);
    } finally {
      const exited = once(child, 'exit');
      child.kill();
      await exited;
    }
  }
});

test('instrumentação mede listeners e encerra contagem tanto em erro quanto em unsubscribe', () => {
  delete globalThis.__ACERVO_METRICS__;
  let failure;
  const wrapped = instrumentFirestore(
    {
      onSnapshot: (ref, next, error) => {
        failure = error;
        next({ metadata: { fromCache: false }, docChanges: () => [1, 2] });
        return () => {};
      },
    },
    true,
  );
  const stop = wrapped.onSnapshot(
      { path: 'games' },
      () => {},
      () => {},
    ),
    metrics = globalThis.__ACERVO_METRICS__;
  assert.equal(metrics.activeListeners, 1);
  assert.equal(metrics.reads, 2);
  failure({ code: 'permission-denied' });
  stop();
  assert.equal(metrics.activeListeners, 0);
  assert.equal(metrics.errors['permission-denied'], 1);
  delete globalThis.__ACERVO_METRICS__;
});
