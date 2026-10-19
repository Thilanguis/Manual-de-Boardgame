import { ApiError, permissions } from './auth.js';
import { requirePermission } from './services.js';
import { manualPassages } from './manual-knowledge.js';
import { synthesizePublicKnowledge, validateSynthesis, knowledgeFields, collectProfileKnowledge } from './game-knowledge.js';
import { extractPageMetadata } from '../../js/recognition.js';
import { validateProfile, profileCoverageComplete, combinedProfileComplete } from '../../js/profile-facts.js';
import { recontextualizeDraft } from '../../js/draft-reuse.js';
import { textQuality } from '../../js/text-quality.js';
import { checkManualText, checkKnowledgeSources } from './knowledge-limits.js';

const json = (v, status = 200) => Response.json(v, { status, headers: { 'Cache-Control': 'no-store' } });
const digest = async (v) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(v)))), (b) => b.toString(16).padStart(2, '0')).join('');
export const draftContextKey = (uid, sources) =>
  digest([
    'draft-profile-v1',
    uid,
    sources
      .filter((s) => s.pages)
      .map((s) => s.sourceHash)
      .sort(),
  ]);
export const evidenceFingerprint = (sources) =>
  digest(
    sources
      .filter((s) => s.pages)
      .map((s) => [s.sourceHash, s.pages.map((p) => [p.page, p.text.trim()])])
      .sort((a, b) => a[0].localeCompare(b[0])),
  );

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
      checkManualText(total);
      return { page: p.page, text: p.text.trim() };
    });
    const metadata = extractPageMetadata(pages);
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
      incompletePages: pages.filter((p) => !textQuality(p.text).readable).map((p) => p.page),
      facts: Object.fromEntries(
        ['minPlayers', 'maxPlayers', 'minDurationMinutes', 'maxDurationMinutes', 'durationMinutes', 'recommendedAge', 'tags', 'mechanics', 'gameType']
          .filter((key) => metadata[key] != null && metadata[key] !== '' && (!Array.isArray(metadata[key]) || metadata[key].length))
          .map((key) => [key, metadata[key]]),
      ),
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
  const { lease, requestId, expires, profileBudgetReserved, ...safe } = record;
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
  const sources = draftSources(input);
  checkKnowledgeSources(sources);
  if (!sources.some((s) => s.pages.some((p) => manualPassages(p, s.id).length)) && !(input.includePublic === true && input.title.trim().length >= 2))
    return json({ status: 'attention', knowledge: null, message: 'Não há texto legível suficiente para a IA. Recupere as páginas por OCR local; nenhuma geração foi iniciada.' });
  const key = await draftContextKey(identity.uid, sources),
    fingerprint = await evidenceFingerprint(sources),
    stub = binding(env);
  const existing = await (await send(stub, key, `/?key=${key}`)).json();
  const cachedContext =
    existing &&
    recontextualizeDraft(
      existing,
      input,
      sources.map((s) => ({ ...s, id: s.documentId })),
    );
  const profileValid =
    !!cachedContext?.knowledge &&
    (input.includePublic === true ? combinedProfileComplete(existing?.knowledge, 3) : profileCoverageComplete(existing?.knowledge)) &&
    existing?.knowledge &&
    (Object.keys(validateProfile(existing.knowledge.profile, existing.knowledge.sources || [])).length > 0 ||
      (existing.knowledge.profileAnalysis?.version >= 2 && existing.knowledge.profileAnalysis?.complete === true && !!existing.knowledge.profile && !Object.keys(existing.knowledge.profile).length));
  if (existing && (!input.retry || (existing.status === 'ready' && profileValid) || existing.status === 'running' || existing.retryAt > Date.now())) {
    if (existing.knowledge && existing.knowledge.evidenceFingerprint !== fingerprint)
      return json({ status: 'evidence_changed', knowledge: null, analysisOrigin: 'server-cache', message: 'O texto recuperado mudou. A análise anterior não será aplicada; confira o manual antes de uma nova análise.' });
    return json({ ...visible(cachedContext), analysisOrigin: 'server-cache' }, existing.status === 'quota' ? 429 : 200);
  }
  // Abrir nunca gera. Um clique explícito com identidade corrigida pode renovar
  // o contexto por hash, passando pelo mesmo claim, concorrência e cota.
  if (existing?.knowledge && !cachedContext.knowledge && !input.retry) return json({ ...visible(cachedContext), analysisOrigin: 'server-cache' });
  if (!/^[a-f0-9-]{36}$/i.test(input.requestId || '')) throw new ApiError(400, 'Identificador da análise inválido.');
  const claim = await send(stub, key, '/claim', { requestId: input.requestId, force: !!input.retry });
  const claimed = await claim.json();
  if (!claim.ok || !claimed.claimed) return json(visible(claimed.record || claimed), claim.status);
  const game = { id: 'draft', title: input.title, edition: input.edition, language: input.documents[0]?.language, gameType: typeof input.gameType === 'string' ? input.gameType.slice(0, 80) : '', research: input.research };
  let collected = { sources, diagnostics: [] };
  if (input.includePublic === true) {
    const preparationDeadline = AbortSignal.timeout(20000);
    const preparingFetch = (url, options = {}) => fetch(url, { ...options, signal: options.signal ? AbortSignal.any([preparationDeadline, options.signal]) : preparationDeadline });
    try {
      collected = await collectProfileKnowledge(game, collected, env, identity, preparingFetch, { reserve: async () => (await send(stub, key, '/profile-budget', { lease: claimed.record.lease })).json() });
    } catch (error) {
      await send(stub, key, '/finish', { lease: claimed.record.lease, status: 'attention', message: error instanceof ApiError ? error.message : 'Não foi possível concluir a identificação nas fontes. Os dados já encontrados foram preservados.' });
      return json(visible(await (await send(stub, key, `/?key=${key}`)).json()));
    }
  }
  const task = (async () => {
    const deadline = AbortSignal.timeout(26000);
    const limitedFetch = (url, options = {}) => fetch(url, { ...options, signal: options.signal ? AbortSignal.any([deadline, options.signal]) : deadline });
    try {
      const knowledge = await synthesizePublicKnowledge(game, collected.sources, env, limitedFetch, { completeProfile: input.includePublic === true });
      if (input.includePublic === true) knowledge.profileAnalysis.publicEvidenceProtocol = 3;
      if (collected.discovery) knowledge.profileAnalysis.discovery = collected.discovery;
      knowledge.diagnostics = collected.diagnostics;
      await requirePermission(env, identity, rights.edit ? 'edit' : 'add', limitedFetch);
      await send(stub, key, '/finish', { lease: claimed.record.lease, status: 'ready', knowledge: { ...knowledge, draft: true, ownerUid: identity.uid, evidenceFingerprint: fingerprint }, diagnostics: collected.diagnostics });
    } catch (error) {
      await send(stub, key, '/finish', {
        lease: claimed.record.lease,
        status: error.status === 429 ? 'quota' : 'attention',
        reason: error.reason || '',
        generation: error.generation || null,
        provider: error.provider || null,
        message: error instanceof ApiError ? error.message : 'Não foi possível analisar o manual.',
      });
    }
  })();
  ctx?.waitUntil?.(task);
  await task;
  return json({ ...visible(await (await send(stub, key, `/?key=${key}`)).json()), analysisOrigin: 'generation' });
}

