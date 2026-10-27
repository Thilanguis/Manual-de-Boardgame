import '../scripts/test-guard.mjs';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { realIndex } from './real-index-fixture.mjs';
import { selectRuleEvidence, validateRuleAnswer } from '../worker/src/rule-assistant.js';

// Reproduz a pergunta relatada com os índices locais, sem Drive, Firebase ou Gemini.
const manuals = await Promise.all(
  [
    ['characters', 'Dead_by_Daylight_Guia_47_Personagens_PTBR_Revisado', 'complemento'],
    ['rules', 'dead_by_daylight_sem_perda_20paginas.pdf', 'principal'],
  ].map(async ([id, name, documentType]) => ({ id, name, documentType, index: await realIndex(name) })),
);
const question =
  'Quando o killer movimenta o sobrevivente no colo, ele escolhe a quantidade até 4 movimentos e o sobrevivente joga o dado. se o sobrevivente n escapar conforme o killer vai levando ele pelo caminho escolhido até enganchar ele vai revelando tb conforme andando?';
const report = [];
for (const order of [manuals, [...manuals].reverse()]) {
  const before = JSON.stringify(order);
  const game = {
    id: 'local-assistant-regression',
    title: 'Dead by daylight',
    documents: Object.fromEntries(order.map((doc) => [doc.id, { id: doc.id, name: doc.name, documentType: doc.documentType, manual: { sha256: doc.index.sourceHash, pages: doc.index.pageCount } }])),
  };
  const sources = order.map((doc, i) => ({ id: `manual-${i + 1}`, name: doc.name, documentId: doc.id, documentType: doc.documentType, sourceHash: doc.index.sourceHash, pages: doc.index.pages }));
  for (const page of [9, 15]) {
    const { evidence } = selectRuleEvidence(game, sources, { documentId: 'rules', sourceHash: game.documents.rules.manual.sha256, page }, question);
    const target = evidence.find((ref) => ref.documentId === 'rules' && ref.page === 15 && /O Sobrevivente não vira\s+Adereços/u.test(ref.text));
    assert(target, 'o trecho SACRIFICANDO chega ao modelo, inclusive quando a busca ancora INTERAGIR na página 9');
    const quote = 'O Sobrevivente não vira Adereços voltados para baixo durante esse movimento.';
    assert(!target.text.includes(quote), 'o índice real quebra a linha dentro da citação, reproduzindo a rejeição antiga');
    const raw = { language: 'pt-BR', insufficient: false, blocks: [{ kind: 'explanation', text: 'Durante esse movimento, o sobrevivente não vira adereços voltados para baixo.', citations: [{ id: target.id, quote }] }] };
    const reference = validateRuleAnswer(raw, evidence).blocks[0].citations[0];
    assert.equal(reference.page, 15);
    assert.equal(reference.sourceHash, game.documents.rules.manual.sha256);
    assert(target.text.includes(reference.quote), 'a citação entregue é o texto literal do índice');
    raw.blocks[0].citations[0].quote = quote.replace('não vira', 'vira');
    assert.throws(() => validateRuleAnswer(raw, evidence), /citação/, 'omitir a negação continua bloqueado');
    report.push({ anchorPage: page, primaryFirst: order[0].id === 'rules', passageCount: evidence.length, verifiedCitationPage: reference.page, whitespaceRegressionPassed: true, inventedQuoteRejected: true });
  }
  assert.equal(JSON.stringify(order), before, 'índices locais permanecem intactos');
}
await mkdir('test-output/rule-assistant', { recursive: true });
await writeFile('test-output/rule-assistant/real-index-regression.json', JSON.stringify({ simulatedResponse: true, networkCalls: 0, scenarios: report }, null, 2));
console.log('Índices reais de Dead by Daylight: página 15 recuperada, citação com quebras validada e negação inventada bloqueada em quatro cenários. Nenhuma chamada externa.');
