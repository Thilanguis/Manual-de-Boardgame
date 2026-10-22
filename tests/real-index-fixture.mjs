import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
// Exportações locais podem receber o sufixo do sistema ao serem baixadas novamente.
export async function realIndex(pdf) {
  for (const suffix of [' — índice.gz', ' — índice (1).gz']) {
    try {
      return JSON.parse(gunzipSync(await readFile('PDFs/' + pdf + suffix)));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  throw new Error('Índice local não encontrado para ' + pdf);
}
