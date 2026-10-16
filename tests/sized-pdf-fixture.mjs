// Acrescenta um stream não utilizado a uma cópia; nunca modifica o original.
import assert from 'node:assert/strict';
import { open, stat } from 'node:fs/promises';
export async function writeSizedPdf(document, path, target) {
  document.context.register(document.context.stream(new Uint8Array(), { UploadFixture: true }));
  const source = Buffer.from(await document.save({ useObjectStreams: false })),
    text = source.toString('latin1'),
    match = /startxref\s+(\d+)\s+%%EOF\s*$/.exec(text),
    xref = Number(match[1]),
    start = text.indexOf('stream\n', text.indexOf('/UploadFixture true')) + 7;
  let pad = target - source.length;
  assert(pad > 0);
  for (let n = 0; n < 5; n++) {
    const delta = String(pad).length - 1;
    pad = target - source.length - delta - (String(xref + pad + delta).length - match[1].length);
  }
  const prefix = Buffer.from(text.slice(0, start).replace(/\/Length 0(?=\s*>>\s*stream\s*$)/, `/Length ${pad}`), 'latin1'),
    tail = Buffer.from(text.slice(start).replace(/startxref\s+\d+/, `startxref\n${xref + pad + prefix.length - start}`), 'latin1');
  const output = await open(path, 'w');
  try {
    await output.write(prefix);
    const chunk = Buffer.alloc(1024 * 1024);
    for (let left = pad; left > 0; left -= chunk.length) await output.write(chunk.subarray(0, Math.min(chunk.length, left)));
    await output.write(tail);
  } finally {
    await output.close();
  }
  assert.equal((await stat(path)).size, target);
}
