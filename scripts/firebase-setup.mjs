// Ferramenta de preparação administrativa. Não entra em public/.
// Reutiliza uma sessão Firebase CLI, sem receber/gravar tokens ou contas de serviço.
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { delimiter, resolve } from 'node:path';
import { APP_CONFIG } from '../config/app-config.js';
import { OWNER_UID } from '../js/permissions.js';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url),
  project = 'manual-de-boardgame';
if (APP_CONFIG.firebase?.projectId !== project) throw new Error('A configuração não corresponde ao projeto autorizado.');
const cliPath = [fileURLToPath(new URL('../node_modules/firebase-tools/lib/auth.js', import.meta.url)), ...process.env.PATH.split(delimiter).map((path) => resolve(path, '..', 'firebase-tools', 'lib', 'auth.js'))].find(existsSync);
if (!cliPath) throw new Error('Execute npm ci, autentique a Firebase CLI e depois use node scripts/firebase-setup.mjs <UID>.');
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
if (uid !== OWNER_UID) throw new Error('Informe o UID exato do administrador no Authentication.');
const users = await request(`https://identitytoolkit.googleapis.com/v1/projects/${project}/accounts:lookup`, { method: 'POST', body: JSON.stringify({ localId: [uid] }) });
if (!users.users?.some((user) => user.localId === uid && !user.disabled)) throw new Error('O UID não corresponde a uma conta ativa neste projeto.');
const documentURL = `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents`;
async function getExisting(path) {
  const response = await fetch(`${documentURL}/${path}`, { headers: { Authorization: `Bearer ${credentials.access_token}` }, signal: AbortSignal.timeout(30000) });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error('Não foi possível conferir o estado existente do projeto.');
  return response.json();
}
const existing = await getExisting(`users/${uid}`),
  library = await getExisting('settings/library'),
  writes = [];
if (existing) {
  if (existing.fields?.role?.stringValue !== 'superadmin' || existing.fields?.uid?.stringValue !== uid) throw new Error('O perfil proprietário existente não é compatível. Revise o documento no Console antes de executar o bootstrap.');
} else {
  const identity = users.users.find((user) => user.localId === uid);
  if (!identity.email) throw new Error('O proprietário precisa ter um e-mail no Authentication.');
  writes.push({
    update: {
      name: `projects/${project}/databases/(default)/documents/users/${uid}`,
      fields: {
        uid: { stringValue: uid },
        name: { stringValue: identity.displayName || 'Proprietário' },
        email: { stringValue: identity.email },
        role: { stringValue: 'superadmin' },
        status: { stringValue: 'approved' },
        permissions: { mapValue: { fields: { approveUsers: { booleanValue: true }, addGames: { booleanValue: true }, editGames: { booleanValue: true }, deleteGames: { booleanValue: true } } } },
        version: { integerValue: '1' },
        lastEventId: { stringValue: '' },
      },
    },
    currentDocument: { exists: false },
    updateTransforms: [
      { fieldPath: 'createdAt', setToServerValue: 'REQUEST_TIME' },
      { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' },
    ],
  });
}
if (!library?.fields?.version) {
  writes.push({
    update: { name: `projects/${project}/databases/(default)/documents/settings/library`, fields: { publicRead: { booleanValue: true }, version: { integerValue: '1' }, lastEventId: { stringValue: '' } } },
    currentDocument: library ? { updateTime: library.updateTime } : { exists: false },
    updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
  });
}
if (writes.length) await request(`${documentURL}:commit`, { method: 'POST', body: JSON.stringify({ writes }) });
console.log(`Proprietário ${uid} preservado e preparado como superadmin no projeto ${project}. Biblioteca pública na migração inicial; execuções posteriores preservam a configuração.`);
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
