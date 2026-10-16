import test from 'node:test';
import assert from 'node:assert/strict';
import { consolidateCandidates, researchSnapshot, reusableResearch, researchForReuse } from '../js/research-knowledge.js';
import { queryVariants } from '../js/game-identities.js';
import { sameWork } from '../js/research-client.js';
import { vocabularyFields } from '../js/game-vocabulary.js';
const candidate = (source, language, fields, more = {}) => ({
  source,
  id: 'Q137295527',
  url: 'https://example.org/source',
  fields,
  names: [{ value: 'O Senhor dos Anéis: Sina da Sociedade', language: 'pt-BR' }],
  identifiers: { wikidata: 'Q137295527' },
  kind: 'base',
  edition: '',
  language,
  license: source === 'wikipedia' ? 'CC BY-SA 4.0' : 'CC0',
  fetchedAt: 1,
  conflicts: [],
  ...more,
});
test('Sina brasileiro, original e francês consultam PT/EN/FR com equivalências editoriais documentadas', () => {
  for (const query of ['O Senhor dos Anéis: Sina da Sociedade', 'The Lord of the Rings: Fate of the Fellowship', 'Le Seigneur des Anneaux: Le Destin de la Communauté']) {
    const plans = queryVariants({ query, pdfLanguage: 'pt-BR' });
    assert.deepEqual([...new Set(plans.map((p) => p.language))].sort(), ['en', 'fr', 'pt']);
    assert(plans.some((p) => p.query.includes('Fate of the Fellowship')));
    assert(plans.some((p) => p.query.includes('Destin de la Communauté')));
  }
  const variants = queryVariants({ query: 'Jogo: subtítulo documentado', alternateTitles: [{ value: 'Official English Name', language: 'en' }] });
  assert(variants.some((p) => p.query === 'subtítulo documentado'));
  assert(variants.some((p) => p.query === 'Official English Name'));
});
test('campos EN e FR se combinam com origem individual e textos sem tradução ficam pendentes', () => {
  const [merged] = consolidateCandidates([
    candidate('wikidata', 'en', { durationMinutes: 75, minPlayers: 1, maxPlayers: 5 }),
    candidate('wikipedia', 'fr', { tags: ['Strategy'], mechanics: ['Worker placement'], description: 'Une description originale assez longue pour être utilisée.' }),
  ]);
  assert.deepEqual(merged.fields.tags, ['Estratégia']);
  assert.deepEqual(merged.fields.mechanics, ['Alocação de trabalhadores']);
  assert.equal(merged.fields.description, undefined);
  assert.equal(merged.pendingTranslations[0].language, 'fr');
  assert.equal(merged.pendingTranslations[0].value.startsWith('Une description'), true);
  assert.equal(merged.fieldSources.minDurationMinutes.source, 'wikidata');
  assert.equal(merged.fieldSources.mechanics.source, 'wikipedia');
  assert.equal(merged.fields.title, 'O Senhor dos Anéis: Sina da Sociedade');
  const [equivalent] = consolidateCandidates([candidate('wikidata', 'en', { tags: ['Adventure', 'Strategy'] }), candidate('wikipedia', 'fr', { tags: ['Stratégie', 'Aventure'] })]);
  assert.deepEqual(equivalent.conflicts, []);
});
test('homônimos, expansão, edição diferente e IDs contraditórios ficam separados', () => {
  const first = candidate('wikidata', 'pt', { title: 'Catan' });
  for (const other of [candidate('wikipedia', 'pt', { title: 'Catan' }, { identifiers: { wikidata: 'Q999' } }), candidate('wikidata', 'pt', {}, { kind: 'expansion' }), candidate('wikidata', 'pt', {}, { edition: '2020' })])
    assert.equal(consolidateCandidates([first, other]).length, 2);
  assert.equal(sameWork({ ...first, identifiers: { bgg: '13', wikidata: 'Q1' } }, { ...first, identifiers: { bgg: '13', wikidata: 'Q2' } }), false);
});
test('divergências preservam alternativas e cache respeita licença, edição, idioma e expiração', () => {
  const all = [candidate('wikidata', 'en', { durationMinutes: 60 }), candidate('wikipedia', 'fr', { durationMinutes: 90 }), candidate('bgg', 'en', { description: 'Texto de licença restrita.' })];
  const [merged] = consolidateCandidates(all);
  assert(merged.conflicts.length);
  assert.deepEqual(
    merged.alternatives.maxDurationMinutes.map((f) => f.value),
    [60, 90],
  );
  const input = { query: 'Sina da Sociedade', preferredLanguage: 'pt-BR', kind: 'base', edition: '', manualHash: 'a'.repeat(64) };
  const snapshot = researchSnapshot(input, all);
  assert.equal(snapshot.candidates.length, 2);
  assert(reusableResearch(snapshot, input));
  assert(reusableResearch(snapshot, { ...input, query: 'O Senhor dos Anéis: Sina da Sociedade' }));
  assert.equal(reusableResearch(snapshot, { ...input, kind: 'expansion' }), false);
  assert.equal(reusableResearch(snapshot, { ...input, edition: 'segunda edição' }), false);
  assert.equal(reusableResearch(snapshot, { ...input, preferredLanguage: 'fr' }), false);
  assert.equal(reusableResearch(snapshot, input, snapshot.expiresAt + 1), false);
  assert.deepEqual(vocabularyFields({ mechanics: ['Deck building', 'construction de deck', 'termo desconhecido'] }).mechanics, ['Construção de baralho', 'termo desconhecido']);
});
test('conhecimento confirmado continua reutilizável depois do cache sem renovar data nem copiar campos não revisados/restritos', () => {
  const input = { query: 'Sina da Sociedade', preferredLanguage: 'pt-BR', kind: 'base', fetchedAt: 1000, manualHash: 'a'.repeat(64) };
  const open = candidate('wikidata', 'en', { minPlayers: 1, maxPlayers: 5, recommendedAge: 14 });
  const restricted = candidate('bgg', 'en', { description: 'Descrição restrita' });
  const snapshot = researchSnapshot(
    input,
    [open, restricted],
    [
      {
        manualHash: input.manualHash,
        edition: input.edition || '',
        source: 'wikidata',
        id: open.id,
        reviewedAt: 2000,
        facts: [
          { source: 'wikidata', id: open.id, key: 'minPlayers', value: 1 },
          { source: 'bgg', id: open.id, key: 'description', value: 'Descrição restrita' },
        ],
      },
    ],
  );
  const reused = researchForReuse(snapshot, input, snapshot.expiresAt + 1);
  assert(reused.reviewedOnly);
  assert.equal(reused.fetchedAt, 1000);
  assert.deepEqual(reused.candidates[0].fields, { minPlayers: 1 });
  assert.equal(JSON.stringify(snapshot).includes('Descrição restrita'), false);
});

