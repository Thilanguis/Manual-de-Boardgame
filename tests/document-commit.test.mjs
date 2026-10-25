import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocumentRepository } from '../js/document-repository.js';
const id = '12345678-1234-1234-1234-123456789abc',
  docId = '22345678-1234-1234-1234-123456789abc';
const hash = 'a'.repeat(64),
  other = 'b'.repeat(64);
const main = { id: 'main', name: 'Regras', language: 'pt-BR', edition: '', documentType: 'principal', manual: { name: 'regras.pdf', sha256: hash, pages: 13, driveFileId: 'principal', path: `games/${id}/manual.pdf` } };
const addition = { id: docId, name: 'Tomo do traidor', language: 'pt-BR', edition: '', documentType: 'complemento', manual: { name: 'traidor.pdf', sha256: other, pages: 60 } };
function fixture(onUpload = () => {}, failCommit = false) {
  let game = { id, title: 'Betrayal', description: 'Antes', language: 'pt-BR', manual: main.manual, documents: { main }, primaryDocumentId: 'main' };
  const calls = { fullSave: 0, discarded: 0, finalized: 0 };
  const repository = {
    mode: 'firebase',
    session: { canRead: true, canEdit: true, user: { uid: 'owner' } },
    getManual() {},
    async saveGame() {
      calls.fullSave++;
      throw new Error('Não deve regravar o cadastro inteiro');
    },
  };
  const files = {
    async put() {
      onUpload(game);
      return { driveFileId: 'complemento', receipt: 'fixture' };
    },
    async finalize() {
      calls.finalized++;
    },
    async discard() {
      calls.discarded++;
    },
  };
  const sdk = {
    doc: () => id,
    serverTimestamp: () => ({ toMillis: () => 100 }),
    async getDocFromServer() {
      return { exists: () => true, data: () => game };
    },
    async runTransaction(db, action) {
      if (failCommit) throw new Error('Indisponível');
      await action({
        async get() {
          return { exists: () => true, data: () => game };
        },
        update(ref, patch) {
          game = { ...game, ...patch };
        },
      });
    },
  };
  return { repository, docs: createDocumentRepository(repository, { files, sdk, db: {} }), game: () => game, calls };
}

test('ordenar exige administrador; subadministrador com edição não pode alterar a ordem', async () => {
  const f = fixture();
  await assert.rejects(f.docs.reorderDocuments(f.game(), ['main']), /Somente o administrador/);
  await assert.rejects(f.docs.setPrimaryDocument(f.game(), 'main'), /Somente o administrador/);
  f.repository.session.isOwner = true;
  const before = structuredClone(f.game());
  const result = await f.docs.reorderDocuments(f.game(), ['main']);
  assert.deepEqual(result.documentOrder, ['main']);
  assert.deepEqual(result.documents, before.documents);
  assert.deepEqual(result.manual, before.manual);
  assert.equal(f.calls.fullSave + f.calls.finalized + f.calls.discarded, 0);
  await assert.rejects(f.docs.reorderDocuments(f.game(), ['main', 'main']), /lista de PDFs mudou/);
  await assert.rejects(f.docs.reorderDocuments(f.game(), ['unknown']), /lista de PDFs mudou/);
  f.repository.session.canRead = false;
  await assert.rejects(f.docs.reorderDocuments(f.game(), ['main']), /conta aprovada/);
});

test('ordenar não sobrescreve nova ordem salva em outra sessão', async () => {
  const f = fixture();
  f.repository.session.isOwner = true;
  f.game().documents[docId] = addition;
  const stale = structuredClone(f.game());
  f.game().documentOrder = [docId, 'main'];
  await assert.rejects(f.docs.reorderDocuments(stale, [docId, 'main']), /ordem mudou/);
});
test('concluir PDF preserva alterações e outros complementos gravados durante o upload', async () => {
  const extraId = '32345678-1234-1234-1234-123456789abc';
  const f = fixture((game) => {
    game.description = 'Corrigido em outra sessão';
    game.documents[extraId] = { ...addition, id: extraId, name: 'Sobreviventes' };
  });
  const saved = await f.docs.saveDocument(f.game(), addition, new Blob(['pdf']));
  assert.equal(Object.keys(saved.documents).length, 3);
  assert.equal(saved.description, 'Corrigido em outra sessão');
  assert.equal(saved.documents[extraId].name, 'Sobreviventes');
  assert.equal(f.calls.fullSave, 0);
  assert.equal(f.calls.finalized, 1);
});
test('falha do vínculo preserva o upload para retomar e nunca anuncia sucesso', async () => {
  const f = fixture(() => {}, true);
  await assert.rejects(f.docs.saveDocument(f.game(), addition, new Blob(['pdf'])), /PDF já foi enviado.*Indisponível/);
  assert.equal(f.calls.discarded, 0);
  assert.equal(f.calls.finalized, 0);
  assert.equal(Object.keys(f.game().documents).length, 1);
});
test('PDF substituído em outra sessão durante envio não é sobrescrito nem finalizado', async () => {
  const f = fixture((game) => {
    game.documents[docId].manual = { ...addition.manual, sha256: 'c'.repeat(64), driveFileId: 'versao-nova' };
  });
  f.game().documents[docId] = { ...addition, manual: { ...addition.manual, driveFileId: 'anterior' } };
  await assert.rejects(f.docs.saveDocument(f.game(), { ...addition, expectedSourceHash: other }, new Blob(['pdf'])), /mudou em outra sessão/);
  assert.equal(f.game().documents[docId].manual.driveFileId, 'versao-nova');
  assert.equal(f.calls.finalized, 0);
});
test('leitor não pode concluir nem consultar pendências administrativas de uploads', async () => {
  const f = fixture();
  f.repository.session.canEdit = false;
  await assert.rejects(f.docs.pendingDocumentLinks(f.game()), /não pode alterar/);
  await assert.rejects(f.docs.finishPendingDocumentLinks(f.game()), /não pode alterar/);
  assert.equal(f.calls.finalized, 0);
});
