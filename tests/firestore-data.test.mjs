import test from 'node:test';
import assert from 'node:assert/strict';
import { Timestamp, serverTimestamp, GeoPoint } from 'firebase/firestore';
import { withoutUndefined } from '../js/firestore-data.js';
import { consolidateCandidates } from '../js/research-knowledge.js';

test('campos opcionais ausentes são removidos sem mudar dados válidos ou tipos do Firestore', () => {
  const timestamp = Timestamp.now(),
    sentinel = serverTimestamp(),
    point = new GeoPoint(1, 2),
    date = new Date();
  const input = {
    sources: { title: { source: 'PDF', url: undefined, license: undefined, page: 1 }, tags: { origins: [{ value: ['Terror'], url: undefined }] } },
    missing: undefined,
    empty: '',
    flag: false,
    count: 0,
    blank: null,
    timestamp,
    sentinel,
    point,
    date,
  };
  const clean = withoutUndefined(input);
  assert.deepEqual(clean.sources.title, { source: 'PDF', page: 1 });
  assert.deepEqual(clean.sources.tags.origins, [{ value: ['Terror'] }]);
  assert.equal(Object.hasOwn(clean, 'missing'), false);
  assert.equal(Object.hasOwn(input.sources.title, 'url'), true, 'não altera o rascunho original');
  for (const key of ['empty', 'flag', 'count', 'blank', 'timestamp', 'sentinel', 'point', 'date']) assert.equal(clean[key], input[key]);
  assert.deepEqual(withoutUndefined([undefined, 0, { url: undefined }, null]), [null, 0, {}, null]);
});

test('nome brasileiro encontrado sem fields.title conserva origem completa e nunca cria URL undefined', () => {
  const [suggestion] = consolidateCandidates([
    { source: 'gemini', id: 'game', fields: { description: 'Explore o cenário e complete os objetivos do manual.' }, names: [{ value: 'Dead by Daylight', language: 'pt-BR' }], language: 'pt-BR', kind: 'unknown', edition: '' },
  ]);
  assert.equal(suggestion.fields.title, 'Dead by Daylight');
  assert.equal(suggestion.fieldSources.title.source, 'gemini');
  assert.equal(suggestion.fieldSources.title.id, 'game');
  assert.equal(suggestion.fieldSources.title.url, '');
  assert.equal(suggestion.fieldSources.title.license, '');
  assert.equal(suggestion.alternatives.title[0].value, 'Dead by Daylight');
});
