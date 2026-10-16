import '../scripts/test-guard.mjs';
// Verificação somente de leitura, opt-in. Chama os conectores locais e as APIs públicas, sem Worker publicado.
import { mkdir, writeFile } from 'node:fs/promises';
import { wikidata } from '../worker/src/catalog/wikidata.js';
import { wikipedia } from '../worker/src/catalog/wikipedia.js';
import { catalogIO } from '../worker/src/catalog/io.js';
if (process.env.ACERVO_LIVE_RESEARCH !== '1') throw new Error('Defina ACERVO_LIVE_RESEARCH=1 para autorizar consultas públicas de teste.');
const report = [];
for (const query of ['O Senhor dos Anéis: Sina da Sociedade', 'Colonizadores de Catan', 'Takenoko']) {
  const results = await Promise.all(
    Object.entries({ wikidata, wikipedia }).map(async ([source, connector]) => {
      const input = { action: 'search', query, preferredLanguage: 'pt-BR', pdfLanguage: 'pt-BR', kind: 'unknown', interactive: true, expanded: false };
      const signal = AbortSignal.timeout(4500);
      const io = catalogIO(source, { signal, ttl: 21600000, interval: 0, fetcher: (url, options) => fetch(url, { ...options, signal }) });
      try {
        const candidates = await connector(input, io);
        return {
          source,
          status: input.diagnostics?.complete === false ? 'partial' : 'done',
          count: candidates.length,
          candidates: candidates.map((candidate) => ({ id: candidate.id, title: candidate.fields.title, fields: Object.keys(candidate.fields), url: candidate.url, names: candidate.names, license: candidate.license })),
          diagnostics: input.diagnostics,
        };
      } catch (error) {
        return { source, status: 'error', count: 0, error: error.message, diagnostics: input.diagnostics };
      }
    }),
  );
  report.push({ query, results });
  console.log(JSON.stringify(report.at(-1)));
}
await mkdir('test-output', { recursive: true });
await writeFile('test-output/research-live-1.8.json', JSON.stringify({ checkedAt: new Date().toISOString(), report }, null, 2));
