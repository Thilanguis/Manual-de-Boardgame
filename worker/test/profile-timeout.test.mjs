import test from 'node:test';
import assert from 'node:assert/strict';
import { synthesizePublicKnowledge } from '../src/game-knowledge.js';

const source = { id: 'manual-1', documentId: 'main', sourceHash: 'a'.repeat(64), scope: 'edition-confirmed', pages: [{ page: 1, text: 'Para jogar, escolha uma carta e passe as demais ao próximo jogador. Forme conjuntos para marcar pontos.' }] };
const env = { GEMINI_API_KEY: 'fixture', FIREBASE_PROJECT_ID: 'demo-acervo' };
const payload = {
  candidates: [
    {
      finishReason: 'STOP',
      content: {
        parts: [
          {
            text: JSON.stringify({ language: 'pt-BR', sections: [{ topic: 'acoes', title: 'Escolher cartas', text: 'Escolha uma carta e passe as demais.', sourceId: source.id, page: 1, evidenceId: 'manual-1-p1-1' }], unconfirmed: [], metadata: {} }),
          },
        ],
      },
    },
  ],
};
function clock(t) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.mock.method(AbortSignal, 'timeout', (ms) => {
    const control = new AbortController();
    setTimeout(() => control.abort(new DOMException('Timeout simulado', 'TimeoutError')), ms);
    return control.signal;
  });
}
test('ficha combinada aceita resposta válida após 19 segundos sem corte local de 18 segundos nem repetição', async (t) => {
  clock(t);
  let calls = 0;
  const pending = synthesizePublicKnowledge(
    { title: 'Jogo de teste' },
    [source],
    env,
    async (url, { signal }) => {
      calls++;
      return new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        setTimeout(() => resolve(Response.json(payload)), 19000);
      });
    },
    { completeProfile: true },
  );
  t.mock.timers.tick(19000);
  assert.equal((await pending).sections.length, 1);
  assert.equal(calls, 1);
});
test('timeout combinado tem prazo finito de 60 segundos e diagnóstico próprio, sem repetir chamada', async (t) => {
  clock(t);
  let calls = 0;
  const pending = synthesizePublicKnowledge(
    { title: 'Jogo de teste' },
    [source],
    env,
    async (url, { signal }) => {
      calls++;
      return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
    },
    { completeProfile: true },
  );
  const checked = assert.rejects(pending, (e) => e.reason === 'provider-timeout' && e.provider.timeoutMs === 60000 && /60 segundos/.test(e.message));
  t.mock.timers.tick(60001);
  await checked;
  assert.equal(calls, 1);
});
test('falha de rede não é anunciada como timeout ou HTTP 503 e não expõe erro bruto', async () => {
  await assert.rejects(
    synthesizePublicKnowledge(
      { title: 'Jogo de teste' },
      [source],
      env,
      async () => {
        throw new Error('PRIVATE_INTERNAL_NETWORK');
      },
      { completeProfile: true },
    ),
    (e) => e.reason === 'provider-network' && e.provider.httpStatus === undefined && !JSON.stringify(e).includes('PRIVATE_INTERNAL_NETWORK'),
  );
});
