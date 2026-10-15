import { linesFromItems, titleCandidates, extractMetadata } from './recognition.js';

let library;
export async function pdfLibrary() {
  if (!library)
    library = import('../vendor/pdfjs/pdf.mjs').then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdfjs/pdf.worker.mjs', import.meta.url).href;
      return pdfjs;
    });
  return library;
}

export async function loadPdf(blob) {
  const pdfjs = await pdfLibrary();
  return pdfjs.getDocument({
    data: new Uint8Array(await blob.arrayBuffer()),
    cMapUrl: new URL('../vendor/pdfjs/cmaps/', import.meta.url).href,
    cMapPacked: true,
    standardFontDataUrl: new URL('../vendor/pdfjs/standard_fonts/', import.meta.url).href,
    wasmUrl: new URL('../vendor/pdfjs/wasm/', import.meta.url).href,
    isEvalSupported: false,
  }).promise;
}
export async function loadRemotePdf(source) {
  const pdfjs = await pdfLibrary();
  return pdfjs.getDocument({
    url: source.url,
    httpHeaders: source.headers,
    rangeChunkSize: 256 * 1024,
    disableAutoFetch: true,
    disableStream: true,
    isEvalSupported: false,
    cMapUrl: new URL('../vendor/pdfjs/cmaps/', import.meta.url).href,
    cMapPacked: true,
    standardFontDataUrl: new URL('../vendor/pdfjs/standard_fonts/', import.meta.url).href,
    wasmUrl: new URL('../vendor/pdfjs/wasm/', import.meta.url).href,
  }).promise;
}
export async function imageToJpeg(blob) {
  const bitmap = await createImageBitmap(blob),
    canvas = document.createElement('canvas'),
    scale = Math.min(1, 1400 / Math.max(bitmap.width, bitmap.height));
  canvas.width = Math.ceil(bitmap.width * scale);
  canvas.height = Math.ceil(bitmap.height * scale);
  const context = canvas.getContext('2d');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const image = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
  canvas.width = canvas.height = 0;
  if (!image) throw new Error('Não foi possível preparar esta capa. Escolha outra imagem.');
  return image;
}

export async function verifyPdf(file, maxBytes) {
  if (!file || file.size === 0 || file.size > maxBytes) throw new Error(`Selecione um PDF de até ${Math.round(maxBytes / 1024 / 1024)} MB.`);
  const header = new TextDecoder().decode(await file.slice(0, 1024).arrayBuffer());
  if (!header.includes('%PDF-')) throw new Error('Este arquivo não parece ser um PDF válido.');
}

export async function inspectPdf(file, { maxBytes, onProgress = () => {}, signal } = {}) {
  await verifyPdf(file, maxBytes);
  onProgress('Abrindo o PDF…');
  const pdf = await loadPdf(file);
  try {
    const metadata = await pdf.getMetadata().catch(() => ({ info: {} }));
    let firstLines = [],
      text = '';
    const pageTexts = [];
    const count = Math.min(pdf.numPages, 12);
    for (let pageNumber = 1; pageNumber <= count; pageNumber++) {
      signal?.throwIfAborted();
      onProgress(`Lendo página ${pageNumber} de ${count}…`);
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const lines = linesFromItems(content.items);
      if (pageNumber === 1) firstLines = lines;
      const pageText = lines.map((line) => line.text).join('\n');
      pageTexts.push(pageText);
      text += '\n' + pageText;
      if (text.length > 80000) break;
    }
    signal?.throwIfAborted();
    onProgress('Preparando a capa do manual…');
    const page = await pdf.getPage(1);
    const original = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: Math.min(1.5, 900 / original.width) });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await page.render({ canvasContext: canvas.getContext('2d'), viewport, background: '#ffffff' }).promise;
    const coverBlob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.87));
    canvas.width = canvas.height = 0;
    const hash = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
    const candidates = titleCandidates({ metadataTitle: metadata.info?.Title, filename: file.name, lines: firstLines });
    const fields = extractMetadata(text);
    if (fields.language === 'other' && /(?:^|[_\s\[])pt[-_ ]?br(?:\b|_)/i.test(metadata.info?.Title + ' ' + file.name)) {
      fields.language = 'pt-BR';
      fields.sources.language = { source: 'PDF · idioma explícito no nome/metadados; confirmar', excerpt: file.name };
    }
    for (const value of Object.values(fields.sources)) {
      const found = pageTexts.findIndex((page) =>
        page
          .replace(/[‐‑–—]/g, '-')
          .replace(/\s+/g, ' ')
          .includes(value.excerpt.replace(/\s+/g, ' ')),
      );
      if (found >= 0) value.page = found + 1;
    }
    if (fields.sources.originalTitle && !candidates.some((c) => c.text === fields.sources.originalTitle.excerpt)) candidates.push({ text: fields.sources.originalTitle.excerpt, source: 'PDF · título original explícito' });
    return {
      ...fields,
      title: candidates[0]?.text || '',
      candidates,
      coverBlob,
      cover: { kind: 'pdf', url: '' },
      sources: { ...fields.sources, title: { source: candidates[0]?.source || 'Revisão necessária', excerpt: candidates[0]?.text || '' }, cover: { source: 'Primeira página do PDF', excerpt: 'Imagem renderizada do seu manual.' } },
      manual: { name: file.name, size: file.size, pages: pdf.numPages, sha256: Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join(''), type: 'application/pdf' },
      textFound: text.trim().length > 40,
    };
  } finally {
    await pdf.destroy();
  }
}
