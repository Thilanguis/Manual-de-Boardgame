import { ApiError, permissions } from './auth.js';
import { requirePermission } from './services.js';
import { manualPassages } from './manual-knowledge.js';
import { synthesizePublicKnowledge, validateSynthesis, knowledgeFields } from './game-knowledge.js';
import { validateProfile } from '../../js/profile-facts.js';

const json = (v, status = 200) => Response.json(v, { status, headers: { 'Cache-Control': 'no-store' } });
const digest = async (v) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(v)))), (b) => b.toString(16).padStart(2, '0')).join('');
export const draftContextKey = (uid, sources) => digest(['draft-profile-v1', uid, sources.map((s) => s.sourceHash).sort()]);
export const evidenceFingerprint = (sources) => digest(sources.map((s) => [s.sourceHash, s.pages.map((p) => [p.page, p.text.trim()])]).sort((a, b) => a[0].localeCompare(b[0])));

function draftSources(input) {
  if (!input || !Array.isArray(input.documents) || !input.documents.length || input.documents.length > 12 || typeof input.title !== 'string' || input.title.length > 160 || typeof input.edition !== 'string' || input.edition.length > 100)
    throw new ApiError(400, 'Revise os dados dos manuais.');
  let total = 0;
  const ids = new Set();
  return input.documents.map((d, i) => {
    if (!d || !/^(main|[a-f0-9-]{36})$/.test(d.id) || ids.has(d.id) || !/^[a-f0-9]{64}$/.test(d.hash || '') || !Array.isArray(d.pages) || !d.pages.length || d.pages.length > 1200 || String(d.name || '').length > 160)
      throw new ApiError(400, 'Documento inválido para análise.');
    ids.add(d.id);
    const pages = d.pages.map((p, n) => {
      if (p.page !== n + 1 || typeof p.text !== 'string' || p.text.length > 30000) throw new ApiError(400, 'Páginas inválidas para análise.');
      total += p.text.length;
      if (total > 200000) throw new ApiError(413, 'Os manuais excedem o limite de texto da geração. Nenhuma página foi omitida.');
      return { page: p.page, text: p.text.trim() };
    });
    return {
      id: `manual-${i + 1}`,
      name: String(d.name || 'Manual'),
      documentId: d.id,
      sourceHash: d.hash,
      language: ['pt-BR', 'en', 'fr', 'es', 'other'].includes(d.language) ? d.language : 'other',
      scope: 'edition-confirmed',
      license: 'Manual fornecido pelo proprietário',
      url: '',
      pageCount: pages.length,
      pages,
      incompletePages: pages.filter((p) => p.text.length < 40).map((p) => p.page),
      facts: {},
      fetchedAt: Date.now(),
      documentType: d.documentType || 'principal',
      edition: typeof d.edition === 'string' ? d.edition.slice(0, 100) : '',
      profileEligible: d.documentType !== 'expansao' && !(input.edition && d.edition && input.edition !== d.edition),
    };
  });
}
const binding = (env) => env.GAME_KNOWLEDGE.get(env.GAME_KNOWLEDGE.idFromName(env.FIREBASE_PROJECT_ID));
const send = (stub, key, path, data) => stub.fetch(new Request(`https://knowledge.internal${path}`, data ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key, ...data }) } : undefined));
const visible = (record) => {
  if (!record) return record;
  const { lease, requestId, expires, ...safe } = record;
  if (safe.knowledge) safe.knowledge = { ...safe.knowledge, fields: knowledgeFields(safe.knowledge) };
  return safe;
};

// Rascunho privado por conta/hash. O texto do cliente jamais vira conhecimento
// definitivo sem comparação integral com os índices autorizados do Drive.
export async function draftKnowledgeEndpoint(request, env, identity, input, ctx) {
  const rights = permissions(identity.profile, identity.uid, env.OWNER_UID);
  if (!rights.add && !rights.edit) throw new ApiError(403, 'Sua conta não pode analisar manuais para cadastro.');
  if (!env.GAME_KNOWLEDGE || !env.GEMINI_API_KEY) return json({ status: 'pending_configuration', knowledge: null, message: 'A análise da ficha aguarda a configuração da IA.' });
  if (env.ALLOW_MANUAL_AI !== 'true') return json({ status: 'pending_authorization', knowledge: null, message: 'A análise dos manuais aguarda autorização.' });
  const sources = draftSources(input),
    key = await draftContextKey(identity.uid, sources),
    fingerprint = await evidenceFingerprint(sources),
    stub = binding(env);
  const existing = await (await send(stub, key, `/?key=${key}`)).json();
  if (existing && (!input.retry || existing.status === 'ready' || existing.status === 'running' || existing.retryAt > Date.now())) return json(visible(existing), existing.status === 'quota' ? 429 : 200);
  if (!/^[a-f0-9-]{36}$/i.test(input.requestId || '')) throw new ApiError(400, 'Identificador da análise inválido.');
  const claim = await send(stub, key, '/claim', { requestId: input.requestId, force: !!input.retry });
  const claimed = await claim.json();
  if (!claim.ok || !claimed.claimed) return json(visible(claimed.record || claimed), claim.status);
  const task = (async () => {
    try {
      const knowledge = await synthesizePublicKnowledge({ id: 'draft', title: input.title, edition: input.edition }, sources, env);
      await requirePermission(env, identity, rights.edit ? 'edit' : 'add');
      await send(stub, key, '/finish', { lease: claimed.record.lease, status: 'ready', knowledge: { ...knowledge, draft: true, ownerUid: identity.uid, evidenceFingerprint: fingerprint } });
    } catch (error) {
      await send(stub, key, '/finish', { lease: claimed.record.lease, status: error.status === 429 ? 'quota' : 'attention', reason: error.reason || '', message: error instanceof ApiError ? error.message : 'Não foi possível analisar o manual.' });
    }
  })();
  ctx?.waitUntil?.(task);
  await task;
  return json(visible(await (await send(stub, key, `/?key=${key}`)).json()));
}

export async function reusableDraftKnowledge(game, sources, env) {
  if (!game.createdBy || !env.GAME_KNOWLEDGE) return null;
  const key = await draftContextKey(game.createdBy, sources),
    draft = await (await send(binding(env), key, `/?key=${key}`)).json();
  if (draft?.status !== 'ready' || draft.knowledge?.ownerUid !== game.createdBy || draft.knowledge.evidenceFingerprint !== (await evidenceFingerprint(sources))) return null;
  const saved = draft.knowledge;
  const rebind = (item) => {
    const old = saved.sources.find((s) => s.id === item.sourceId),
      current = sources.find((s) => s.sourceHash === old?.sourceHash);
    const page = current?.pages.find((p) => p.page === item.page);
    const passage = page && manualPassages(page, current.id).find((p) => p.text === item.quote);
    return current && passage ? { ...item, sourceId: current.id, documentId: current.documentId, sourceHash: current.sourceHash, evidenceId: passage.id } : item;
  };
  // Revalidação das citações contra os índices lidos do Drive, nunca contra o cliente.
  const clean = validateSynthesis({ language: saved.language, sections: saved.sections.map(rebind), unconfirmed: saved.unconfirmed }, sources);
  return {
    ...saved,
    ...clean,
    profile: validateProfile(Object.fromEntries(Object.entries(saved.profile || {}).map(([k, v]) => [k, rebind(v)])), sources, manualPassages),
    sources,
    gameId: game.id,
    title: game.title,
    edition: game.edition || '',
    draft: false,
  };
}
