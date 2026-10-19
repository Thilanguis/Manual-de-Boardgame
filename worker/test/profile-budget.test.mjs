import test from 'node:test';
import assert from 'node:assert/strict';
import { reserveProfileBudget } from '../src/profile-budget.js';
import { KnowledgeStore } from '../src/game-knowledge.js';

function setup() {
  const data = new Map();
  const storage = { get: async (k) => structuredClone(data.get(k)), put: async (k, v) => data.set(k, structuredClone(v)) };
  const record = { status: 'running', lease: 'active', expires: Date.now() + 60000 };
  return { storage, data, record };
}
test('reserva uma tentativa por análise, sem duplicar o orçamento das regras', async () => {
  const f = setup(),
    input = { key: 'draft', lease: 'active' };
  assert.equal((await reserveProfileBudget(f.storage, f.record, input)).allowed, true);
  assert.equal((await reserveProfileBudget(f.storage, f.record, input)).reason, 'already-attempted');
  assert.equal(f.data.get('job:draft').profileBudgetReserved, true);
  assert.equal(f.data.has('quota'), false);
});
test('lease antigo, trabalho encerrado ou expirado não reserva chamadas', async () => {
  const f = setup();
  for (const record of [
    { ...f.record, lease: 'old' },
    { ...f.record, status: 'ready' },
    { ...f.record, expires: 1 },
  ])
    assert.equal((await reserveProfileBudget(f.storage, record, { key: 'draft', lease: 'active' })).allowed, false);
  assert.equal(f.data.size, 0);
});
test('identificações de análises distintas ignoram contadores diários e por minuto legados', async () => {
  const f = setup();
  const quota = { day: new Date().toISOString().slice(0, 10), count: 999, recent: Array(8).fill(Date.now()) };
  f.data.set('quota-profile', quota);
  for (let i = 0; i < 12; i++) {
    assert.equal((await reserveProfileBudget(f.storage, { ...f.record }, { key: String(i), lease: 'active' })).allowed, true);
  }
  assert.deepEqual(f.data.get('quota-profile'), quota);
});
test('transação serializa duas reservas concorrentes para a mesma análise', async () => {
  const f = setup();
  let chain = Promise.resolve();
  f.storage.transaction = (fn) => {
    const next = chain.then(() => fn(f.storage));
    chain = next.catch(() => {});
    return next;
  };
  await f.storage.put('job:draft', f.record);
  const store = new KnowledgeStore({ storage: f.storage });
  const run = () => store.fetch(new Request('https://knowledge.internal/profile-budget', { method: 'POST', body: JSON.stringify({ key: 'draft', lease: 'active' }) })).then((r) => r.json());
  const results = await Promise.all([run(), run()]);
  assert.equal(results.filter((r) => r.allowed).length, 1);
  assert.equal(f.data.get('job:draft').profileBudgetReserved, true);
});
