import test from 'node:test';
import assert from 'node:assert/strict';
import { profileDefinitions, validateProfile } from '../js/profile-facts.js';
import { metadataKeys } from '../js/metadata-consolidation.js';
import { verifiedKnowledgeFields } from '../js/knowledge-model.js';
const hash = 'a'.repeat(64),
  text = 'Jogo Exemplo. Terceira edição. Para 2 a 5 jogadores. Duração de 60 a 150 minutos. Idade: 14 anos. Jogo base cooperativo de aventura, com gestão de cartas.';
const source = { id: 'manual-1', scope: 'edition-confirmed', documentId: 'main', sourceHash: hash, language: 'pt-BR', pages: [{ page: 1, text }] };
const fields = {
  title: 'Jogo Exemplo',
  edition: 'Terceira edição',
  description: 'Coopere com os outros jogadores em uma aventura com cartas.',
  minPlayers: 2,
  maxPlayers: 5,
  minDurationMinutes: 60,
  maxDurationMinutes: 150,
  recommendedAge: 14,
  tags: ['Aventura'],
  mechanics: ['Gestão de cartas'],
  gameType: 'Jogo base cooperativo',
};
const raw = Object.fromEntries(Object.entries(fields).map(([k, value]) => [k, { value, sourceId: source.id, page: 1, quote: text, evidenceId: 'manual-1-p1-1' }]));
test('ficha cobre todos e somente os campos editoriais reais e conserva evidência de cada valor', () => {
  assert.deepEqual(Object.keys(profileDefinitions).sort(), [...metadataKeys].sort());
  const profile = validateProfile(raw, [source]);
  assert.deepEqual(Object.keys(profile).sort(), Object.keys(fields).sort());
  for (const [k, f] of Object.entries(profile)) {
    assert.deepEqual(f.value, fields[k]);
    assert.equal(f.page, 1);
    assert.equal(f.sourceHash, hash);
  }
  const game = { id: 'x', manual: { sha256: hash, pages: 1 } };
  const knowledge = { profile, fields: profile, sources: [source], sections: [] };
  assert.deepEqual(Object.keys(verifiedKnowledgeFields(knowledge, game)).sort(), Object.keys(fields).sort());
});
test('página inexistente, quote inventada, números ausentes e faixas quebradas são descartados', () => {
  for (const change of [{ page: 2 }, { quote: 'Uma afirmação inventada.' }, { value: 99 }]) assert.equal(validateProfile({ ...raw, recommendedAge: { ...raw.recommendedAge, ...change } }, [source]).recommendedAge, undefined);
  const wrong = { ...raw, minPlayers: { ...raw.minPlayers, value: 5 }, maxPlayers: { ...raw.maxPlayers, value: 2 } };
  assert.equal(validateProfile(wrong, [source]).minPlayers, undefined);
  assert.equal(validateProfile({}, [source]).description, undefined);
  assert.equal(validateProfile({ ...raw, recommendedAge: { ...raw.recommendedAge, value: 2 } }, [source]).recommendedAge, undefined, 'não usa a contagem de jogadores como idade');
  assert.equal(validateProfile(raw, [{ ...source, profileEligible: false }]).recommendedAge, undefined, 'um complemento de outra edição não alimenta a ficha base');
});
