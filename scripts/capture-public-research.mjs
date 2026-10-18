// Diagnóstico opt-in. Somente APIs públicas Wikimedia; nenhum serviço do Acervo.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { wikidata } from '../worker/src/catalog/wikidata.js';
import { wikipedia } from '../worker/src/catalog/wikipedia.js';
import { catalogIO, resetCatalogCache } from '../worker/src/catalog/io.js';
if (process.env.ACERVO_PUBLIC_RESEARCH !== '1') throw new Error('Defina ACERVO_PUBLIC_RESEARCH=1 para consultar exclusivamente APIs públicas.');
const folder = 'test-output/research-descent';
await mkdir(folder, { recursive: true });
let archive;
try {
  archive = JSON.parse(await readFile(`${folder}/public-responses.json`, 'utf8'));
} catch {
  archive = { responses: [] };
}
const io = async (url) => {
  const u = new URL(url);
  if (u.protocol !== 'https:' || !['www.wikidata.org', 'pt.wikipedia.org', 'en.wikipedia.org', 'fr.wikipedia.org', 'de.wikipedia.org'].includes(u.hostname) || u.pathname !== '/w/api.php') throw new Error('Destino bloqueado: ' + u.origin);
  let entry = archive.responses.find((r) => r.url === url);
  if (!entry) {
    const response = await fetch(url, { signal: AbortSignal.timeout(8000), redirect: 'error', headers: { 'User-Agent': 'AcervoResearchAudit/1.0 (https://github.com/Thilanguis/Manual-de-Boardgame)', Accept: 'application/json' } });
    const body = await response.text();
    entry = { url, fetchedAt: new Date().toISOString(), status: response.status, sha256: createHash('sha256').update(body).digest('hex'), body };
    archive.responses.push(entry);
    await writeFile(`${folder}/public-responses.json`, JSON.stringify(archive, null, 2));
    console.log(JSON.stringify({ url, status: response.status, bytes: body.length }));
  }
  return new Response(entry.body, { status: entry.status, headers: { 'Cache-Control': 'no-store' } });
};
const report = [];
for (const query of process.argv.slice(2).length ? process.argv.slice(2) : ['Descent: Lendas da Escuridão', 'Descent: Legends of the Dark']) {
  for (const [source, connector] of Object.entries({ wikidata, wikipedia })) {
    resetCatalogCache();
    const input = { action: 'search', query, pdfLanguage: 'pt-BR', preferredLanguage: 'pt-BR', interactive: true, kind: 'unknown' };
    try {
      const candidates = await connector(input, catalogIO(source, { interval: 0, fetcher: io }));
      report.push({ query, source, candidates, diagnostics: input.diagnostics });
      console.log(JSON.stringify({ query, source, candidates: candidates.map((c) => ({ id: c.id, fields: c.fields, names: c.names })), diagnostics: input.diagnostics }));
    } catch (error) {
      report.push({ query, source, error: error.message, diagnostics: input.diagnostics });
    }
  }
}
await writeFile(`${folder}/${process.env.ACERVO_CAPTURE_LABEL || 'baseline'}.json`, JSON.stringify({ at: new Date().toISOString(), report }, null, 2));
