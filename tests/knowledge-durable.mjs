// SQLite real no runtime local do Worker. Não cria recursos Cloudflare.
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { Miniflare, convertV4MiniflareOptions } from '../worker/node_modules/miniflare/dist/src/index.js';
const settings = convertV4MiniflareOptions({
  modules: true,
  scriptPath: resolve('worker/.build/index.js'),
  compatibilityDate: '2026-10-14',
  durableObjects: { GAME_KNOWLEDGE: { className: 'KnowledgeStore', useSQLite: true } },
  resourcePersistencePath: resolve('test-output/knowledge-durable'),
  telemetry: { enabled: false },
});
let runtime = new Miniflare(settings);
const id = crypto.randomUUID();
const stub = async () => {
  const ns = await runtime.getDurableObjectNamespace('GAME_KNOWLEDGE');
  return ns.get(ns.idFromName(id));
};
const operation = async (path, input) => (await stub()).fetch(`https://internal${path}`, input ? { method: 'POST', body: JSON.stringify({ key: 'game', ...input }) } : undefined);
try {
  const records = await Promise.all(Array.from({ length: 8 }, (_, i) => operation('/claim', { requestId: 'request-' + i }).then((r) => r.json())));
  assert.equal(records.filter((r) => r.claimed).length, 1);
  const first = records.find((r) => r.claimed).record;
  await runtime.dispose();
  runtime = new Miniflare(settings);
  const restored = await (await operation('/?key=game')).json();
  assert.equal(restored.lease, first.lease);
  await operation('/finish', {
    lease: first.lease,
    status: 'ready',
    knowledge: { sections: [{ id: 'one', topic: 'visao-geral', text: 'Resumo salvo', generatedText: 'Resumo salvo', review: 'unreviewed', sourceId: 'source' }], sources: [{ id: 'source' }] },
  });
  await runtime.dispose();
  runtime = new Miniflare(settings);
  assert.equal((await (await operation('/?key=game')).json()).knowledge.sections[0].text, 'Resumo salvo');
  assert.equal((await (await operation('/claim', { requestId: 'reload' })).json()).claimed, false);
  console.log('Durable Object SQLite real: concorrência, lease e conhecimento persistiram após reiniciar o runtime; nenhuma chamada ao Gemini.');
} finally {
  await runtime.dispose();
}