export async function reusableDraftKnowledge(game, sources, env) {
  if (!game.createdBy || !env.GAME_KNOWLEDGE) return null;
  const key = await draftContextKey(game.createdBy, sources),
    draft = await (await send(binding(env), key, `/?key=${key}`)).json();
  if (draft?.status !== 'ready' || draft.knowledge?.ownerUid !== game.createdBy || draft.knowledge.evidenceFingerprint !== (await evidenceFingerprint(sources))) return null;
  const saved = draft.knowledge;
  if (
    !recontextualizeDraft(
      draft,
      game,
      sources.map((s) => ({ ...s, id: s.documentId })),
    ).knowledge
  )
    return null;
  sources = [...sources, ...saved.sources.filter((s) => s.profileOnly)];
  const rebind = (item) => {
    const old = saved.sources.find((s) => s.id === item.sourceId);
    if (old?.profileOnly) return item;
    const current = sources.find((s) => s.sourceHash === old?.sourceHash);
    const page = current?.pages.find((p) => p.page === item.page);
    const passage = page && manualPassages(page, current.id).find((p) => p.text === item.quote);
    return current && passage ? { ...item, sourceId: current.id, documentId: current.documentId, sourceHash: current.sourceHash, evidenceId: passage.id } : item;
  };
  // Revalidação das citações contra os índices lidos do Drive, nunca contra o cliente.
  const profile = validateProfile(Object.fromEntries(Object.entries(saved.profile || {}).map(([k, v]) => [k, rebind(v)])), sources, manualPassages);
  const clean = validateSynthesis({ language: saved.language, sections: saved.sections.map(rebind), unconfirmed: saved.unconfirmed }, sources, { allowEmpty: saved.profileAnalysis?.publicEvidenceProtocol >= 3 && Object.keys(profile).length > 0 });
  return {
    ...saved,
    ...clean,
    profile,
    sources,
    gameId: game.id,
    title: game.title,
    edition: game.edition || '',
    draft: false,
  };
}
