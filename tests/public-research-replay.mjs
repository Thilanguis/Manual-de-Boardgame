import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { wikidata } from '../worker/src/catalog/wikidata.js';
import { wikipedia } from '../worker/src/catalog/wikipedia.js';
import { catalogIO, resetCatalogCache } from '../worker/src/catalog/io.js';
import { validateQuery } from '../worker/src/catalog/index.js';

const archive = JSON.parse(gunzipSync(await readFile(new URL('./fixtures/research-descent-public.json.gz', import.meta.url))));
export const replayStats = { calls: 0, missing: [] };
export async function replayResearch(source, raw) {
  const input = validateQuery(source, raw);
  resetCatalogCache();
  const candidates = await { wikidata, wikipedia }[source](
    input,
    catalogIO(source, {
      interval: 0,
      fetcher: async (url) => {
        const entry = archive.responses.find((r) => r.url === url);
        if (!entry) {
          replayStats.missing.push(url);
          throw new Error('Resposta pública não registrada: ' + url);
        }
        if (createHash('sha256').update(entry.body).digest('hex') !== entry.sha256) throw new Error('Captura alterada: ' + url);
        replayStats.calls++;
        return new Response(entry.body, { status: entry.status, headers: { 'Cache-Control': 'no-store' } });
      },
    }),
  );
  return { candidates, source, diagnostics: input.diagnostics, fetchedAt: Date.now() };
}
