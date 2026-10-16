import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
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
});
test('localhost recusa qualquer configuração real antes de inicializar Firebase', () => {
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
