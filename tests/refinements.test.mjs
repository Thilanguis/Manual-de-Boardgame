import test from 'node:test';
import assert from 'node:assert/strict';
import { validateGame, durationRange, durationLabel, filterGames, isTechnicalTitle, displayTitle } from '../js/model.js';
import { extractMetadata, titleCandidates } from '../js/recognition.js';
import { selectedFields } from '../js/research-client.js';

test('duração antiga continua legível e migra sem perda ao editar', () => {
  const old = { title: 'Jogo', durationMinutes: 45 };
  assert.equal(durationLabel(old), '45 min');
  const updated = validateGame(old);
  assert.deepEqual(durationRange(updated), { minDurationMinutes: 45, maxDurationMinutes: 45 });
  assert.equal(updated.durationMinutes, 45);
  assert.equal(validateGame({ ...old, minDurationMinutes: '', maxDurationMinutes: '' }).durationMinutes, null);
});
test('intervalo mantém os dois limites, sem converter uma média em duração', () => {
  const game = validateGame({ title: 'Jogo', minDurationMinutes: 60, maxDurationMinutes: 120 });
  assert.equal(game.durationMinutes, null);
  assert.equal(durationLabel(JSON.parse(JSON.stringify(game))), '60–120 min');
  assert.equal(durationLabel({ minDurationMinutes: null, maxDurationMinutes: null }), 'Não informada');
});
test('duração inválida, incompleta ou fora do limite é recusada', () => {
  for (const [min, max] of [
    [60, ''],
    ['', 120],
    [120, 60],
    [0, 30],
    [30.5, 60],
    [60, 1441],
  ])
    assert.throws(() => validateGame({ title: 'Jogo', minDurationMinutes: min, maxDurationMinutes: max }), /duração/i);
});
test('filtro rápido considera o máximo e ordenação considera mínimo e desempate pelo máximo', () => {
  const records = [
    { id: 'a', title: 'A', minDurationMinutes: 30, maxDurationMinutes: 60 },
    { id: 'b', title: 'B', durationMinutes: 30 },
    { id: 'c', title: 'C', minDurationMinutes: 15, maxDurationMinutes: 30 },
    { id: 'd', title: 'D', durationMinutes: null },
  ];
  assert.deepEqual(
    filterGames(records, { filter: 'quick' }).map((g) => g.id),
    ['b', 'c'],
  );
  assert.deepEqual(
    filterGames(records, { sort: 'duration' }).map((g) => g.id),
    ['c', 'b', 'a', 'd'],
  );
});
test('PDF aceita faixas PT-BR, francês e inglês; horas são convertidas nos dois limites', () => {
  for (const text of ['Duração: de 60 a 120 min', 'Durée : 60 à 120 minutes', 'Playing time: 60-120 minutes', 'Duração: 1 a 2 horas']) {
    const metadata = extractMetadata(text);
    assert.deepEqual([metadata.minDurationMinutes, metadata.maxDurationMinutes, metadata.durationMinutes], [60, 120, null], text);
    assert(metadata.sources.duration.excerpt);
  }
  assert.equal(extractMetadata('Duração: 30 min.\nDuração: 60 min.').minDurationMinutes, null);
});
test('título técnico não pode ser salvo e cadastro antigo pede revisão sem alterar o original', () => {
  const old = { title: 'ZMGPSM0101 v1.0.indd' };
  assert(isTechnicalTitle(old.title));
  assert.throws(() => validateGame(old), /título técnico/);
  assert.equal(displayTitle(old), 'Título a revisar');
  assert.equal(old.title, 'ZMGPSM0101 v1.0.indd');
  assert.equal(titleCandidates({ metadataTitle: old.title })[0].text, 'O Senhor dos Anéis: Sina da Sociedade');
  assert.equal(isTechnicalTitle('O Senhor dos Anéis: Sina da Sociedade'), false);
  assert.equal(titleCandidates({ filename: 'ABC123_Rulebook_v2.indd.pdf' }).length, 0);
});
test('sugestão externa fixa é revisada como dois limites e não marca substituição conflitante', () => {
  const fields = selectedFields({ fields: { durationMinutes: 75 }, conflicts: [] }, { minDurationMinutes: 60, maxDurationMinutes: 120 });
  assert.deepEqual(
    fields.map((f) => [f.key, f.value, f.checked]),
    [
      ['minDurationMinutes', 75, false],
      ['maxDurationMinutes', 75, false],
    ],
  );
});
test('termos explícitos multilíngues preservam evidência e não geram mecânicas ausentes', () => {
  const fr = extractMetadata('Dès 12 ans.\nMécaniques: construction de deck; lancer de dés');
  assert.equal(fr.recommendedAge, 12);
  assert(fr.mechanics.includes('Construção de baralho'));
  assert.match(fr.sources.mechanics.excerpt, /lancer/);
  assert.deepEqual(extractMetadata('Explore um mundo de fantasia.').mechanics, []);
});
