// Diagnóstico e backup somente leitura. Tokens nunca são impressos ou salvos no projeto.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const root = resolve('.secrets/deployment-2026-10-17');
await mkdir(root, { recursive: true });
async function backup(name, data) {
  try { await writeFile(resolve(root, name), JSON.stringify(data, null, 2), { flag: 'wx' }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
}
const config = JSON.parse(await readFile(resolve(homedir(), '.config/configstore/firebase-tools.json'), 'utf8'));
const token = (await require('../node_modules/firebase-tools/lib/auth.js').getAccessToken(config.tokens.refresh_token, config.loginScopes || config.tokens.scopes)).access_token;
async function google(url) {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Google: HTTP ${response.status} em ${new URL(url).pathname}`);
  return response.json();
}
const project = 'manual-de-boardgame', owner = '7TitBObtb8a0W8GisSstSM1RHiX2';
const profile = await google(`https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents/users/${owner}`);
const activeOwner = profile.fields?.uid?.stringValue === owner && profile.fields?.role?.stringValue === 'superadmin' && profile.fields?.status?.stringValue === 'approved';
if (!activeOwner) throw new Error('Perfil proprietário não está íntegro. Publicação interrompida.');
const release = await google(`https://firebaserules.googleapis.com/v1/projects/${project}/releases/cloud.firestore`);
const rules = await google(`https://firebaserules.googleapis.com/v1/${release.rulesetName}`);
await backup('firestore-rules-before.json', { release, rules });
const billing = await google(`https://cloudbilling.googleapis.com/v1/projects/${project}/billingInfo`).catch(() => ({ billingEnabled: null }));
const wrangler = await readFile(resolve(homedir(), 'AppData/Roaming/xdg.config/.wrangler/config/default.toml'), 'utf8');
const cloudToken = wrangler.match(/^oauth_token\s*=\s*"([^"]+)"/m)?.[1];
if (!cloudToken) throw new Error('Login Cloudflare indisponível.');
async function cloud(path) {
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/0052bca2e9fdcfca50f9f43d02ba7997/${path}`, { headers: { Authorization: `Bearer ${cloudToken}` }, signal: AbortSignal.timeout(15000) });
  const data = await response.json();
  if (!response.ok || !data.success) throw new Error(`Cloudflare HTTP ${response.status}: ${path}`);
  return data.result;
}
const subscriptions = await cloud('subscriptions').catch(() => null);
const versions = await cloud('workers/scripts/acervo-drive-api/deployments');
await backup('worker-deployments-before.json', versions);
const summary = { project, activeOwner, billingEnabled: billing.billingEnabled,
  cloudflareSubscriptions: subscriptions?.map((s) => ({ plan: s.rate_plan?.id, name: s.rate_plan?.public_name, price: s.price, state: s.state })),
  rulesetBefore: release.rulesetName, backup: root };
await backup('preflight.json', summary);
console.log(JSON.stringify(summary, null, 2));
