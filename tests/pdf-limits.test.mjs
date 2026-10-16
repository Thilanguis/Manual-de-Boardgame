import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { APP_CONFIG } from '../config/app-config.js';
import { MAX_PDF_BYTES } from '../js/pdf-limits.js';
import { verifyPdf } from '../js/pdf.js';

test('PDFs até 50 MiB são aceitos; arquivo maior é recusado antes de ler seu conteúdo', async () => {
  assert.equal(MAX_PDF_BYTES, 52428800);
  for (const size of [50 * 1024 * 1024 - 1, MAX_PDF_BYTES]) {
    const file = {
      size,
      slice: (begin, end) => {
        assert.equal(begin, 0);
        assert.equal(end, 1024);
        return new Blob(['%PDF-1.7']);
      },
    };
    await verifyPdf(file, APP_CONFIG.maxPdfBytes);
  }
  await assert.rejects(verifyPdf({ size: MAX_PDF_BYTES + 1, slice: () => assert.fail('Não deve ler o arquivo recusado') }), /50 MiB/);
  await assert.rejects(verifyPdf(new Blob(['não é PDF'])), /não parece ser um PDF/);
});

test('configuração, fallback do Worker, Firestore e documentos usam o mesmo limite', async () => {
  assert.equal(APP_CONFIG.maxPdfBytes, MAX_PDF_BYTES);
  const source = async (file) => readFile(new URL(`../${file}`, import.meta.url), 'utf8');
  assert.match(await source('worker/wrangler.jsonc'), /"MAX_PDF_BYTES":\s*"52428800"/);
  assert.match(await source('worker/src/index.js'), /env.MAX_PDF_BYTES \|\| MAX_PDF_BYTES/);
  assert.equal((await source('firestore.rules')).match(/size <= 52428800/g)?.length, 2);
  assert.match(await source('js/document-repository.js'), /MAX_PDF_READ_BYTES/);
  for (const file of ['js/document-panel.js']) {
    const content = await source(file);
    assert.match(content, /MAX_PDF_BYTES/);
    assert.doesNotMatch(content, /52428800/);
  }
});
