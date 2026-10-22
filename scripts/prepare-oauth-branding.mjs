// Preparação local apenas: não faz commit, push, deploy ou alterações de conta.
import { cp, mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Última execução Pages bem-sucedida consultada em 21/10/2026.
const baseline = '92e6c6dc0878485caab62ed9d453821d99e0ec53';
const baseUrl = 'https://thilanguis.github.io/Manual-de-Boardgame/';
const pages = ['sobre.html', 'privacidade.html', 'termos.html'];
const overlay = [...pages, 'styles/public-pages.css'];
const allowed = new Set(['index.html', 'service-worker.js', ...overlay]);
const git = (...args) => execFileSync('git', args, { cwd: root, windowsHide: true });
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
function once(source, anchor, replacement) {
  assert(source.split(anchor).length === 2, 'Âncora ausente ou ambígua; interromper a preparação.');
  return source.replace(anchor, replacement);
}
const staging = join(root, '.secrets', 'oauth-branding-2026-10-21');
await mkdir(staging, { recursive: true });
const work = await mkdtemp(join(staging, 'review-'));
const source = join(work, 'baseline');
const output = join(work, 'public');
await mkdir(source);
const archive = join(work, 'baseline.tar');
// Extrai somente fontes estáticas do commit publicado; nunca o workspace atual.
git('archive', '--format=tar', '--output=' + archive, baseline, 'index.html', 'styles', 'js', 'assets', 'vendor', 'config/app-config.js', 'manifest.webmanifest', 'service-worker.js', 'scripts/build.mjs');
execFileSync('tar', ['-xf', archive, '-C', source], { windowsHide: true });
execFileSync(process.execPath, [join(source, 'scripts/build.mjs')], { cwd: source, windowsHide: true });
const originalPublic = join(source, 'public');
await cp(originalPublic, output, { recursive: true });
for (const path of overlay) {
  await mkdir(dirname(join(output, path)), { recursive: true });
  await cp(join(root, path), join(output, path));
}
const originalHtml = await readFile(join(originalPublic, 'index.html'), 'utf8');
const eol = originalHtml.includes('\r\n') ? '\r\n' : '\n';
const footer = ['      <a href="sobre.html">Sobre o Acervo</a>', '      <a href="privacidade.html">Política de privacidade</a>', '      <a href="termos.html">Termos de uso</a>'].join(eol) + eol;
const navigation =
  ['      <nav class="dialog-body" aria-label="Informações públicas do Acervo">', '        <a href="sobre.html">Sobre o Acervo</a> · <a href="privacidade.html">Privacidade</a> · <a href="termos.html">Termos de uso</a>', '      </nav>'].join(eol) +
  eol;
let html = once(originalHtml, '      <a id="bgg-attribution"', footer + '      <a id="bgg-attribution"');
const accountEnd = '        <button class="button secondary full logout-button" id="logout-button">Sair da conta</button>' + eol + '      </div>' + eol;
html = once(html, accountEnd, accountEnd + navigation);
assert(html.replace(footer, '').replace(navigation, '') === originalHtml, 'O HTML mudou além dos links.');
await writeFile(join(output, 'index.html'), html);

const originalSw = await readFile(join(originalPublic, 'service-worker.js'), 'utf8');
const swEol = originalSw.includes('\r\n') ? '\r\n' : '\n';
const version = /^const VERSION = '[^']+';/m.exec(originalSw)?.[0];
assert(version, 'Versão do cache não encontrada.');
const relativeLine = "  const relative = './' + url.pathname.slice(new URL('./', self.registration.scope).pathname.length);";
const bypass = swEol + '  // Páginas públicas têm documento próprio; não devolver o index da biblioteca.' + swEol + "  if (['./sobre.html', './privacidade.html', './termos.html'].includes(relative)) return;";
let sw = once(originalSw, version, "const VERSION = 'acervo-v1.11.0-oauth-branding-32';");
sw = once(sw, relativeLine, relativeLine + bypass);
assert(sw.replace(bypass, '').replace("const VERSION = 'acervo-v1.11.0-oauth-branding-32';", version) === originalSw, 'Service worker mudou além da versão e das três rotas públicas.');
await writeFile(join(output, 'service-worker.js'), sw);

async function inventory(folder, prefix = '') {
  const result = {};
  for (const entry of await readdir(join(folder, prefix), { withFileTypes: true })) {
    const path = prefix ? prefix + '/' + entry.name : entry.name;
    assert(!entry.isSymbolicLink(), 'Links simbólicos não são permitidos no pacote.');
    if (entry.isDirectory()) Object.assign(result, await inventory(folder, path));
    else result[path] = hash(await readFile(join(folder, path)));
  }
  return result;
}
const before = await inventory(originalPublic),
  after = await inventory(output);
const changed = Object.keys(after).filter((path) => before[path] !== after[path]);
assert(changed.length === allowed.size && changed.every((path) => allowed.has(path)), 'Pacote contém mudanças fora do escopo.');
assert(
  Object.keys(before).every((path) => path in after),
  'Arquivo publicado foi removido do pacote.',
);
for (const page of pages) {
  const content = await readFile(join(output, page), 'utf8');
  assert(!/<(?:script|iframe|form)\b/i.test(content), 'Página institucional contém recurso ativo.');
  assert(!/mailto:|[\w.+-]+@[\w.-]+\.[a-z]{2,}/i.test(content), 'E-mail público ainda não autorizado.');
}
const manifest = {
  status: 'PREPARADO LOCALMENTE — NÃO PUBLICADO',
  baselineCommit: baseline,
  baselineRun: 'https://github.com/Thilanguis/Manual-de-Boardgame/actions/runs/39373676124',
  baseUrl,
  changed: changed.map((path) => ({ path, previousSha256: before[path] || null, sha256: after[path] })),
  unchangedFiles: Object.keys(before).length - 2,
  supportContact: 'Pendente: criar endereço exclusivo, sem publicar e-mail pessoal.',
  urls: pages.map((path) => baseUrl + path),
  protectedFilesIdentical: ['config/app-config.js', ...Object.keys(before).filter((path) => path.startsWith('js/'))].every((path) => before[path] === after[path]),
  publicationPrecondition: 'Reconfirmar a versão ativa do Pages e revisar o pacote antes de solicitar publicação. Não publicar o build do workspace.',
};
await writeFile(join(work, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
execFileSync('tar', ['-cf', join(work, 'pages-artifact.tar'), '-C', output, '.'], { windowsHide: true });
console.log(JSON.stringify({ directory: work, changed, unchangedFiles: manifest.unchangedFiles, published: false }, null, 2));
