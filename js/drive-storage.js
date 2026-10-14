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
  async function call(path, { method = 'GET', json, body, headers = {} } = {}) {
    const token = await getToken();
    const response = await fetch(`${api()}${path}`, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(json ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: json ? JSON.stringify(json) : body });
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
        kind = path.endsWith('/manual.pdf') ? 'manual' : 'cover';
      if (!gameId) throw new Error('Referência de arquivo inválida.');
      const digest = options.fingerprint || Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())), (b) => b.toString(16).padStart(2, '0')).join('');
      const key = `acervo-upload:${config.projectId}:${getUid()}:${gameId}:${kind}:${digest}`;
      let state = loadState(key),
        position = 0;
      if (state) {
        try {
          const resumed = await (await call('/v1/uploads/status', { method: 'POST', headers: { 'X-Upload-Ticket': state.ticket } })).json();
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
          await call('/v1/uploads', { method: 'POST', json: { gameId, kind, size: blob.size, mimeType: kind === 'manual' ? 'application/pdf' : 'image/jpeg', name: options.name || (kind === 'manual' ? 'manual.pdf' : 'capa.jpg') } })
        ).json();
        state = { ticket: result.ticket, startedAt: Date.now() };
        storeState(key, state);
      }
      onProgress(Math.round((position / blob.size) * 100));
      let failures = 0;
      while (position < blob.size) {
        const end = Math.min(position + 8 * 1024 * 1024, blob.size),
          chunk = blob.slice(position, end, kind === 'manual' ? 'application/pdf' : 'image/jpeg');
        try {
          const result = await (await call('/v1/uploads/chunk', { method: 'PUT', headers: { 'X-Upload-Ticket': state.ticket, 'Content-Range': `bytes ${position}-${end - 1}/${blob.size}`, 'Content-Type': chunk.type }, body: chunk })).json();
          if (result.complete) {
            onProgress(100);
            return { ...result, resumeKey: key };
          }
          if (!Number.isInteger(result.received) || result.received <= position || result.received > blob.size) throw new Error('O Drive não confirmou o progresso do upload.');
          position = result.received;
          failures = 0;
          onProgress(Math.round((position / blob.size) * 100));
        } catch (error) {
          if ((error.status && ![429, 502, 503, 504].includes(error.status)) || failures++ >= 3) throw error;
          await new Promise((resolve) => setTimeout(resolve, Math.min(8000, 1000 * 2 ** failures)));
          const result = await (await call('/v1/uploads/status', { method: 'POST', headers: { 'X-Upload-Ticket': state.ticket } })).json();
          if (result.complete) {
            onProgress(100);
            return { ...result, resumeKey: key };
          }
          position = result.received;
        }
      }
      throw new Error('O Drive não confirmou o arquivo. Selecione-o novamente para retomar.');
    },
    async get(game, kind, maxBytes) {
      const response = await call(`/v1/games/${encodeURIComponent(game.id)}/${kind}`);
      if (Number(response.headers.get('Content-Length')) > maxBytes) throw new Error('Arquivo maior que o permitido.');
      const blob = await response.blob();
      if (blob.size > maxBytes) throw new Error('Arquivo maior que o permitido.');
      return blob;
    },
    async readerSource(game) {
      const token = await getToken();
      return { url: `${api()}/v1/games/${encodeURIComponent(game.id)}/manual`, headers: token ? { Authorization: `Bearer ${token}` } : {} };
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
      await call(`/v1/games/${encodeURIComponent(game.id)}`, { method: 'DELETE' });
    },
    async bggCover(id) {
      return (await call(`/v1/bgg/${encodeURIComponent(id)}/cover`)).blob();
    },
    close() {},
  };
}
