import '../scripts/test-guard.mjs';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { realIndex } from './real-index-fixture.mjs';
import { selectRuleEvidence, validateRuleAnswer } from '../worker/src/rule-assistant.js';
import { textQuality } from '../js/text-quality.js';
const cases = [
  ['Senhor dos aneis DUEL.pdf', 'Como funciona o turno?', 3],
  ['resident_evil pt-BR.pdf', 'Como atacar um inimigo?', 8],
  ['dead_by_daylight_sem_perda_20paginas.pdf', 'Como atacar?', 14],
  ['ZCD001-EN-Rulebook.pdf', 'Como atacar?', 21],
];
const report = [];
for (const [pdf, question, page] of cases) {
  const index = await realIndex(pdf),
    original = JSON.stringify(index);
  const sha256 = createHash('sha256')
    .update(await readFile('PDFs/' + pdf))
    .digest('hex');
  assert.equal(index.sourceHash, sha256);
  const game = { id: index.gameId, title: pdf, manual: { sha256, pages: index.pageCount, name: pdf } };
  const sources = [{ id: 'manual-1', name: pdf, sourceHash: sha256, documentId: 'main', documentType: 'principal', pages: index.pages.filter((p) => textQuality(p.text).readable) }];
  const selected = selectRuleEvidence(game, sources, { documentId: 'main', sourceHash: sha256, page }, question);
  assert(selected.evidence.length <= 12);
  assert(
    selected.evidence.some((e) => e.page === page),
    pdf + ': preserva a página contextual',
  );
  const evidence = selected.evidence.find((e) => e.page === page);
  const answer = validateRuleAnswer(
    {
      language: 'pt-BR',
      insufficient: false,
      blocks: [{ kind: 'explanation', text: 'Texto simulado apenas para validar o vínculo de referência; não é uma resposta real do Gemini.', citations: [{ id: evidence.id, quote: evidence.text.slice(0, 120) }] }],
    },
    selected.evidence,
  );
  const ref = answer.blocks[0].citations[0];
  assert.equal(ref.page, page);
  assert.equal(ref.sourceHash, sha256);
  assert(index.pages[page - 1].text.includes(ref.quote));
  assert.equal(JSON.stringify(index), original);
  report.push({ pdf, page, hashVerified: true, selectedPassages: selected.evidence.length, selectedCharacters: selected.evidence.reduce((n, e) => n + e.text.length, 0), quoteFoundLiterally: true, simulatedAnswer: true });
}
await mkdir('test-output/rule-assistant', { recursive: true });
await writeFile('test-output/rule-assistant/real-evidence.json', JSON.stringify(report, null, 2));
console.log('Recuperação do Worker: quatro índices de PDFs reais, hashes e citações literais conferidos; zero chamadas Gemini.');
