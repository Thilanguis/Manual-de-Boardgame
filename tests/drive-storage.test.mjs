import test from 'node:test';
import assert from 'node:assert/strict';
import { createDriveStorage } from '../js/drive-storage.js';
import { MAX_PDF_BYTES } from '../js/pdf-limits.js';

test('assistente exige protocolo próprio, JWT e conserva uso informado em 429, sem repetição', async () => {
  const previous = globalThis.fetch;
  let protocol = false,
    calls = 0;
  globalThis.fetch = async (url, options) => {
    if (url.endsWith('/health')) return Response.json({ ruleAssistantProtocol: protocol ? 1 : 0 });
    calls++;
    assert.equal(options.headers.Authorization, 'Bearer fixture');
    assert(url.endsWith('/rule-question'));
    assert.equal(JSON.parse(options.body).question, 'Como atacar?');
    return Response.json({ error: 'Orçamento atingido.', usage: { used: 10, limit: 10 } }, { status: 429 });
  };
  const create = () =>
    createDriveStorage(
      { apiBase: 'https://api.example.test' },
      async () => 'fixture',
      () => 'owner',
    );
  try {
    await assert.rejects(create().askRules({ id: 'game' }, { question: 'Como atacar?' }), /ainda não oferece/);
    assert.equal(calls, 0);
    protocol = true;
    await assert.rejects(create().askRules({ id: 'game' }, { question: 'Como atacar?' }), (e) => e.status === 429 && e.usage.used === 10);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = previous;
  }
});

test('429 de conhecimento preserva mensagem, prazo e estado em vez de erro genérico de Drive', async () => {
  const original = globalThis.fetch;
  const record = { status: 'quota', reason: 'provider-rate-limit', message: 'A cota do Gemini foi atingida.', retryAt: Date.now() + 60000 };
  let requests = 0;
  globalThis.fetch = async (url) => {
    if (url.endsWith('/health')) return Response.json({ knowledgeProtocol: 1 });
    requests++;
    return Response.json(record, { status: 429 });
  };
  try {
    const storage = createDriveStorage(
      { apiBase: 'https://api.example.test' },
      async () => 'fixture',
      () => 'owner',
    );
    await assert.rejects(storage.knowledge({ id: 'game' }, { force: true }), (error) => {
      assert.equal(error.status, 429);
      assert.equal(error.message, record.message);
      assert.deepEqual(error.record, record);
      return true;
    });
    assert.equal(requests, 1, 'não repete automaticamente a geração');
  } finally {
    globalThis.fetch = original;
  }
});

