// Integração deliberada: --gemini envia o texto do PDF escolhido ao provedor gratuito.
// Não executado por npm test. Não acessa Firebase/Drive nem publica conteúdo.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { browserDependencies } from './browser-dependencies.mjs';
import { synthesizePublicKnowledge } from '../worker/src/game-knowledge.js';
import { indexMatches } from '../js/pdf-index.js';
const pdfPath = process.env.ACERVO_REAL_PDF;
if (!pdfPath) throw new Error('Informe ACERVO_REAL_PDF.');
const bytes = await readFile(pdfPath), hash = createHash('sha256').update(bytes).digest('hex');
const root = resolve('.');
let index;
try {
  const saved = JSON.parse(await readFile(`.secrets/manual-validation/${hash}-index.json`, 'utf8'));
  if (indexMatches(saved, { id: 'manual-validation', documentId: 'main', manual: { sha256: hash } }) && saved.analysisComplete !== false && saved.pages.every((p) => p.text.trim().length >= 40 || p.ocrStatus)) index = saved;
} catch { /* Uma primeira análise continua necessária. */ }
const reusedIndex = !!index;
if (!index) {
const server = createServer(async (request, response) => {
  const path = new URL(request.url, 'http://localhost').pathname;
  if (path === '/') { response.writeHead(200, { 'Content-Type': 'text/html' }); response.end('<p>Validação local do manual</p>'); return; }
  if (path === '/fixture.pdf') { response.writeHead(200, { 'Content-Type': 'application/pdf' }); response.end(bytes); return; }
  try {
    const file = resolve(root, '.' + decodeURIComponent(path));
    if (!file.startsWith(root + sep) || !/^\/(?:js|vendor)\//.test(path)) throw new Error();
    response.writeHead(200, { 'Content-Type': /\.m?js$/.test(path) ? 'application/javascript' : 'application/octet-stream' });
    response.end(await readFile(file));
  } catch { response.writeHead(404); response.end(); }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const { chromium } = browserDependencies('playwright');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage();
  const base = `http://127.0.0.1:${server.address().port}`;
  await page.route('**/*', (route) => route.request().url().startsWith(base) ? route.continue() : route.abort());
  await page.goto(base);
  index = await page.evaluate(async ({ hash, ocr }) => {
    const { analyzePdf } = await import('/js/pdf-index.js');
    const { extendOcrIndex, pendingOcrPages } = await import('/js/pdf-knowledge.js');
    const blob = await (await fetch('/fixture.pdf')).blob();
    const game = { id: 'manual-validation', title: 'Manual escolhido para validação', language: 'pt-BR', documentId: 'main', manual: { sha256: hash } };
    let result = await analyzePdf(blob, game);
    if (ocr && pendingOcrPages(result).length) result = await extendOcrIndex(blob, game, result);
    return result;
  }, { hash, ocr: process.argv.includes('--ocr') });
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
}
const name = /resident/i.test(pdfPath) ? 'Resident Evil' : 'Sina da Sociedade';
await mkdir('.secrets/manual-validation', { recursive: true });
await writeFile(`.secrets/manual-validation/${hash}-index.json`, JSON.stringify(index));
const report = { title: name, pages: index.pageCount, reusedIndex, readablePages: index.pages.filter((p) => p.text.trim().length >= 40).length, ocrPages: index.pages.filter((p) => p.ocrStatus).length, characters: index.pages.reduce((n, p) => n + p.text.length, 0) };
if (process.argv.includes('--gemini')) {
  if (index.pages.some((p) => p.text.trim().length < 40 && !p.ocrStatus)) throw new Error('Há páginas pendentes; o manual não será enviado incompleto.');
  const source = { id: 'manual-1', name: `Manual de ${name}`, language: 'pt-BR', scope: 'edition-confirmed', license: 'Manual fornecido pelo proprietário', url: '', documentId: 'main', sourceHash: hash, pageCount: index.pageCount, pages: index.pages.map(({ page, text }) => ({ page, text })), facts: {} };
  const capture = async (url, options) => {
    const response = await fetch(url, options);
    if (response.ok) await writeFile(`.secrets/manual-validation/${hash}-provider.json`, await response.clone().text());
    return response;
  };
  const knowledge = await synthesizePublicKnowledge({ title: name, edition: 'Manual PT-BR fornecido', id: 'manual-validation' }, [source], { GEMINI_API_KEY: (await readFile('.secrets/gemini-api-key.txt', 'utf8')).trim() }, capture);
  await writeFile(`.secrets/manual-validation/${hash}-knowledge.json`, JSON.stringify(knowledge));
  report.sections = knowledge.sections.length;
  report.referencedPages = [...new Set(knowledge.sections.map((s) => s.page))];
  report.model = knowledge.model;
}
console.log(JSON.stringify(report));
