import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectProfile, combinedProfileComplete, profileDefinitions } from '../js/profile-facts.js';
import { savedKnowledgeCandidate } from '../js/research-enrichment.js';
import { profileDiagnostic } from '../js/profile-diagnostics.js';
import { consolidateMetadata, metadataUpdates } from '../js/metadata-consolidation.js';

const hash = 'a'.repeat(64);
const game = { title: 'Sushi Go Party!', edition: '', description: '', manual: { sha256: hash, pages: 1 } };
const text = 'Escolha cartas e passe a mão aos outros jogadores. Forme combinações e some pontos ao final da rodada.';
const description = 'Escolha cartas e passe as demais aos outros jogadores, formando combinações para marcar pontos.';
const source = { id: 'manual', documentId: 'main', sourceHash: hash, pages: [{ page: 1, text }] };
const profile = inspectProfile({ description: { value: description, sourceId: source.id, page: 1, quote: text, excerpt: text } }, [source]).fields;
const record = (fields) => ({ status: 'ready', knowledge: { title: game.title, edition: '', sources: [source], profile: structuredClone(profile), fields, sections: [] } });

test('resumo validado de análise salva chega ao formulário mesmo com projeção fields ausente ou obsoleta', () => {
  for (const fields of [undefined, {}, { description: { value: 'Rascunho inválido', sourceId: 'fonte-errada' } }]) {
    const saved = record(fields),
      candidate = savedKnowledgeCandidate(saved, game);
    assert.equal(candidate?.fields.description, description);
    assert.equal(candidate.evidence.description.page, 1);
    assert.equal(candidate.evidence.description.excerpt, text);
    assert(!profileDiagnostic(saved, candidate).rejected.some((r) => r.key === 'description'));
    const model = consolidateMetadata(game, [candidate]);
    assert.equal(metadataUpdates(model, game).description, description);
    assert.equal(metadataUpdates(model, { ...game, description: 'Minha apresentação', sources: { description: { source: 'Conferido e ajustado por você' } } }).description, undefined);
  }
});
test('recuperação de resumo salvo não atravessa título, edição ou versão do PDF alterados', () => {
  for (const changed of [
    { ...game, title: 'Outro jogo' },
    { ...game, edition: 'Outra edição' },
    { ...game, manual: { sha256: 'b'.repeat(64), pages: 1 } },
  ])
    assert.equal(savedKnowledgeCandidate(record({}), changed), null);
});
test('rótulo genérico tem diagnóstico específico em vez de falsa rejeição de identidade', () => {
  const saved = record({});
  saved.knowledge.profile.description.value = 'jogo de cartas';
  const candidate = savedKnowledgeCandidate(saved, game);
  assert(profileDiagnostic(saved, candidate).rejected.some((r) => r.key === 'description' && r.reason === 'summary-label'));
});

test('cache legado com rótulo permite uma atualização explícita; resumo válido e tentativa nova sem resumo não repetem', () => {
  const saved = record({}).knowledge;
  saved.profileAnalysis = { coverageComplete: true, checkedFields: Object.keys(profileDefinitions), publicEvidenceProtocol: 3, discovery: { version: 1, status: 'unavailable' } };
  saved.profile.description.value = 'jogo de cartas';
  saved.fields = { ...saved.profile };
  assert.equal(combinedProfileComplete(saved, 3), false, 'rótulo não é ficha pronta para reutilizar na ação explícita');
  saved.profileAnalysis.summaryProtocol = 1;
  assert.equal(combinedProfileComplete(saved, 3), true, 'uma tentativa no contrato novo não cria ciclo');
  delete saved.profileAnalysis.summaryProtocol;
  saved.profile.description.value = description;
  assert.equal(combinedProfileComplete(saved, 3), true, 'sinopse válida não precisa de outra IA');
});
