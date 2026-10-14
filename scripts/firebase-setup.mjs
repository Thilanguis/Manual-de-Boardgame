// Ferramenta de preparação administrativa. Não entra em public/.
// Reutiliza uma sessão Firebase CLI, sem receber/gravar tokens ou contas de serviço.
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { delimiter, resolve } from 'node:path';
import { APP_CONFIG } from '../config/app-config.js';

const require = createRequire(import.meta.url),
  project = 'manual-de-boardgame';
if (APP_CONFIG.firebase?.projectId !== project) throw new Error('A configuração não corresponde ao projeto autorizado.');
const cliPath = process.env.PATH.split(delimiter)
  .map((path) => resolve(path, '..', 'firebase-tools', 'lib', 'auth.js'))
  .find(existsSync);
if (!cliPath) throw new Error('Execute com npm exec --package firebase-tools -- node scripts/firebase-setup.mjs <UID>.');
const auth = require(cliPath);
const account = auth.getGlobalDefaultAccount();
if (!account?.tokens?.refresh_token) throw new Error('Execute firebase login antes de configurar o projeto.');
const credentials = await auth.getAccessToken(account.tokens.refresh_token, ['https://www.googleapis.com/auth/cloud-platform', 'https://www.googleapis.com/auth/firebase']);
async function request(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { Authorization: `Bearer ${credentials.access_token}`, 'Content-Type': 'application/json', ...options.headers }, signal: AbortSignal.timeout(30000) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${response.status}: ${data.error?.message || 'A configuração do Firebase falhou.'}`);
  return data;
}
const uid = process.argv[2];
if (!uid || !/^[A-Za-z0-9_-]{1,128}$/.test(uid)) throw new Error('Informe o UID exato do administrador no Authentication.');
const users = await request(`https://identitytoolkit.googleapis.com/v1/projects/${project}/accounts:lookup`, { method: 'POST', body: JSON.stringify({ localId: [uid] }) });
if (!users.users?.some((user) => user.localId === uid && !user.disabled)) throw new Error('O UID não corresponde a uma conta ativa neste projeto.');
const documentURL = `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents`;
await request(`${documentURL}/admins/${uid}?updateMask.fieldPaths=enabled`, { method: 'PATCH', body: JSON.stringify({ fields: { enabled: { booleanValue: true } } }) });
await request(`${documentURL}/admins/${uid}?updateMask.fieldPaths=role`, { method: 'PATCH', body: JSON.stringify({ fields: { role: { stringValue: 'admin' } } }) });
await request(`${documentURL}/settings/library?updateMask.fieldPaths=publicRead`, { method: 'PATCH', body: JSON.stringify({ fields: { publicRead: { booleanValue: false } } }) });
console.log(`Administrador ${uid} autorizado no projeto ${project}. Biblioteca privada.`);
// Leitura de configuração, sem modificar faturamento ou serviços com custo.
try {
  const config = await request(`https://identitytoolkit.googleapis.com/admin/v2/projects/${project}/config`);
  console.log(`Login E-mail/Senha: ${config.signIn?.email?.enabled ? 'habilitado' : 'ainda precisa ser habilitado no Console'}.`);
  if (process.argv.includes('--pages-domain')) {
    const authorizedDomains = [...new Set([...(config.authorizedDomains || []), 'thilanguis.github.io'])];
    await request(`https://identitytoolkit.googleapis.com/admin/v2/projects/${project}/config?updateMask=authorizedDomains`, { method: 'PATCH', body: JSON.stringify({ authorizedDomains }) });
    console.log('Domínio thilanguis.github.io autorizado para login, preservando os demais domínios.');
  }
} catch {
  console.log('Não foi possível conferir o provedor de login. Verifique no Console.');
}
