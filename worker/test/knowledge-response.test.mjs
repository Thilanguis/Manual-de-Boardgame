import test from 'node:test';
import assert from 'node:assert/strict';
import { synthesizePublicKnowledge } from '../src/game-knowledge.js';
import { draftKnowledgeEndpoint } from '../src/draft-knowledge.js';
import { knowledgeFixture } from '../../tests/knowledge-fixture.mjs';
import { checkKnowledgeSources } from '../src/knowledge-limits.js';

const text = 'Jogo de teste para 2 a 4 jogadores. Prepare as cartas, escolha uma ação e passe a vez. Duração: 30 minutos. Idade: 8 anos.';
const source = { id: 'manual-1', name: 'Manual de teste', documentId: 'main', sourceHash: 'a'.repeat(64), scope: 'edition-confirmed', pages: [{ page: 1, text }] };
const section = { topic: 'acoes', title: 'Escolher uma ação', text: 'Escolha uma ação e passe a vez.', sourceId: source.id, page: 1, evidenceId: 'manual-1-p1-1' };
const full = { language: 'pt-BR', sections: [section], unconfirmed: [], metadata: { minDurationMinutes: { value: 30, sourceId: source.id, page: 1, evidenceId: 'manual-1-p1-1', excerpt: 'Duração: 30 minutos.' } } };
const env = { GEMINI_API_KEY: 'fixture', FIREBASE_PROJECT_ID: 'demo-acervo', OWNER_UID: 'owner', ALLOW_MANUAL_AI: 'true' };

test('resposta extensa de ficha e regras cabe na única geração, sem alterar o prompt editorial', async () => {
  let calls = 0,
    requestBody;
  const result = await synthesizePublicKnowledge({ title: 'Jogo de teste' }, [source], env, async (url, options) => {
    calls++;
    const body = JSON.parse(options.body);
    requestBody = body;
    // Provedor simulado exige espaço para ficha + 24 explicações. Não estima o
    // tokenizer real nem afirma que o print foi causado por MAX_TOKENS.
    if (body.generationConfig.maxOutputTokens < 12000) return Response.json({ candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: '{"language":' }] } }] });
    return Response.json({
      usageMetadata: { candidatesTokenCount: 9700 },
      candidates: [
        {
          finishReason: 'STOP',
          content: { parts: [{ thought: true, text: 'pensamento interno simulado' }, { text: JSON.stringify({ ...full, sections: Array.from({ length: 24 }, (_, i) => ({ ...section, title: `Assunto ${i + 1}`, text: section.text.repeat(25) })) }) }] },
        },
      ],
    });
  });
  assert.equal(result.sections.length, 24);
  assert.match(requestBody.systemInstruction.parts[0].text, /Prepare entre 10 e 24 seções/);
  assert.equal(requestBody.generationConfig.responseSchema.properties.sections.maxItems, undefined, 'não multiplica estados da gramática; limite validado pelo servidor');
  assert.equal(requestBody.generationConfig.responseSchema.properties.identityHints.maxItems, undefined);
  assert.equal(result.profile.minDurationMinutes.value, 30);
  assert.equal(result.profile.maxDurationMinutes.value, 30);
  assert.equal(result.generation.finishReason, 'STOP');
  assert.equal(result.generation.usage.outputTokens, 9700);
  assert.equal(calls, 1);
});

test('interrupções distintas têm motivo verificável e nunca salvam JSON parcial ou repetem IA', async () => {
  for (const [finishReason, reason, pattern] of [
    ['MAX_TOKENS', 'provider-output-limit', /limite de saída/],
    ['SAFETY', 'provider-content-blocked', /bloqueou/],
    ['RECITATION', 'provider-content-blocked', /bloqueou/],
    ['OTHER', 'provider-incomplete', /interrompeu/],
  ]) {
    let calls = 0;
    await assert.rejects(
      synthesizePublicKnowledge({ title: 'Jogo de teste' }, [source], env, async () => {
        calls++;
        return Response.json({ usageMetadata: { candidatesTokenCount: 6500, thoughtsTokenCount: 12 }, candidates: [{ finishReason, finishMessage: 'NÃO EXPOR TEXTO DO PROVEDOR', content: { parts: [{ text: JSON.stringify(full) }] } }] });
      }),
      (error) => {
        assert.equal(error.reason, reason);
        assert.match(error.message, pattern);
        assert.equal(error.generation.finishReason, finishReason);
        assert.equal(error.generation.usage.outputTokens, 6500);
        assert.ok(!JSON.stringify(error).includes('NÃO EXPOR'));
        return true;
      },
    );
    assert.equal(calls, 1);
  }
  await assert.rejects(
    synthesizePublicKnowledge({ title: 'Jogo de teste' }, [source], env, async () => Response.json({ promptFeedback: { blockReason: 'SAFETY' } })),
    (e) => e.reason === 'provider-content-blocked',
  );
});

