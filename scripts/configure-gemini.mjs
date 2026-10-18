// Configuração autorizada, sem habilitar faturamento ou imprimir a chave.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { KNOWLEDGE_MODEL } from '../worker/src/game-knowledge.js';
const require = createRequire(import.meta.url);
const config = JSON.parse(await readFile(resolve(homedir(), '.config/configstore/firebase-tools.json'), 'utf8'));
const token = (await require('../node_modules/firebase-tools/lib/auth.js').getAccessToken(config.tokens.refresh_token, config.loginScopes || config.tokens.scopes)).access_token;
async function google(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(20000) });
  const data = await response.json();
  if (!response.ok) throw new Error(`Google HTTP ${response.status}: ${data.error?.status || 'falha de configuração'}`);
  return data;
}
async function complete(operation, base) {
  for (let i = 0; !operation.done && i < 20; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    operation = await google(`${base}/${operation.name}`);
  }
  if (!operation.done || operation.error) throw new Error('A configuração da API não concluiu. Nenhuma cobrança foi habilitada.');
  return operation.response;
}
const billing = await google('https://cloudbilling.googleapis.com/v1/projects/manual-de-boardgame/billingInfo');
if (billing.billingEnabled !== false) throw new Error('O projeto precisa estar sem faturamento.');
const parent = 'projects/548436978015/locations/global';
const keys = await google(`https://apikeys.googleapis.com/v2/${parent}/keys`);
// Não habilitar Gemini se alguma chave pública sem restrições puder passar a usá-lo.
if ((keys.keys || []).some((key) => !key.restrictions?.apiTargets?.length)) throw new Error('Existe chave sem restrições; configure-a antes de habilitar Gemini.');
await complete(await google('https://serviceusage.googleapis.com/v1/projects/548436978015/services/generativelanguage.googleapis.com:enable', { method: 'POST', body: '{}' }), 'https://serviceusage.googleapis.com/v1');
let key = (keys.keys || []).find((item) => item.displayName === 'Acervo Gemini Worker');
if (!key) key = await complete(await google(`https://apikeys.googleapis.com/v2/${parent}/keys`, { method: 'POST', body: JSON.stringify({ displayName: 'Acervo Gemini Worker', restrictions: { apiTargets: [{ service: 'generativelanguage.googleapis.com' }] } }) }), 'https://apikeys.googleapis.com/v2');
if (key.restrictions?.apiTargets?.length !== 1 || key.restrictions.apiTargets[0].service !== 'generativelanguage.googleapis.com') throw new Error('A chave não está restrita exclusivamente ao Gemini.');
const { keyString } = await google(`https://apikeys.googleapis.com/v2/${key.name}/keyString`);
if (!keyString) throw new Error('O provedor não retornou a chave.');
await mkdir('.secrets', { recursive: true });
await writeFile('.secrets/gemini-api-key.txt', keyString, { mode: 0o600 });
const model = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${KNOWLEDGE_MODEL}`, { headers: { 'x-goog-api-key': keyString }, signal: AbortSignal.timeout(15000) });
console.log(JSON.stringify({ billingEnabled: false, apiRestriction: 'generativelanguage.googleapis.com', modelStatus: model.status, keySavedPrivately: true }));
if (!model.ok) throw new Error('A chave foi criada, mas o modelo ainda não está acessível.');
const child = spawn(process.execPath, ['worker/node_modules/wrangler/bin/wrangler.js', 'secret', 'put', 'GEMINI_API_KEY', '--config', 'worker/wrangler.jsonc'], { stdio: ['pipe', 'inherit', 'inherit'], windowsHide: true });
child.stdin.end(keyString);
const code = await new Promise((r) => child.once('exit', r));
if (code !== 0) throw new Error('Não foi possível cadastrar o secret no Worker. A chave foi preservada no arquivo privado.');
