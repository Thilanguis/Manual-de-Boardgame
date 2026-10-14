// Configuração do repositório explicitamente indicado pelo proprietário.
// Credencial existente do Git Credential Manager é usada em memória; nunca impressa.
import { spawnSync } from 'node:child_process';
const repo = 'Thilanguis/Manual-de-Boardgame';
const args = new Set(process.argv.slice(2));
const git = process.env.ACERVO_GIT || 'git';
const credential = spawnSync(git, ['credential', 'fill'], { input: 'protocol=https\nhost=github.com\n\n', encoding: 'utf8', windowsHide: true, timeout: 30000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' } });
const password = /^password=(.+)$/m.exec(credential.stdout || '')?.[1]?.trim();
if (!password || credential.status !== 0) throw new Error('A sessão GitHub local não está disponível. Autentique o Git Credential Manager para publicar Pages.');
async function call(path, method = 'GET', body) {
  const response = await fetch(`https://api.github.com/repos/${repo}${path}`, {
    method,
    headers: { Authorization: `Bearer ${password}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok && response.status !== 404) throw new Error(`GitHub retornou ${response.status} para ${method} ${path || 'repositório'}.`);
  return { status: response.status, data };
}
const metadata = await call('');
if (metadata.status !== 200 || metadata.data.full_name !== repo || metadata.data.private || !metadata.data.permissions?.admin) throw new Error('O repositório público autorizado não foi confirmado com permissão administrativa.');
let pages = await call('/pages');
if (args.has('--configure')) {
  if (pages.status === 404) await call('/pages', 'POST', { build_type: 'workflow' });
  else if (pages.data.build_type !== 'workflow') await call('/pages', 'PUT', { build_type: 'workflow' });
  pages = await call('/pages');
}
if (args.has('--dispatch')) await call('/actions/workflows/pages.yml/dispatches', 'POST', { ref: 'main' });
console.log(
  JSON.stringify({ repository: metadata.data.html_url, defaultBranch: metadata.data.default_branch, pages: pages.status === 200 ? { url: pages.data.html_url, status: pages.data.status, buildType: pages.data.build_type } : 'ainda não ativado' }),
);
const runs = await call('/actions/workflows/pages.yml/runs?per_page=1');
if (runs.status === 200) console.log(JSON.stringify(runs.data.workflow_runs?.map(({ id, status, conclusion, html_url }) => ({ id, status, conclusion, url: html_url }))));
