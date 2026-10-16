import { PROJECT } from './dev-config.mjs';
export async function primeKnowledge() {
  const response = await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'proprietario@acervo.test', password: 'Acervo-teste-123', returnSecureToken: true }),
  });
  const account = await response.json();
  if (!account.idToken) throw new Error('Conta fictícia não foi preparada.');
  const payload = JSON.parse(Buffer.from(account.idToken.split('.')[1], 'base64url'));
  if (payload.aud !== PROJECT) throw new Error('Projeto externo bloqueado.');
  const headers = { Authorization: `Bearer ${account.idToken}`, 'Content-Type': 'application/json' };
  const url = 'http://127.0.0.1:8787/v1/games/10000000-0000-4000-8000-000000000002/knowledge';
  const old = await (await fetch(url, { headers })).json();
  if (old?.knowledge) return;
  if (['failed', 'attention', 'pending_configuration'].includes(old?.status)) {
    console.log('Conhecimento fictício pendente. Use npm run dev:reset para restaurar o seed.');
    return;
  }
  const start = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ requestId: '40000000-0000-4000-8000-000000000001' }) });
  if (!start.ok) throw new Error(`Conhecimento fictício: ${start.status}`);
  for (let i = 0; i < 40; i++) {
    const record = await (await fetch(url, { headers })).json();
    if (record?.knowledge) return;
    if (record?.status && !['running', 'waiting'].includes(record.status)) throw new Error(`Conhecimento fictício: ${record.status} ${record.message || ''}`);
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('Geração fictícia não concluiu.');
}
