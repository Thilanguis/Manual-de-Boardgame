import test from 'node:test';
import assert from 'node:assert/strict';
import { wikipedia } from '../src/catalog/wikipedia.js';
import { wikidata } from '../src/catalog/wikidata.js';
const claim = (value) => ({ mainsnak: { snaktype: 'value', datavalue: { value } }, rank: 'normal' });
const board = { id: 'Q17271', labels: { 'pt-br': { value: 'Colonizadores de Catan', language: 'pt-br' } }, claims: { P31: [claim({ id: 'Q131436' })], P2339: [claim('13')] } };
test('Wikipédia importa descrição licenciada somente de artigo vinculado ao jogo, com autores e licença', async () => {
  const input = { query: 'Colonizadores de Catan', pdfLanguage: 'pt-BR', preferredLanguage: 'pt-BR', interactive: true };
  const result = await wikipedia(input, async (url) => {
    const u = new URL(url);
    if (u.hostname.endsWith('wikipedia.org'))
      return { query: { pages: [{ pageid: 123, title: 'Descobridores de Catan', pageprops: { wikibase_item: 'Q17271' }, extract: 'Colonizadores de Catan é um jogo de tabuleiro. Texto sintético criado exclusivamente para este teste.' }] } };
    return { entities: { Q17271: board } };
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].license, 'CC BY-SA 4.0');
  assert.match(result[0].authorsUrl, /action=history/);
  assert.match(result[0].licenseUrl, /by-sa\/4.0/);
  assert.equal(result[0].fields.minPlayers, undefined);
  assert.match(result[0].fieldReasons.recommendedAge, /não foi extraído/);
});
test('artigo de filme homônimo e artigo sem identidade verificável são descartados', async () => {
  const result = await wikipedia({ query: 'Jogo', pdfLanguage: 'pt-BR', preferredLanguage: 'pt-BR' }, async (url) =>
    new URL(url).hostname.endsWith('wikipedia.org')
      ? { query: { pages: [{ pageid: 1, title: 'Jogo', pageprops: { wikibase_item: 'Q1' }, extract: 'Um filme cujo título é homônimo do jogo, mas não deve preencher nenhum campo.' }] } }
      : { entities: { Q1: { ...board, id: 'Q1', claims: { P31: [claim({ id: 'Q7889' })] } } } },
  );
  assert.equal(result.length, 0);
});
test('Wikidata usa alias editorial revisado da Sina sem tratar edição como confirmada', async () => {
  const input = { query: 'O Senhor dos Anéis: Sina da Sociedade', preferredLanguage: 'pt-BR', pdfLanguage: 'pt-BR' },
    urls = [];
  const result = await wikidata(input, async (url) => {
    const u = new URL(url);
    urls.push(u);
    if (u.searchParams.get('action') === 'wbsearchentities') return { search: [] };
    if (u.searchParams.get('props') === 'labels') return { entities: {} };
    return {
      entities: {
        Q137295527: {
          id: 'Q137295527',
          labels: { en: { language: 'en', value: 'The Lord of the Rings: Fate of the Fellowship' } },
          claims: { P31: [claim({ id: 'Q1783817' })], P2339: [claim('436217')], P1872: [claim({ amount: '+1', unit: '1' })], P1873: [claim({ amount: '+5', unit: '1' })] },
        },
      },
    };
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].fields.gameType, 'Cooperativo');
  assert.equal(result[0].fields.minPlayers, 1);
  assert.equal(result[0].fields.recommendedAge, undefined);
  assert.equal(input.diagnostics.identityResolution.editionConfirmed, false);
  assert(urls.some((u) => u.searchParams.get('search') === 'The Lord of the Rings: Fate of the Fellowship'));
});
test('buscas que falham são reportadas como parciais, nunca como zero completo', async () => {
  const input = { query: 'Título raro', preferredLanguage: 'pt-BR', pdfLanguage: 'pt-BR' };
  await wikipedia(input, async () => {
    throw new Error('fonte indisponível');
  });
  assert.equal(input.diagnostics.complete, false);
  assert(input.diagnostics.failures.length > 0);
});
