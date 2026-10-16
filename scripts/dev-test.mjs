import './test-guard.mjs';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
const reset = await fetch('http://127.0.0.1:4181/reset', { method: 'POST' }).catch(() => null);
if (!reset?.ok) throw new Error(reset ? await reset.text() : 'Inicie npm run dev antes de executar os testes de integração.');
for (const file of ['development-browser', 'development-ocr-browser', 'limit-50-browser', 'development-failures-browser']) {
  console.log(`\nTeste isolado: ${file}`);
  const child = spawn(process.execPath, [`tests/${file}.mjs`], { stdio: 'inherit', env: process.env, windowsHide: true });
  const code = await new Promise((r) => child.once('exit', r));
  if (code !== 0) process.exit(code || 1);
}
const login = await (
  await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'proprietario@acervo.test', password: 'Acervo-teste-123', returnSecureToken: true }),
  })
).json();
const headers = { Authorization: `Bearer ${login.idToken}` },
  url = 'http://127.0.0.1:8787/v1/games/10000000-0000-4000-8000-000000000002/knowledge';
const before = await (await fetch(url, { headers })).json();
assert(before.knowledge);
const restart = await fetch('http://127.0.0.1:4181/restart-worker', { method: 'POST' });
assert(restart.ok);
const after = await (await fetch(url, { headers })).json();
assert.deepEqual(after.knowledge, before.knowledge);
const metrics = await (await fetch('http://127.0.0.1:8788/metrics')).json();
assert.equal(metrics.geminiCalls, 0);
console.log('SQLite e arquivos recuperados após reiniciar o Worker; zero novas gerações.');
