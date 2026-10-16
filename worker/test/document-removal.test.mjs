import test from 'node:test';
import assert from 'node:assert/strict';
import { removeDocumentSafely } from '../src/document-assets.js';
import { decodeFields } from '../src/services.js';
import { DRIVE_FOLDER_ID } from '../../js/permissions.js';
const gameId = '12345678-1234-1234-1234-123456789abc',
  docId = '22345678-1234-1234-1234-123456789abc',
  hash = 'b'.repeat(64);
const env = { FIREBASE_PROJECT_ID: 'test-removal', DRIVE_FOLDER_ID, DRIVE_OWNER_EMAIL: 'owner@example.test', GOOGLE_CLIENT_ID: 'fixture', GOOGLE_CLIENT_SECRET: 'fixture', GOOGLE_REFRESH_TOKEN: 'fixture' };
const identity = { uid: 'owner', token: 'fixture' };
const encoded = (v) =>
  typeof v === 'string'
    ? { stringValue: v }
    : typeof v === 'boolean'
      ? { booleanValue: v }
      : typeof v === 'number'
        ? { integerValue: String(v) }
        : Array.isArray(v)
          ? { arrayValue: { values: v.map(encoded) } }
          : { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, value]) => [k, encoded(value)])) } };
async function fixture(run) {
  const previousFetch = globalThis.fetch,
    operations = [],
    faults = {};
  const main = { id: 'main', name: 'Principal', documentType: 'principal', language: 'pt-BR', edition: '', manual: { path: `games/${gameId}/manual.pdf`, driveFileId: 'manual123', sha256: 'a'.repeat(64) } };
  const extra = { ...main, id: docId, name: 'Complemento', manual: { ...main.manual, path: `games/${gameId}/documents/${docId}.pdf`, driveFileId: 'extra123', sha256: hash } };
  let game = { id: gameId, manual: main.manual, documents: { main, [docId]: extra }, primaryDocumentId: 'main', _updateTime: 'version-1' };
  const records = new Map([[`games/${gameId}/indexes/${docId}`, { fileId: 'index123', sourceHash: hash }]]);
  const files = new Map(
    ['manual123', 'extra123', 'index123', 'cover123'].map((id) => [
      id,
      {
        id,
        parents: [DRIVE_FOLDER_ID],
        owners: [{ me: true, emailAddress: env.DRIVE_OWNER_EMAIL }],
        appProperties: { acervoProject: env.FIREBASE_PROJECT_ID, gameId, kind: id === 'extra123' ? 'document' : id === 'index123' ? 'documentIndex' : id === 'cover123' ? 'cover' : 'manual', documentId: docId, sourceHash: hash },
      },
    ]),
  );
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'fixture', expires_in: 3600 });
    if (url.endsWith('documents:commit')) {
      operations.push('commit');
      if (faults.commit) return new Response(null, { status: faults.commit });
      const body = JSON.parse(init.body);
      assert.equal(body.writes.length, 2);
      assert.equal(body.writes[0].currentDocument.updateTime, game._updateTime);
      game = { ...game, ...decodeFields(body.writes[0].update.fields), _updateTime: 'version-2' };
      records.set(`games/${gameId}/removals/${docId}`, decodeFields(body.writes[1].update.fields));
      return Response.json({ writeResults: [{}, {}] });
    }
    if (url.includes('/documents/')) {
      const path = url.split('/documents/')[1];
      if (init.method === 'DELETE') {
        operations.push(`remove-record:${path}`);
        if (faults.recordDelete) return new Response(null, { status: 503 });
        records.delete(path);
        return new Response(null, { status: 204 });
      }
      const data = path === `games/${gameId}` ? game : records.get(path);
      return data ? Response.json({ fields: encoded(data).mapValue.fields, updateTime: game._updateTime }) : new Response(null, { status: 404 });
    }
    if (url.includes('/drive/v3/files/')) {
      const id = url.split('/files/')[1].split('?')[0],
        file = files.get(id);
      if (!file) return new Response(null, { status: 404 });
      if (init.method === 'DELETE') {
        operations.push(`delete:${id}`);
        if (faults.deleteId === id) return new Response(null, { status: 503 });
        files.delete(id);
        return new Response(null, { status: 204 });
      }
      return Response.json(file);
    }
    throw new Error('Chamada não prevista no teste');
  };
  try {
    await run({
      operations,
      faults,
      records,
      files,
      get game() {
        return game;
      },
      set game(value) {
        game = value;
      },
    });
  } finally {
    globalThis.fetch = previousFetch;
  }
}
for (const status of [403, 409, 503])
  test(`falha ${status} ao confirmar o cadastro nunca exclui PDFs`, () =>
    fixture(async (f) => {
      f.faults.commit = status;
      await assert.rejects(removeDocumentSafely(env, identity, gameId, docId));
      assert.ok(f.game.documents[docId]);
      assert.ok(f.files.has('extra123'));
      assert.ok(f.files.has('index123'));
      assert.deepEqual(f.operations, ['commit']);
      assert.equal(f.records.has(`games/${gameId}/removals/${docId}`), false);
    }));
test('exclusão parcial conserva registro recuperável e retoma sem remover outros PDFs/capa', () =>
  fixture(async (f) => {
    f.faults.deleteId = 'index123';
    await assert.rejects(removeDocumentSafely(env, identity, gameId, docId));
    assert.equal(f.game.documents[docId], undefined);
    assert.ok(!f.files.has('extra123'));
    assert.ok(f.files.has('index123'));
    assert.ok(f.records.has(`games/${gameId}/removals/${docId}`));
    delete f.faults.deleteId;
    await removeDocumentSafely(env, identity, gameId, docId);
    assert.ok(f.files.has('manual123'));
    assert.ok(f.files.has('cover123'));
    assert.ok(!f.files.has('index123'));
    assert.equal(f.records.size, 0);
    assert.equal(f.operations.filter((x) => x === 'commit').length, 1);
  }));
test('referência fora do jogo não remove cadastro nem arquivos', () =>
  fixture(async (f) => {
    f.files.get('index123').appProperties.gameId = 'outro';
    await assert.rejects(removeDocumentSafely(env, identity, gameId, docId), (e) => e.status === 403);
    assert.ok(f.game.documents[docId]);
    assert.equal(f.operations.length, 0);
  }));
test('documento recadastrado bloqueia retomada de uma remoção antiga', () =>
  fixture(async (f) => {
    f.faults.deleteId = 'extra123';
    await assert.rejects(removeDocumentSafely(env, identity, gameId, docId));
    const pending = f.records.get(`games/${gameId}/removals/${docId}`);
    f.game = { ...f.game, documents: { ...f.game.documents, [docId]: pending.document } };
    delete f.faults.deleteId;
    await assert.rejects(removeDocumentSafely(env, identity, gameId, docId), (e) => e.status === 409);
    assert.ok(f.files.has('extra123'));
  }));
