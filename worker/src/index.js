import { ApiError, bearer, verifyFirebaseToken, sealTicket, openTicket } from './auth.js';
import { getDocument, requirePermission, driveToken, driveMetadata, requireProjectFile, deleteProjectFile, belongsToProject, safeDriveSession, validateUpload, parseRange, firestoreURL } from './services.js';
import { XMLParser } from 'fast-xml-parser';
import { parseSearch, parseThing } from '../../backend/bgg-parser.js';
import { cleanupGuides } from './guide-assets.js';

const CHUNK_LIMIT = 8 * 1024 * 1024,
  JSON_LIMIT = 16384;
const xmlParser = new XMLParser({ ignoreAttributes: false, processEntities: true, htmlEntities: true, parseTagValue: false });
const bggCache = new Map();
const gameIdPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
async function readJSON(request) {
  if (!request.body) throw new ApiError(400, 'Envie os dados da operação.');
  const reader = request.body.getReader();
  let size = 0,
    parts = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > JSON_LIMIT) {
      await reader.cancel();
      throw new ApiError(413, 'Dados da operação muito grandes.');
    }
    parts.push(value);
  }
  const bytes = new Uint8Array(size);
  let cursor = 0;
  for (const part of parts) {
    bytes.set(part, cursor);
    cursor += part.length;
  }
  try {
    const value = JSON.parse(new TextDecoder().decode(bytes));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch {
    throw new ApiError(400, 'Dados JSON inválidos.');
  }
}
function checkGameId(id) {
  if (!gameIdPattern.test(id)) throw new ApiError(400, 'Identificador de jogo inválido.');
  return id;
}
function limitedBody(body, expected) {
  let length = 0;
  return body?.pipeThrough(
    new TransformStream({
      transform(chunk, controller) {
        length += chunk.byteLength;
        if (length > expected || length > CHUNK_LIMIT) throw new ApiError(413, 'Bloco maior que o permitido.');
        controller.enqueue(chunk);
      },
      flush() {
        if (length !== expected) throw new ApiError(400, 'Bloco incompleto.');
      },
    }),
  );
}
async function uploadStart(request, env, identity) {
  const input = validateUpload(await readJSON(request), Number(env.MAX_PDF_BYTES || 52428800));
  checkGameId(input.gameId);
  const previous = await getDocument(env, `games/${input.gameId}`, identity?.token);
  if (previous?.deleting === true) throw new ApiError(409, 'Este jogo está em processo de exclusão.');
  if (input.kind === 'guideAsset' && !previous) throw new ApiError(404, 'Cadastre o jogo antes de criar o guia.');
  const action = previous ? 'edit' : 'add';
  await requirePermission(env, identity, action);
  await requireProjectFile(env, env.DRIVE_FOLDER_ID, { kind: 'folder' });
  const nonce = crypto.randomUUID(),
    oldFileId = previous?.[input.kind]?.driveFileId || '';
  const metadata = { name: input.name, mimeType: input.mimeType, parents: [env.DRIVE_FOLDER_ID], appProperties: { acervoProject: env.FIREBASE_PROJECT_ID, gameId: input.gameId, kind: input.kind, uploadNonce: nonce } };
  const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,mimeType,size,parents,appProperties,owners(emailAddress,me)', {
    method: 'POST',
    headers: { Authorization: `Bearer ${await driveToken(env)}`, 'Content-Type': 'application/json; charset=utf-8', 'X-Upload-Content-Type': input.mimeType, 'X-Upload-Content-Length': String(input.size) },
    body: JSON.stringify(metadata),
    signal: AbortSignal.timeout(20000),
    redirect: 'manual',
  });
  if (!response.ok) throw new ApiError(response.status === 403 || response.status === 429 ? 429 : 502, 'O Drive não iniciou o upload. Confira a cota e a conexão da conta central.');
  const sessionURL = safeDriveSession(response.headers.get('Location'));
  const ticket = await sealTicket({ type: 'upload', uid: identity.uid, gameId: input.gameId, kind: input.kind, size: input.size, mimeType: input.mimeType, sessionURL, nonce, action, oldFileId, expires: Date.now() + 24 * 3600000 }, env.TICKET_KEY);
  // A URL privada da sessão Google nunca vai ao frontend.
  return json({ ticket, chunkBytes: CHUNK_LIMIT, received: 0 });
}
async function uploadChunk(request, env, identity, probe = false) {
  if (!identity) throw new ApiError(401, 'Entre para continuar o upload.');
  const ticket = await openTicket(request.headers.get('X-Upload-Ticket'), env.TICKET_KEY, identity.uid, 'upload');
  await requirePermission(env, identity, ticket.action);
  const activeGame = await getDocument(env, `games/${ticket.gameId}`, identity.token);
  if (activeGame?.deleting === true) throw new ApiError(409, 'O jogo está em processo de exclusão. O upload não pode continuar.');
  const size = probe ? 0 : Number(request.headers.get('Content-Length'));
  if (!probe && (!Number.isInteger(size) || size <= 0 || size > CHUNK_LIMIT)) throw new ApiError(411, 'Informe um bloco com tamanho válido.');
  const range = probe ? `bytes */${ticket.size}` : request.headers.get('Content-Range');
  parseRange(range, ticket.size, size);
  const response = await fetch(safeDriveSession(ticket.sessionURL), {
    method: 'PUT',
    headers: { Authorization: `Bearer ${await driveToken(env)}`, 'Content-Type': ticket.mimeType, 'Content-Length': String(size), 'Content-Range': range },
    body: probe ? null : limitedBody(request.body, size),
    redirect: 'manual',
  });
  if (response.status === 308) {
    const last = /^bytes=0-(\d+)$/.exec(response.headers.get('Range') || '');
    return json({ complete: false, received: last ? Number(last[1]) + 1 : 0 });
  }
  if (response.status === 404 || response.status === 410) throw new ApiError(410, 'A sessão expirou. Selecione o PDF novamente para reiniciar.');
  if (!response.ok) throw new ApiError(response.status >= 500 ? 503 : 502, 'O bloco não foi confirmado pelo Drive. Consulte o estado do upload e tente novamente.');
  const file = await response.json();
  if (Number(file.size) !== ticket.size || file.mimeType !== ticket.mimeType || !belongsToProject(file, env, { gameId: ticket.gameId, kind: ticket.kind, nonce: ticket.nonce }))
    throw new ApiError(502, 'O arquivo enviado não corresponde à sessão autorizada.');
  const receipt = await sealTicket(
    { type: 'receipt', uid: identity.uid, gameId: ticket.gameId, kind: ticket.kind, fileId: file.id, oldFileId: ticket.oldFileId, nonce: ticket.nonce, action: ticket.action, expires: Date.now() + 48 * 3600000 },
    env.TICKET_KEY,
  );
  return json({ complete: true, received: ticket.size, driveFileId: file.id, receipt });
}
async function finishUpload(request, env, identity, cleanup = false) {
  if (!identity) throw new ApiError(401, 'Entre com sua conta.');
  const input = await readJSON(request),
    receipt = await openTicket(input.receipt, env.TICKET_KEY, identity.uid, 'receipt');
  await requirePermission(env, identity, receipt.action);
  const game = await getDocument(env, `games/${receipt.gameId}`, identity.token);
  let linked = game?.[receipt.kind]?.driveFileId === receipt.fileId;
  if (receipt.kind === 'guideAsset') {
    const draft = await getDocument(env, `guideDrafts/${receipt.gameId}`, identity.token),
      published = await getDocument(env, `gameGuides/${receipt.gameId}`, identity.token);
    linked = !!(draft?.assets?.[receipt.fileId] || published?.assets?.[receipt.fileId]);
  }
  if (cleanup) {
    if (linked) throw new ApiError(409, 'O arquivo já está vinculado ao jogo e não pode ser descartado como upload incompleto.');
    await deleteProjectFile(env, receipt.fileId, { gameId: receipt.gameId, kind: receipt.kind, nonce: receipt.nonce });
  } else {
    if (game?.deleting === true) throw new ApiError(409, 'O jogo está em processo de exclusão.');
    if (!linked) throw new ApiError(409, 'Salve as informações do jogo antes de finalizar os arquivos.');
    await requireProjectFile(env, receipt.fileId, { gameId: receipt.gameId, kind: receipt.kind, nonce: receipt.nonce });
    if (receipt.oldFileId && receipt.oldFileId !== receipt.fileId) await deleteProjectFile(env, receipt.oldFileId, { gameId: receipt.gameId, kind: receipt.kind });
  }
  return json({ ok: true });
}
async function media(request, env, identity, gameId, kind, assetId = '') {
  checkGameId(gameId);
  // As regras reais do Firestore autorizam o visitante ou a conta desta requisição.
  const game = await getDocument(env, `games/${gameId}`, identity?.token);
  if (!game) throw new ApiError(404, 'Jogo não encontrado.');
  if (game.deleting === true) throw new ApiError(410, 'Este jogo está em processo de exclusão.');
  let id = game[kind]?.driveFileId;
  if (kind === 'guideAsset') {
    const published = await getDocument(env, `gameGuides/${gameId}`, identity?.token);
    if (published?.assets?.[assetId]) id = assetId;
    else {
      await requirePermission(env, identity, 'edit');
      const draft = await getDocument(env, `guideDrafts/${gameId}`, identity.token);
      if (draft?.assets?.[assetId]) id = assetId;
    }
  }
  if (!id) throw new ApiError(404, 'Este arquivo ainda não foi enviado ao Drive central.');
  const file = await requireProjectFile(env, id, { gameId, kind });
  const headers = { Authorization: `Bearer ${await driveToken(env)}` };
  const range = request.headers.get('Range');
  if (range) {
    if (!/^bytes=\d*-\d*$/.test(range) || range === 'bytes=-') throw new ApiError(416, 'Faixa de leitura inválida.');
    headers.Range = range;
  }
  const upstream = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?alt=media`, { headers, redirect: 'manual' });
  if (!upstream.ok && upstream.status !== 416) throw new ApiError(upstream.status === 429 || upstream.status === 403 ? 429 : 502, 'O Drive não disponibilizou o arquivo agora. Tente novamente.');
  const result = new Headers({
    'Content-Type': kind === 'guideAsset' ? (['image/jpeg', 'application/gzip'].includes(file.mimeType) ? file.mimeType : 'application/octet-stream') : kind === 'manual' ? 'application/pdf' : 'image/jpeg',
    'Cache-Control': 'no-store',
    'Accept-Ranges': 'bytes',
    'X-Content-Type-Options': 'nosniff',
    'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(file.name || (kind === 'manual' ? 'manual.pdf' : 'capa.jpg'))}`,
  });
  for (const name of ['Content-Length', 'Content-Range', 'ETag']) if (upstream.headers.has(name)) result.set(name, upstream.headers.get(name));
  return new Response(request.method === 'HEAD' ? null : upstream.body, { status: upstream.status, headers: result });
}
async function deleteGame(env, identity, id) {
  checkGameId(id);
  await requirePermission(env, identity, 'delete');
  let game = await getDocument(env, `games/${id}`, identity.token);
  if (!game) return json({ ok: true });
  // Validar TODOS os arquivos antes de qualquer exclusão. Referências inválidas
  // não impedem remover o cadastro autorizado; seus arquivos permanecem intactos.
  const safeKinds = [],
    preservedKinds = [];
  for (const kind of ['manual', 'cover'])
    if (game[kind]?.driveFileId) {
      try {
        await requireProjectFile(env, game[kind].driveFileId, { gameId: id, kind, allowTrashed: true });
        safeKinds.push(kind);
      } catch (error) {
        if (error.status === 403) preservedKinds.push(kind);
        else if (error.status !== 404) throw error;
      }
    }
  if (game.deleting !== true) {
    const locked = await fetch(`https://firestore.googleapis.com/v1/projects/${encodeURIComponent(env.FIREBASE_PROJECT_ID)}/databases/(default)/documents:commit`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${identity.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        writes: [
          {
            update: { name: `projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/games/${id}`, fields: { deleting: { booleanValue: true }, deleteRequestedBy: { stringValue: identity.uid } } },
            updateMask: { fieldPaths: ['deleting', 'deleteRequestedBy'] },
            updateTransforms: [{ fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }],
            currentDocument: { updateTime: game._updateTime },
          },
        ],
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!locked.ok) throw new ApiError(409, 'O jogo mudou antes da exclusão. Nenhum arquivo foi removido; reabra o cadastro e tente novamente.');
    game = await getDocument(env, `games/${id}`, identity.token);
    if (!game || game.deleting !== true) throw new ApiError(409, 'Não foi possível confirmar a exclusão. Nenhum arquivo foi removido.');
  }
  const cleanup = await cleanupGuides(env, identity, id);
  if (cleanup.pending) return json(cleanup, 202);
  for (const kind of safeKinds) await deleteProjectFile(env, game[kind].driveFileId, { gameId: id, kind });
  const response = await fetch(`${firestoreURL(env, `games/${id}`)}?currentDocument.updateTime=${encodeURIComponent(game._updateTime)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${identity.token}` },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok && response.status !== 404) throw new ApiError(409, 'A exclusão dos arquivos terminou, mas o cadastro não pôde ser removido. Repita a exclusão pendente.');
  return json({ ok: true, ...(preservedKinds.length || cleanup.preserved ? { warning: 'Cadastro removido. Arquivos com referências fora deste jogo foram preservados no Drive.' } : {}) });
}
async function catalogStatus(request, env, identity) {
  const input = await readJSON(request);
  if (!Array.isArray(input.gameIds) || input.gameIds.length > 20 || input.gameIds.some((id) => typeof id !== 'string' || !gameIdPattern.test(id))) throw new ApiError(400, 'Informe até 20 jogos válidos.');
  const games = await Promise.all(
    [...new Set(input.gameIds)].map(async (id) => {
      let game;
      try {
        game = await getDocument(env, `games/${id}`, identity?.token);
      } catch (error) {
        if ([401, 403].includes(error.status)) return { id, available: false, reason: 'unavailable' };
        throw error;
      }
      if (!game || game.deleting || !game.manual?.driveFileId) return { id, available: false, reason: 'missing' };
      // O ID vem do documento efetivamente autorizado pelo Firestore, nunca do cliente.
      const file = await driveMetadata(env, game.manual.driveFileId);
      if (!file) return { id, available: false, reason: 'missing' };
      if (!belongsToProject(file, env, { gameId: id, kind: 'manual', allowTrashed: true })) return { id, available: false, reason: 'unavailable' };
      return { id, available: file.trashed !== true, reason: file.trashed ? 'trashed' : 'available' };
    }),
  );
  return json({ games });
}
async function bgg(request, env, identity) {
  // Tanto admin como subadmin com edição/adição podem reconhecer manuais.
  try {
    await requirePermission(env, identity, 'add');
  } catch (error) {
    if (error.status !== 403) throw error;
    await requirePermission(env, identity, 'edit');
  }
  if (!env.BGG_TOKEN) throw new ApiError(503, 'O reconhecimento pelo BGG ainda não foi ativado pelo administrador.');
  const input = await readJSON(request);
  let endpoint;
  if (input.action === 'search' && typeof input.query === 'string' && input.query.trim().length >= 2 && input.query.length <= 160) endpoint = `search?type=boardgame&query=${encodeURIComponent(input.query.trim())}`;
  else if (input.action === 'thing' && /^[1-9]\d{0,8}$/.test(String(input.id))) endpoint = `thing?id=${input.id}`;
  else throw new ApiError(400, 'Consulta inválida.');
  const cached = bggCache.get(endpoint);
  if (cached?.expires > Date.now()) return json(cached.data);
  const response = await fetch(`https://boardgamegeek.com/xmlapi2/${endpoint}`, { headers: { Authorization: `Bearer ${env.BGG_TOKEN}`, Accept: 'application/xml' }, signal: AbortSignal.timeout(20000) });
  if ([202, 429, 503].includes(response.status)) throw new ApiError(429, 'O BGG está processando ou limitando consultas. Aguarde e tente novamente.');
  if (response.status === 401 || response.status === 403) throw new ApiError(503, 'A autorização do BGG precisa ser revisada pelo administrador.');
  if (!response.ok) throw new ApiError(502, 'O BGG não respondeu.');
  const xml = await response.text();
  if (xml.length > 150000 || /<!DOCTYPE|<!ENTITY/i.test(xml)) throw new ApiError(502, 'Resposta do BGG não suportada.');
  const parsed = xmlParser.parse(xml),
    data = input.action === 'search' ? parseSearch(parsed) : parseThing(parsed);
  if (bggCache.size >= 100) bggCache.delete(bggCache.keys().next().value);
  bggCache.set(endpoint, { data, expires: Date.now() + 3600000 });
  return json(data);
}
async function bggCover(request, env, identity, id) {
  if (!/^[1-9]\d{0,8}$/.test(id)) throw new ApiError(400, 'Jogo BGG inválido.');
  const metadata = await (await bgg(new Request(request.url, { method: 'POST', body: JSON.stringify({ action: 'thing', id }) }), env, identity)).json();
  const url = new URL(metadata.image || metadata.thumbnail || 'https://invalid.invalid');
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.geekdo-images.com') || url.username || url.password) throw new ApiError(502, 'A capa do BGG não está disponível para importação.');
  const response = await fetch(url.href, { redirect: 'manual', signal: AbortSignal.timeout(20000) });
  const type = response.headers.get('Content-Type')?.split(';')[0];
  if (!response.ok || !['image/jpeg', 'image/png', 'image/webp'].includes(type) || Number(response.headers.get('Content-Length')) > CHUNK_LIMIT) throw new ApiError(502, 'A capa não pôde ser importada.');
  let count = 0;
  const body = response.body.pipeThrough(
    new TransformStream({
      transform(chunk, controller) {
        count += chunk.byteLength;
        if (count > CHUNK_LIMIT) throw new Error('Imagem muito grande.');
        controller.enqueue(chunk);
      },
    }),
  );
  return new Response(body, { headers: { 'Content-Type': type, 'Cache-Control': 'no-store' } });
}
export async function handleRequest(request, env) {
  const origin = request.headers.get('Origin'),
    allowed = String(env.ALLOWED_ORIGINS || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
  if (origin && !allowed.includes(origin)) return json({ error: 'Origem não autorizada.' }, 403);
  const cors = {
    Vary: 'Origin',
    'Access-Control-Allow-Methods': 'GET,HEAD,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization,Content-Type,Content-Range,X-Upload-Ticket',
    'Access-Control-Expose-Headers': 'Content-Length,Content-Range,Accept-Ranges,ETag',
    'Access-Control-Max-Age': '600',
  };
  if (origin) cors['Access-Control-Allow-Origin'] = origin;
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  let response;
  try {
    const url = new URL(request.url);
    if (url.pathname === '/health' && request.method === 'GET') response = json({ ok: true, firebaseProject: env.FIREBASE_PROJECT_ID, driveConnected: !!(env.GOOGLE_REFRESH_TOKEN && env.DRIVE_FOLDER_ID && env.TICKET_KEY) });
    else {
      const token = bearer(request);
      let identity = null;
      if (token) {
        const claims = await verifyFirebaseToken(token, env.FIREBASE_PROJECT_ID);
        identity = { uid: claims.sub, token };
      }
      if (url.pathname === '/v1/catalog/status' && request.method === 'POST') response = await catalogStatus(request, env, identity);
      else if (url.pathname === '/v1/uploads' && request.method === 'POST') response = await uploadStart(request, env, identity);
      else if (url.pathname === '/v1/uploads/chunk' && request.method === 'PUT') response = await uploadChunk(request, env, identity);
      else if (url.pathname === '/v1/uploads/status' && request.method === 'POST') response = await uploadChunk(request, env, identity, true);
      else if (url.pathname === '/v1/uploads/finalize' && request.method === 'POST') response = await finishUpload(request, env, identity);
      else if (url.pathname === '/v1/uploads/discard' && request.method === 'POST') response = await finishUpload(request, env, identity, true);
      else if (url.pathname === '/v1/bgg' && request.method === 'POST') response = await bgg(request, env, identity);
      else {
        const cover = /^\/v1\/bgg\/(\d+)\/cover$/.exec(url.pathname);
        if (cover && request.method === 'GET') response = await bggCover(request, env, identity, cover[1]);
        else {
          const asset = /^\/v1\/games\/([^/]+)\/guide-assets\/([A-Za-z0-9_-]{6,200})$/.exec(url.pathname),
            read = /^\/v1\/games\/([^/]+)\/(manual|cover)$/.exec(url.pathname),
            remove = /^\/v1\/games\/([^/]+)$/.exec(url.pathname);
          if (asset && ['GET', 'HEAD'].includes(request.method)) response = await media(request, env, identity, asset[1], 'guideAsset', asset[2]);
          else if (read && ['GET', 'HEAD'].includes(request.method)) response = await media(request, env, identity, read[1], read[2]);
          else if (remove && request.method === 'DELETE') response = await deleteGame(env, identity, remove[1]);
          else throw new ApiError(404, 'Operação não encontrada.');
        }
      }
    }
  } catch (error) {
    // Não registrar tokens, cabeçalhos de autorização, respostas OAuth ou tickets.
    response = json({ error: error instanceof ApiError ? error.message : 'Não foi possível concluir a operação. Tente novamente.' }, error instanceof ApiError ? error.status : 502);
  }
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(cors)) headers.set(key, value);
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('X-Content-Type-Options', 'nosniff');
  return new Response(response.body, { status: response.status, headers });
}
export default { fetch: handleRequest };