const manualInput = { query: 'Sina da Sociedade', preferredLanguage: 'pt-BR', kind: 'base', edition: '', manualHash: 'a'.repeat(64), fetchedAt: 1000 };
const otherManual = { ...manualInput, manualHash: 'b'.repeat(64) };
function reviewedResearch(input = manualInput) {
  const result = candidate(
    'wikidata',
    'pt-BR',
    {
      title: 'Sina da Sociedade',
      description: 'Resumo da edição consultada.',
      minPlayers: 1,
      maxPlayers: 5,
      durationMinutes: 90,
      recommendedAge: 14,
      tags: ['Adventure'],
      mechanics: ['Cooperative play'],
      gameType: 'Cooperativo',
      language: 'pt-BR',
      rules: 'Regra exclusiva desta edição.',
    },
    { evidence: { players: { page: 4, excerpt: 'Regras da edição A' } } },
  );
  return researchSnapshot(input, [result], [{ manualHash: input.manualHash, edition: input.edition || '', source: result.source, id: result.id, reviewedAt: 2000, facts: [{ source: result.source, id: result.id, key: 'maxPlayers', value: 5 }] }]);
}
test('edição desconhecida e título igual não autorizam reutilização integral entre hashes distintos', () => {
  const snapshot = reviewedResearch();
  assert.equal(reusableResearch(snapshot, otherManual, 3000), false);
  const reused = researchForReuse(snapshot, otherManual, 3000);
  assert(reused, 'identidade e sugestões gerais continuam disponíveis');
  assert.deepEqual(reused.decisions, [], 'a aprovação do PDF anterior não se transfere');
  assert.equal(reused.candidates[0].requiresEditionReview, true);
  assert.equal(reused.candidates[0].fields.maxPlayers, 5, 'metadados só ficam disponíveis para nova revisão');
  assert.equal(reused.candidates[0].fields.rules, undefined);
  assert.equal(reused.candidates[0].fields.language, undefined, 'idioma do PDF anterior não se transfere');
  assert.equal(reused.candidates[0].evidence, undefined, 'páginas do PDF anterior não se transferem');
  assert.deepEqual(snapshot, reviewedResearch(), 'a projeção não modifica o histórico original');
});
test('mesmo hash e contexto preservam a reutilização completa e a aprovação anterior', () => {
  const snapshot = reviewedResearch();
  assert(reusableResearch(snapshot, manualInput, 3000));
  assert.deepEqual(researchForReuse(snapshot, manualInput, 3000), snapshot);
});
test('edições conhecidas diferentes reutilizam apenas identidade, mesmo com o mesmo título', () => {
  const snapshot = reviewedResearch({ ...manualInput, edition: 'Primeira edição' });
  for (const manualHash of [manualInput.manualHash, otherManual.manualHash]) {
    const input = { ...otherManual, manualHash, edition: 'Segunda edição' };
    assert.equal(reusableResearch(snapshot, input, 3000), false);
    const reused = researchForReuse(snapshot, input, 3000);
    assert.deepEqual(reused.candidates[0].fields, { title: 'Sina da Sociedade' });
    assert.equal(reused.candidates[0].edition, '');
    assert.deepEqual(reused.decisions, []);
    assert.equal(reused.candidates[0].identifiers.wikidata, 'Q137295527');
  }
});
test('hash ausente em histórico legado ou no PDF atual nunca comprova o mesmo manual', () => {
  for (const [oldHash, newHash] of [
    ['', ''],
    ['', otherManual.manualHash],
    [manualInput.manualHash, ''],
  ]) {
    const snapshot = reviewedResearch({ ...manualInput, manualHash: oldHash });
    const input = { ...manualInput, manualHash: newHash };
    assert.equal(reusableResearch(snapshot, input, 3000), false);
    assert.equal(researchForReuse(snapshot, input, 3000).candidates[0].requiresEditionReview, true);
  }
});
test('aprovação durável vencida não é herdada por outro PDF nem recupera campos não revisados', () => {
  const snapshot = reviewedResearch();
  const reused = researchForReuse(snapshot, otherManual, snapshot.expiresAt + 1);
  assert.deepEqual(reused.decisions, []);
  assert.equal(reused.candidates[0].requiresEditionReview, true);
  assert.equal(reused.candidates[0].fields.maxPlayers, 5);
  assert.equal(reused.candidates[0].fields.description, undefined);
});
test('salvar apenas o título do segundo PDF não aprova implicitamente os outros metadados', () => {
  const reused = researchForReuse(reviewedResearch(), otherManual, 3000);
  const result = reused.candidates[0];
  const snapshot = researchSnapshot(otherManual, reused.candidates, [
    { manualHash: otherManual.manualHash, edition: '', source: result.source, id: result.id, reviewedAt: 3000, facts: [{ source: result.source, id: result.id, key: 'title', value: 'Sina da Sociedade' }] },
  ]);
  assert.deepEqual(snapshot.candidates[0].fields, { title: 'Sina da Sociedade' });
  assert.equal(snapshot.decisions[0].manualHash, otherManual.manualHash);
  assert.equal(snapshot.manualHash, otherManual.manualHash);
  assert.equal(researchForReuse(snapshot, otherManual, 4000).candidates[0].fields.maxPlayers, undefined);
});
test('metadados explicitamente reconferidos pertencem apenas ao contexto do novo PDF', () => {
  const reused = researchForReuse(reviewedResearch(), otherManual, 3000);
  const result = reused.candidates[0];
  const snapshot = researchSnapshot(otherManual, reused.candidates, [
    { manualHash: otherManual.manualHash, edition: '', source: result.source, id: result.id, reviewedAt: 3000, facts: [{ source: result.source, id: result.id, key: 'maxPlayers', value: 4 }] },
  ]);
  assert.equal(snapshot.candidates[0].fields.maxPlayers, 4);
  assert.equal(snapshot.candidates[0].fields.description, undefined);
  assert.equal(snapshot.decisions[0].manualHash, otherManual.manualHash);
  assert.equal(researchForReuse(snapshot, manualInput, 4000).candidates[0].requiresEditionReview, true);
});
test('gravar no novo contexto rejeita decisões do PDF anterior ou sem hash explícito', () => {
  const old = reviewedResearch();
  const reused = researchForReuse(old, otherManual, 3000);
  for (const decisions of [old.decisions, old.decisions.map(({ manualHash, ...legacy }) => legacy)]) {
    const snapshot = researchSnapshot(otherManual, reused.candidates, decisions);
    assert.deepEqual(snapshot.decisions, []);
    assert.deepEqual(snapshot.candidates[0].fields, { title: 'Sina da Sociedade' });
  }
});
test('rótulo de edição igual não dispensa reconferência de metadados em outro hash', () => {
  const input = { ...manualInput, edition: 'Segunda edição' };
  const snapshot = reviewedResearch(input);
  assert(reusableResearch(snapshot, input, 3000));
  const reused = researchForReuse(snapshot, { ...input, manualHash: otherManual.manualHash }, 3000);
  assert(reused.candidates[0].requiresEditionReview);
  assert.deepEqual(reused.decisions, []);
});
test('edição declarada pela fonte também é verificada, mesmo quando o contexto do snapshot coincide', () => {
  const input = { ...manualInput, edition: 'Segunda edição' };
  const snapshot = researchSnapshot(input, [candidate('wikidata', 'pt', { title: 'Sina da Sociedade', maxPlayers: 5 }, { edition: 'Primeira edição' })]);
  assert.equal(reusableResearch(snapshot, input, 3000), false);
  const reused = researchForReuse(snapshot, input, 3000);
  assert.deepEqual(reused.candidates[0].fields, { title: 'Sina da Sociedade' });
  assert.deepEqual(reused.decisions, []);
});
