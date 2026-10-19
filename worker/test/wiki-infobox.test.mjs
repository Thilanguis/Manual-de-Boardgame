import test from 'node:test';
import assert from 'node:assert/strict';
import { wikiInfobox } from '../src/catalog/wiki-infobox.js';
import { wikipedia } from '../src/catalog/wikipedia.js';
test('ficha técnica preserva contexto: duração fixa repete, faixa ordenada, idade, categorias e mecânicas separadas', () => {
  const parsed = wikiInfobox('{{Infobox game\n| players = 2–8\n| playing_time = 30 minutes\n| setup_time=999\n| ages=8+\n| genre=[[Card game]]\n| mechanics=[[Card drafting]], [[Set collection]]\n}}\nOutra edição: 100 minutos');
  assert.deepEqual(parsed.fields, { minPlayers: 2, maxPlayers: 8, minDurationMinutes: 30, maxDurationMinutes: 30, recommendedAge: 8, tags: ['Card game'], mechanics: ['Card drafting', 'Set collection'] });
  assert.match(parsed.evidence.minDurationMinutes, /Playing time: 30 minutes/);
  assert.deepEqual(wikiInfobox('{{Info/Jogo|tempo=60–90 min|idade=14 anos|jogadores=1–4}}').fields, { minPlayers: 1, maxPlayers: 4, minDurationMinutes: 60, maxDurationMinutes: 90, recommendedAge: 14 });
});
test('conflitos, qualificadores, templates desconhecidos e números fora da ficha não viram fatos', () => {
  assert.deepEqual(wikiInfobox('{{Infobox game|playing_time=30 min|playing_time=90 min|age=8 or 12|mechanics={{unparsed|42}}}} 60 min 2 players').fields, {});
  assert.deepEqual(wikiInfobox('Texto 30 min 2–8 players').fields, {});
  assert.equal(wikiInfobox('{{Infobox game|playing_time=at least 30 min}}').fields.minDurationMinutes, undefined);
});
test('Wikipédia traz campos e revisão no mesmo request, com licença e atribuição', async () => {
  const calls = [];
  const result = await wikipedia({ query: 'Jogo técnico', preferredLanguage: 'pt-BR' }, async (url) => {
    const u = new URL(url);
    calls.push(u);
    return u.hostname.endsWith('wikipedia.org')
      ? {
          query: {
            pages: [
              {
                pageid: 1,
                title: 'Jogo técnico',
                pageprops: { wikibase_item: 'Q100' },
                extract: 'Jogo técnico é um jogo de tabuleiro usado como fixture de teste.',
                revisions: [{ revid: 1234, slots: { main: { content: '{{Info/Jogo|tempo=30 min|idade=8+}}' } } }],
              },
            ],
          },
        }
      : { entities: { Q100: { id: 'Q100', labels: { pt: { value: 'Jogo técnico', language: 'pt' } }, claims: { P31: [{ rank: 'normal', mainsnak: { snaktype: 'value', datavalue: { value: { id: 'Q131436' } } } }] } } } };
  });
  assert.equal(result[0].fields.minDurationMinutes, 30);
  assert.equal(result[0].fields.maxDurationMinutes, 30);
  assert.equal(result[0].fieldEvidence.recommendedAge.revision, 1234);
  assert.match(result[0].fieldEvidence.recommendedAge.url, /oldid=1234/);
  assert.equal(result[0].license, 'CC BY-SA 4.0');
  assert.equal(calls.filter((u) => u.hostname.endsWith('wikipedia.org')).length, 3);
});
