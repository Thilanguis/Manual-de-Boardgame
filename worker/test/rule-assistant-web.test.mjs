import test from 'node:test';
import assert from 'node:assert/strict';
import { groundedRuleEvidence, searchRuleWeb, RULE_WEB_MODEL } from '../src/rule-assistant-web.js';
function fixture() {
  const text = 'No jogo de tabuleiro, os corvos usados pela Artista retornam ao tabuleiro dela para serem colocados novamente.';
  return {
    candidates: [
      {
        finishReason: 'STOP',
        content: { parts: [{ text }] },
        groundingMetadata: {
          webSearchQueries: ['Dead by Daylight board game Artist crows'],
          searchEntryPoint: { renderedContent: '<div>Pesquisa Google</div>' },
          groundingChunks: [{ web: { uri: 'https://www.level99games.com/blogs/news/artist', title: 'Level 99 · Dead by Daylight Board Game' } }],
          groundingSupports: [{ segment: { text }, groundingChunkIndices: [0] }],
        },
      },
    ],
  };
}
test('grounding usa somente segmentos vinculados a fontes e identifica resumos, não citações literais da página', () => {
  const payload = fixture(),
    result = groundedRuleEvidence(payload, { title: 'Dead by daylight' });
  assert.equal(result.status, 'web-searched');
  assert.equal(result.evidence.length, 1);
  assert.equal(result.evidence[0].quoteKind, 'search-summary');
  assert.equal(result.evidence[0].source, 'web', 'origem externa não é declarada oficial automaticamente');
  assert.equal(result.searchSuggestions, '<div>Pesquisa Google</div>');
  payload.candidates[0].groundingMetadata.groundingSupports[0].segment.text = 'Texto que o provedor não retornou.';
  assert.equal(groundedRuleEvidence(payload).evidence.length, 0);
});
test('IDs inexistentes, URLs locais/perigosas e páginas do videogame não viram referências do jogo de tabuleiro', () => {
  for (const url of [
    'http://example.com/rules',
    'https://127.0.0.1/rules',
    'https://localhost/rules',
    'https://private.internal/rules',
    'https://user:pass@example.com/rules',
    'javascript:alert(1)',
    'https://deadbydaylight.wiki.gg/wiki/The_Artist',
    'https://deadbydaylight.com/game/characters/the-artist/',
  ]) {
    const payload = fixture();
    payload.candidates[0].groundingMetadata.groundingChunks[0].web.uri = url;
    assert.equal(groundedRuleEvidence(payload, { title: 'Dead by daylight' }).evidence.length, 0);
  }
  const payload = fixture();
  payload.candidates[0].groundingMetadata.groundingSupports[0].groundingChunkIndices = [999];
  assert.equal(groundedRuleEvidence(payload).evidence.length, 0);
});
test('sem consulta real, sem grounding ou resposta incompleta não existe pesquisa confirmada', () => {
  for (const change of [(p) => (p.candidates[0].finishReason = 'MAX_TOKENS'), (p) => (p.candidates[0].groundingMetadata.webSearchQueries = []), (p) => (p.candidates[0].groundingMetadata.groundingSupports = [])]) {
    const payload = fixture();
    change(payload);
    assert.equal(groundedRuleEvidence(payload).evidence.length, 0);
  }
});
test('pesquisa usa o modelo compatível com Free Tier e não envia PDFs, histórico, UID ou hashes', async () => {
  let calls = 0;
  const result = await searchRuleWeb({ title: 'Dead by daylight', edition: 'Malicious', owner: 'private', documents: { secret: 'private' } }, 'Como usar corvos?', { GEMINI_API_KEY: 'fixture' }, new AbortController().signal, async (url, options) => {
    calls++;
    assert(url.includes('/models/' + RULE_WEB_MODEL + ':generateContent'));
    const body = JSON.parse(options.body),
      input = JSON.parse(body.contents[0].parts[0].text);
    assert.deepEqual(input, { game: 'Dead by daylight', edition: 'Malicious', medium: 'jogo de tabuleiro / board game', question: 'Como usar corvos?' });
    assert.deepEqual(body.tools, [{ google_search: {} }]);
    assert.equal(body.generationConfig.responseMimeType, undefined);
    return Response.json(fixture());
  });
  assert.equal(calls, 1);
  assert.equal(result.status, 'web-searched');
});