test('recusa HTTP do provedor conserva status e motivo seguro, sem expor mensagens ou repetir chamadas', async () => {
  for (const [httpStatus, status, message, reason] of [
    [400, 'INVALID_ARGUMENT', 'The response schema has too many states for serving. PRIVATE_TEXT SERVER_SECRET', 'provider-schema-rejected'],
    [400, 'INVALID_ARGUMENT', 'Invalid thinking configuration PRIVATE_TEXT', 'provider-invalid-request'],
    [503, 'UNAVAILABLE', 'Model overloaded PRIVATE_TEXT', 'provider-unavailable'],
  ]) {
    let calls = 0;
    await assert.rejects(
      synthesizePublicKnowledge({ title: 'Jogo de teste' }, [source], env, async () => {
        calls++;
        return Response.json({ error: { code: httpStatus, status, message } }, { status: httpStatus });
      }),
      (e) => {
        assert.equal(e.reason, reason);
        assert.equal(e.provider.httpStatus, httpStatus);
        assert.equal(e.provider.status, status);
        assert.ok(!JSON.stringify(e).includes('PRIVATE_TEXT'));
        assert.ok(!JSON.stringify(e).includes('SERVER_SECRET'));
        return true;
      },
    );
    assert.equal(calls, 1);
  }
});

test('cadastro aceita manual completo de 250 mil caracteres e rejeita excesso antes de gastar cota', async () => {
  const fixture = knowledgeFixture();
  const data = {
    title: 'Jogo de teste',
    edition: '',
    retry: true,
    requestId: crypto.randomUUID(),
    documents: [{ id: 'main', hash: source.sourceHash, name: 'Manual.pdf', language: 'pt-BR', pages: Array.from({ length: 25 }, (_, i) => ({ page: i + 1, text: text.repeat(100).slice(0, 10000) })) }],
  };
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    if (String(url).startsWith('https://firestore.googleapis.com/')) return Response.json({ fields: { uid: { stringValue: 'owner' }, status: { stringValue: 'approved' }, role: { stringValue: 'superadmin' } } });
    return (await fixture.fetch(url, options)) || assert.fail('Requisição não simulada');
  };
  try {
    const record = await (await draftKnowledgeEndpoint(new Request('https://fixture.test/draft'), { ...env, ...fixture.env }, { uid: 'owner', token: 'fixture', profile: { uid: 'owner', role: 'superadmin', status: 'approved' } }, data)).json();
    assert.equal(record.status, 'ready');
    assert.equal(record.knowledge.sources[0].pages.length, 25);
    assert.equal(record.knowledge.sources[0].pages.map((p) => p.text).join('').length, 250000);
    assert.equal(fixture.calls.length, 1);
    const quota = structuredClone(await fixture.storage.get('quota'));
    data.documents[0].pages = Array.from({ length: 41 }, (_, i) => ({ page: i + 1, text: text.repeat(100).slice(0, 10000) }));
    await assert.rejects(
      draftKnowledgeEndpoint(new Request('https://fixture.test/draft'), { ...env, ...fixture.env }, { uid: 'owner', profile: { uid: 'owner', role: 'superadmin', status: 'approved' } }, data),
      (e) => e.status === 413 && e.reason === 'manual-text-limit' && /400.000/.test(e.message),
    );
    assert.deepEqual(await fixture.storage.get('quota'), quota);
    assert.equal(fixture.calls.length, 1);
  } finally {
    globalThis.fetch = original;
  }
});

test('STOP vazio ou JSON inválido é distinguido de limite de tokens; evidência inválida segue rejeitada', async () => {
  for (const body of ['', '{"language":', 'null']) {
    let calls = 0;
    await assert.rejects(
      synthesizePublicKnowledge({ title: 'Jogo de teste' }, [source], env, async () => {
        calls++;
        return Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: body }] } }] });
      }),
      (error) => error.reason === 'provider-invalid-json' && error.generation.finishReason === 'STOP',
    );
    assert.equal(calls, 1);
  }
  await assert.rejects(
    synthesizePublicKnowledge({ title: 'Jogo de teste' }, [source], env, async () =>
      Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ ...full, sections: [{ ...section, evidenceId: 'fabricada' }] }) }] } }] }),
    ),
    /sustentadas/,
  );
});

test('limite de evidência conta bytes serializados e mantém alfabetos válidos', () => {
  assert.doesNotThrow(() => checkKnowledgeSources([{ ...source, pages: [{ page: 1, text: '日本語の説明'.repeat(20000) }] }]));
  assert.throws(
    () => checkKnowledgeSources([{ ...source, pages: [{ page: 1, text: '\u0000'.repeat(170000) }] }]),
    (e) => e.status === 413 && e.reason === 'knowledge-source-limit',
  );
});

test('registro maior que o limite não substitui conhecimento anterior nem perde correção manual', async () => {
  const fixture = knowledgeFixture();
  const stub = fixture.env.GAME_KNOWLEDGE.get();
  const call = async (path, data) => (await stub.fetch(new Request(`https://fixture.test${path}`, { method: 'POST', body: JSON.stringify({ key: 'size-test', ...data }) }))).json();
  const previous = { sections: [{ ...section, id: 'saved', review: 'manual', text: 'Correção preservada', generatedText: section.text, quote: text, sourceHash: source.sourceHash, documentId: 'main' }], sources: [source] };
  await call('/adopt', { knowledge: previous });
  const claim = await call('/claim', { force: true, requestId: crypto.randomUUID() });
  const record = await call('/finish', { lease: claim.record.lease, status: 'ready', knowledge: { sections: [], sources: [source], oversized: 'x'.repeat(1800000) } });
  assert.equal(record.status, 'attention');
  assert.equal(record.reason, 'knowledge-storage-limit');
  assert.deepEqual(record.knowledge, previous);
});