test('servidor sem protocolo de conhecimento é identificado antes de tentar gerar IA', async () => {
  const oldFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (url) => {
    calls++;
    assert.ok(url.endsWith('/health'));
    return Response.json({ ok: true });
  };
  try {
    const storage = createDriveStorage(
      { apiBase: 'https://api.example.test' },
      async () => 'jwt',
      () => 'owner',
    );
    const result = await storage.knowledge({ id: 'game' }, { requestId: 'fixture' });
    assert.equal(result.status, 'pending_configuration');
    assert.equal(result.reason, 'server-update');
    assert.equal(result.knowledge, null);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test('limite local de 50 MiB impede envio mesmo quando servidor aceita mais; capacidades menores são respeitadas', async () => {
  const oldFetch = globalThis.fetch;
  let reads = 0;
  globalThis.fetch = async () => {
    reads++;
    return Response.json({ maxPdfBytes: 40 * 1024 * 1024 });
  };
  const storage = createDriveStorage(
    { apiBase: 'https://api.example.test' },
    async () => 'jwt',
    () => 'owner',
  );
  try {
    for (const size of [52428801, 104857600, 157286400, 209715200]) await assert.rejects(storage.validatePdfUpload({ size }), /50 MiB/);
    assert.equal(reads, 0);
    await assert.rejects(storage.validatePdfUpload({ size: 52428800 }), (e) => e.status === 413);
    globalThis.fetch = async () => Response.json({ maxPdfBytes: 52428800 });
    await storage.validatePdfUpload({ size: 52428800 });
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test('capa e manual legado usam JWT sem cabeçalho de hash; documentos novos exigem backend compatível', async () => {
  const oldFetch = globalThis.fetch,
    calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return url.endsWith('/health') ? Response.json({ ok: true, apiVersion: '1.7.5' }) : new Response('image');
  };
  const storage = createDriveStorage(
    { apiBase: 'https://api.example.test' },
    async () => 'jwt',
    () => 'owner',
  );
  try {
    await storage.get({ id: 'game', manual: { sha256: 'a'.repeat(64) } }, 'cover', 8388608);
    assert.equal(calls[0].init.headers.Authorization, 'Bearer jwt');
    assert.equal(calls[0].init.headers['X-Document-Hash'], undefined);
    const source = await storage.readerSource({ id: 'game', documentId: 'main', legacyManual: true, manual: { sha256: 'a'.repeat(64) } });
    assert.match(source.url, /\/manual$/);
    assert.deepEqual(source.headers, { Authorization: 'Bearer jwt' });
    await assert.rejects(storage.readerSource({ id: 'game', documentId: 'main', manual: { sha256: 'a'.repeat(64) } }), (e) => e.status === 426);
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test('PDFs grandes mantêm blocos de 8 MiB e retomam a partir de 24 MiB sem reenviar blocos', async () => {
  const oldFetch = globalThis.fetch,
    oldStorage = globalThis.localStorage;
  const states = new Map(),
    blockSize = 8 * 1024 * 1024,
    block = new Blob([new Uint8Array(blockSize)]);
  globalThis.localStorage = { getItem: (k) => states.get(k), setItem: (k, v) => states.set(k, v), removeItem: (k) => states.delete(k) };
  try {
    for (const size of [50 * 1024 * 1024 - 1, MAX_PDF_BYTES]) {
      states.clear();
      const blob = new Blob([...Array(Math.floor(size / blockSize)).fill(block), block.slice(0, size % blockSize)], { type: 'application/pdf' });
      let sent = 0,
        interrupted = false,
        starts = 0,
        chunks = 0;
      const progress = [];
      globalThis.fetch = async (url, init) => {
        if (url.endsWith('/health')) return Response.json({ maxPdfBytes: 209715200, fileProtocol: 2 });
        if (url.endsWith('/uploads')) {
          starts++;
          assert.equal(JSON.parse(init.body).size, size);
          return Response.json({ ticket: 'ticket' });
        }
        if (url.endsWith('/status')) return Response.json({ complete: false, received: sent });
        if (url.endsWith('/chunk')) {
          if (size === MAX_PDF_BYTES && sent === 3 * blockSize && !interrupted) {
            interrupted = true;
            return Response.json({ error: 'Sessão interrompida' }, { status: 401 });
          }
          assert.ok(init.body.size <= blockSize);
          assert.equal(init.headers['Content-Range'], `bytes ${sent}-${sent + init.body.size - 1}/${size}`);
          chunks++;
          sent += init.body.size;
          return Response.json({ complete: sent === size, received: sent, ...(sent === size ? { driveFileId: 'file123', receipt: 'receipt' } : {}) });
        }
        throw new Error('URL inesperada');
      };
      const storage = () =>
        createDriveStorage(
          { apiBase: 'https://api.example.test', projectId: 'large-test' },
          async () => 'jwt',
          () => 'owner',
        );
      const put = () => storage().put('games/12345678-1234-1234-1234-123456789abc/manual.pdf', blob, (p) => progress.push(p), { fingerprint: 'a'.repeat(64) });
      if (size === MAX_PDF_BYTES) await assert.rejects(put(), (error) => error.status === 401);
      assert.equal((await put()).driveFileId, 'file123');
      assert.equal(sent, size);
      assert.equal(starts, 1);
      assert.equal(chunks, Math.ceil(size / blockSize));
      assert.equal(progress.at(-1), 100);
    }
    globalThis.fetch = () => assert.fail('Arquivo acima do limite não pode iniciar upload');
    for (const kind of ['manual', 'document'])
      await assert.rejects(
        createDriveStorage(
          { apiBase: 'https://api.example.test' },
          async () => 'jwt',
          () => 'owner',
        ).put('games/game/manual.pdf', { size: MAX_PDF_BYTES + 1 }, () => {}, { kind }),
        /50 MiB/,
      );
  } finally {
    globalThis.fetch = oldFetch;
    globalThis.localStorage = oldStorage;
  }
});

test('upload interrompido retoma após recarregar usando o mesmo jogo, UID e conteúdo', async () => {
  const oldFetch = globalThis.fetch,
    oldStorage = globalThis.localStorage;
  const states = new Map(),
    calls = [],
    id = '12345678-1234-1234-1234-123456789abc';
  globalThis.localStorage = {
    get length() {
      return states.size;
    },
    key: (index) => [...states.keys()][index],
    getItem: (key) => states.get(key) || null,
    setItem: (key, value) => states.set(key, value),
    removeItem: (key) => states.delete(key),
  };
  let sent = 0,
    interrupted = false;
  const blob = new Blob([new Uint8Array(8 * 1024 * 1024 + 3)], { type: 'application/pdf' });
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith('/health')) return Response.json({ maxPdfBytes: 209715200, fileProtocol: 2 });
    assert.equal(init.headers.Authorization, 'Bearer firebase-jwt');
    if (url.endsWith('/uploads')) return Response.json({ ticket: 'opaque-ticket' });
    if (url.endsWith('/status')) return Response.json({ complete: false, received: sent });
    if (url.endsWith('/chunk')) {
      if (sent && !interrupted) {
        interrupted = true;
        return Response.json({ error: 'Entre novamente' }, { status: 401 });
      }
      sent += init.body.size;
      return Response.json(sent === blob.size ? { complete: true, received: sent, driveFileId: 'file123', receipt: 'opaque-receipt' } : { complete: false, received: sent });
    }
    if (url.endsWith('/finalize')) return Response.json({ ok: true });
    throw new Error('Unexpected URL');
  };
  const config = { apiBase: 'https://api.example.test', projectId: 'isolated-test' },
    options = { name: 'manual.pdf', fingerprint: 'a'.repeat(64) };
  const storage = () =>
    createDriveStorage(
      config,
      async () => 'firebase-jwt',
      () => 'owner',
    );
  try {
    await assert.rejects(
      storage().put(`games/${id}/manual.pdf`, blob, () => {}, options),
      (error) => error.status === 401,
    );
    assert.equal(storage().pendingGameId(options.fingerprint), id);
    assert.equal(
      createDriveStorage(
        config,
        async () => '',
        () => 'other-user',
      ).pendingGameId(options.fingerprint),
      '',
    );
    const result = await storage().put(`games/${id}/manual.pdf`, blob, () => {}, options);
    assert.equal(result.driveFileId, 'file123');
    assert.equal(calls.filter(({ url }) => url.endsWith('/uploads')).length, 1);
    assert.equal(calls.filter(({ url }) => url.endsWith('/chunk')).at(-1).init.headers['Content-Range'], `bytes 8388608-8388610/${blob.size}`);
    await storage().finalize(result);
    assert.equal(states.size, 0);
  } finally {
    globalThis.fetch = oldFetch;
    globalThis.localStorage = oldStorage;
  }
});

test('leitor usa somente JWT Firebase e rejeita endereço de API inseguro', async () => {
  const good = createDriveStorage(
    { apiBase: 'https://api.example.test' },
    async () => 'firebase-jwt',
    () => 'owner',
  );
  const source = await good.readerSource({ id: 'game' });
  assert.deepEqual({ url: source.url, headers: source.headers }, { url: 'https://api.example.test/v1/games/game/manual', headers: { Authorization: 'Bearer firebase-jwt' } });
  assert.equal(source.signal.aborted, false);
  good.resetSession();
  assert.equal(source.signal.aborted, true, 'revogação cancela a transferência do leitor');
  for (const apiBase of ['', 'http://remote.example.test', 'https://user:secret@api.example.test', 'https://api.example.test/?token=secret'])
    await assert.rejects(
      createDriveStorage(
        { apiBase },
        async () => '',
        () => '',
      ).readerSource({ id: 'game' }),
    );
});

test('índices diferentes do mesmo PDF não retomam o gzip anterior; hash do documento fica separado do upload', async () => {
  const oldFetch = globalThis.fetch,
    oldStorage = globalThis.localStorage,
    states = new Map(),
    starts = [];
  globalThis.localStorage = { getItem: (key) => states.get(key), setItem: (key, value) => states.set(key, value), removeItem: (key) => states.delete(key) };
  globalThis.fetch = async (url, init) => {
    if (url.endsWith('/uploads')) {
      starts.push(JSON.parse(init.body));
      return Response.json({ ticket: `ticket-${starts.length}` });
    }
    if (url.endsWith('/chunk')) return Response.json({ complete: true, driveFileId: `file-${starts.length}`, receipt: `receipt-${starts.length}` });
    if (url.endsWith('/status')) return Response.json({ complete: true, driveFileId: 'old-file', receipt: 'old-receipt' });
    throw new Error('URL inesperada.');
  };
  try {
    const storage = createDriveStorage(
      { apiBase: 'https://api.example.test', projectId: 'test' },
      async () => 'jwt',
      () => 'owner',
    );
    const options = { kind: 'documentIndex', mimeType: 'application/gzip', documentId: 'main', sourceHash: 'a'.repeat(64), name: 'índice.gz' };
    const first = await storage.put('games/12345678-1234-1234-1234-123456789abc/indexes/main.gz', new Blob(['texto inicial']), () => {}, options);
    const second = await storage.put('games/12345678-1234-1234-1234-123456789abc/indexes/main.gz', new Blob(['texto completo com OCR']), () => {}, options);
    assert.equal(starts.length, 2);
    assert.notEqual(first.resumeKey, second.resumeKey);
    assert(starts.every((start) => start.sourceHash === options.sourceHash));
  } finally {
    globalThis.fetch = oldFetch;
    globalThis.localStorage = oldStorage;
  }
});
