import { MAX_PDF_BYTES } from './pdf-limits.js';
// Somente o JWT Firebase vai à API. Credenciais OAuth do Drive ficam no Worker.
function endpointRoot(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) throw new Error();
    if (url.username || url.password || url.search || url.hash) throw new Error();
    return url.href.replace(/\/$/, '');
  } catch {
    throw new Error('O Drive central ainda não foi conectado. Configure o endereço da API em config/app-config.js seguindo o guia do projeto.');
  }
}
export function createDriveStorage(config, getToken, getUid) {
  const api = () => endpointRoot(config.apiBase);
  let controller = new AbortController();
  let health;
  async function capabilities(refresh = false) {
    if (refresh) health = null;
    return (health ||= fetch(`${api()}/health`, { cache: 'no-store', signal: AbortSignal.timeout(4000) })
      .then(async (response) => {
        if (!response.ok) throw Object.assign(new Error('Não foi possível conferir a conexão dos documentos.'), { status: response.status });
        return response.json();
      })
      .catch((error) => {
        health = null;
        throw error;
      }));
  }
  async function validatePdfUpload(blob) {
    if (!Number.isSafeInteger(blob.size) || !blob.size || blob.size > MAX_PDF_BYTES) throw new Error('Selecione um PDF de até 50 MiB.');
    const info = await capabilities(true),
      known = Number.isSafeInteger(info.maxPdfBytes) && info.maxPdfBytes > 0;
    if (known && blob.size > info.maxPdfBytes) {
      const limit = (info.maxPdfBytes / 1024 / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 });
      throw Object.assign(new Error(`O servidor conectado aceita PDFs de até ${limit} MiB. Seus dados continuam preenchidos.`), {
        status: 413,
        code: 'upload/server-limit',
      });
    }
    return info;
  }
  async function call(path, { method = 'GET', json, body, headers = {}, signal } = {}) {
    const uid = getUid(),
      current = controller;
    const token = await getToken();
    if (!token || !uid || current !== controller) throw new Error('Entre com uma conta aprovada.');
    const response = await fetch(`${api()}${path}`, {
      method,
      signal: signal ? AbortSignal.any([signal, current.signal]) : current.signal,
      cache: 'no-store',
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(json ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: json ? JSON.stringify(json) : body,
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      const error = new Error(data.error || 'A API do Drive não respondeu.');
      error.status = response.status;
      throw error;
    }
    return response;
  }
  function loadState(key) {
    try {
      const data = JSON.parse(localStorage.getItem(key));
      return data && data.startedAt > Date.now() - 23 * 3600000 ? data : null;
    } catch {
      return null;
    }
  }
  function storeState(key, value) {
    try {
      if (value) localStorage.setItem(key, JSON.stringify(value));
      else localStorage.removeItem(key);
    } catch {
      /* O upload continua em memória. */
    }
  }
  return {
    provider: 'drive',
    capabilities,
    validatePdfUpload,
    async knowledge(game, input) {
      const info = await capabilities();
      if (!(info.knowledgeProtocol >= 1)) return { status: 'pending_configuration', message: 'A geração aguarda a configuração da IA.', knowledge: null };
      return (await call(`/v1/games/${encodeURIComponent(game.id)}/knowledge`, input ? { method: 'POST', json: input } : {})).json();
    },
    async checkGames(games) {
      const results = [];
      for (let offset = 0; offset < games.length; offset += 20) {
        const response = await call('/v1/catalog/status', { method: 'POST', json: { gameIds: games.slice(offset, offset + 20).map((game) => game.id) } });
        const data = await response.json();
        if (!Array.isArray(data.games)) throw new Error('Não foi possível conferir os manuais do acervo.');
        results.push(...data.games);
      }
      return results;
    },
    pendingGameId(fingerprint) {
      const prefix = `acervo-upload:${config.projectId}:${getUid()}:`;
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (!key?.startsWith(prefix) || !key.endsWith(`:manual:${fingerprint}`) || !loadState(key)) continue;
          const id = key.slice(prefix.length).split(':')[0];
          if (/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)) return id;
        }
      } catch {
        /* Armazenamento local indisponível: iniciar uma nova sessão. */
      }
      return '';
    },
    async put(path, blob, onProgress = () => {}, options = {}) {
      const gameId = /^games\/([^/]+)\//.exec(path)?.[1],
        kind = options.kind || (path.endsWith('/manual.pdf') ? 'manual' : 'cover'),
        mimeType = options.mimeType || (kind === 'manual' ? 'application/pdf' : 'image/jpeg');
      if (!gameId) throw new Error('Referência de arquivo inválida.');
      if (['manual', 'document'].includes(kind)) await validatePdfUpload(blob);
      const digest = options.fingerprint || Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())), (b) => b.toString(16).padStart(2, '0')).join('');
      const key = `acervo-upload:${config.projectId}:${getUid()}:${gameId}:${kind}${options.documentId ? `-${options.documentId}` : ''}:${digest}`;
      let state = loadState(key),
        position = 0;
      if (state) {
        try {
          const resumed = await (await call('/v1/uploads/status', { method: 'POST', signal: options.signal, headers: { 'X-Upload-Ticket': state.ticket } })).json();
          if (resumed.complete) return { ...resumed, resumeKey: key };
          position = resumed.received;
        } catch (error) {
          if (error.status === 410 || error.status === 403) {
            state = null;
            storeState(key, null);
          } else throw error;
        }
      }
      if (!state) {
        const result = await (
          await call('/v1/uploads', {
            method: 'POST',
            signal: options.signal,
            json: { gameId, kind, documentId: options.documentId || '', sourceHash: options.sourceHash || options.fingerprint || '', size: blob.size, mimeType, name: options.name || (kind === 'manual' ? 'manual.pdf' : 'capa.jpg') },
          })
        ).json();
        state = { ticket: result.ticket, startedAt: Date.now() };
        storeState(key, state);
      }
      onProgress(Math.round((position / blob.size) * 100));
      let failures = 0;
      while (position < blob.size) {
        options.signal?.throwIfAborted();
        const end = Math.min(position + 8 * 1024 * 1024, blob.size),
          chunk = blob.slice(position, end, mimeType);
        try {
          const result = await (
            await call('/v1/uploads/chunk', { method: 'PUT', signal: options.signal, headers: { 'X-Upload-Ticket': state.ticket, 'Content-Range': `bytes ${position}-${end - 1}/${blob.size}`, 'Content-Type': chunk.type }, body: chunk })
          ).json();
          if (result.complete) {
            onProgress(100);
            return { ...result, resumeKey: key };
          }
          if (!Number.isInteger(result.received) || result.received <= position || result.received > blob.size) throw new Error('O Drive não confirmou o progresso do upload.');
          position = result.received;
          failures = 0;
          onProgress(Math.round((position / blob.size) * 100));
        } catch (error) {
          if (error.name === 'AbortError' || options.signal?.aborted) throw error;
          if ((error.status && ![429, 502, 503, 504].includes(error.status)) || failures++ >= 3) throw error;
          await new Promise((resolve) => setTimeout(resolve, Math.min(8000, 1000 * 2 ** failures)));
          const result = await (await call('/v1/uploads/status', { method: 'POST', signal: options.signal, headers: { 'X-Upload-Ticket': state.ticket } })).json();
          if (result.complete) {
            onProgress(100);
            return { ...result, resumeKey: key };
          }
          position = result.received;
        }
      }
      throw new Error('O Drive não confirmou o arquivo. Selecione-o novamente para retomar.');
    },
    async get(game, kind, maxBytes, { signal } = {}) {
      if (kind.startsWith('documents/') && !((await capabilities()).fileProtocol >= 2)) throw Object.assign(new Error('A conexão dos documentos precisa ser atualizada para usar este recurso.'), { status: 426 });
      const response = await call(`/v1/games/${encodeURIComponent(game.id)}/${kind}`, { signal, headers: kind.startsWith('documents/') && game.manual?.sha256 ? { 'X-Document-Hash': game.manual.sha256 } : {} });
      if (Number(response.headers.get('Content-Length')) > maxBytes) throw new Error('Arquivo maior que o permitido.');
      const blob = await response.blob();
      if (blob.size > maxBytes) throw new Error('Arquivo maior que o permitido.');
      return blob;
    },
    async readerSource(game) {
      const token = await getToken();
      if (!token || !getUid()) throw new Error('Entre com uma conta aprovada.');
      const modern = game.documentId && (await capabilities()).fileProtocol >= 2;
      if (game.documentId && !game.legacyManual && !modern) throw Object.assign(new Error('A conexão dos documentos precisa ser atualizada para abrir este PDF.'), { status: 426 });
      return {
        url: `${api()}/v1/games/${encodeURIComponent(game.id)}/${modern ? `documents/${encodeURIComponent(game.documentId)}/pdf` : 'manual'}`,
        headers: { Authorization: `Bearer ${token}`, ...(modern && game.manual?.sha256 ? { 'X-Document-Hash': game.manual.sha256 } : {}) },
      };
    },
    async finalize(reference) {
      await call('/v1/uploads/finalize', { method: 'POST', json: { receipt: reference.receipt } });
      storeState(reference.resumeKey, null);
    },
    async discard(reference) {
      await call('/v1/uploads/discard', { method: 'POST', json: { receipt: reference.receipt } });
      storeState(reference.resumeKey, null);
    },
    async deleteGame(game) {
      for (let attempt = 0; attempt < 30; attempt++) {
        const result = await (await call(`/v1/games/${encodeURIComponent(game.id)}`, { method: 'DELETE' })).json();
        if (!result.pending) return result;
      }
      throw new Error('A limpeza precisa continuar. Repita a exclusão pendente.');
    },
    async deleteDocument(game, id) {
      return (await call(`/v1/games/${encodeURIComponent(game.id)}/documents/${encodeURIComponent(id)}`, { method: 'DELETE' })).json();
    },
    async getGuideAsset(game, id) {
      const response = await call(`/v1/games/${encodeURIComponent(game.id)}/guide-assets/${encodeURIComponent(id)}`);
      const blob = await response.blob();
      if (blob.size > 8 * 1024 * 1024) throw new Error('Arquivo do guia maior que o limite.');
      return blob;
    },
    async bggCover(id) {
      try {
        return (await call(`/v1/bgg/${encodeURIComponent(id)}/cover`, { signal: AbortSignal.timeout(25000) })).blob();
      } catch (error) {
        if (error.name === 'TimeoutError') throw new Error('A capa do BGG demorou a responder. Use a capa do PDF.');
        throw error;
      }
    },
    resetSession() {
      controller.abort();
      controller = new AbortController();
    },
    close() {
      controller.abort();
    },
  };
}
