import test from 'node:test';
import assert from 'node:assert/strict';
import { gameDocuments, withDocument, withoutDocument, documentGame, documentName } from '../js/documents.js';
test('principal vem primeiro por padrão; ordem compartilhada prevalece e ignora IDs removidos', () => {
  const main = { id: 'main' }, extra = { id: 'extra' };
  const record = { documents: { extra, main }, primaryDocumentId: 'main' };
  assert.deepEqual(gameDocuments(record).map((doc) => doc.id), ['main', 'extra']);
  assert.deepEqual(gameDocuments({ ...record, documentOrder: ['removed', 'extra', 'main'] }).map((doc) => doc.id), ['extra', 'main']);
});
import { searchDocuments, cleanGuide, staleSection } from '../js/guide-model.js';
import { indexMatches, packIndex, unpackIndex } from '../js/pdf-index.js';
import { accessFor, OWNER_UID } from '../js/permissions.js';
const hash = 'a'.repeat(64),
  other = 'b'.repeat(64),
  id = '12345678-1234-1234-1234-123456789abc';
const game = { id, title: 'Ilha', manual: { name: 'principal.pdf', sha256: hash, pages: 1, path: `games/${id}/manual.pdf` }, language: 'pt-BR' };
const document = { id: '22345678-1234-1234-1234-123456789abc', name: 'Errata', documentType: 'errata', language: 'pt-BR', edition: '2', manual: { name: 'errata.pdf', sha256: other, pages: 1 } };

test('nome do manual é preservado para principal, complementos e nomes personalizados', () => {
  assert.equal(documentName({ name: 'Manual principal', manual: { name: 'Livro_de_regras_202301.pdf' } }), 'Livro de regras 202301');
  assert.equal(documentName({ name: 'Tomo do Traidor', manual: { name: 'arquivo_305303.pdf' } }), 'Tomo do Traidor');
  assert.equal(documentName({ manual: { name: 'Segredos_da_sobrevivencia.pdf' } }), 'Segredos da sobrevivencia');
  assert.equal(documentName({}), 'Manual');
});
test('manual legado é principal virtual sem duplicar arquivo; adicionar, escolher principal e remover são independentes', () => {
  assert.equal(gameDocuments(game)[0].id, 'main');
  const next = withDocument(game, document);
  assert.equal(next.manual, game.manual);
  assert.equal(gameDocuments(next).length, 2);
  const changed = withDocument(next, document, { primary: true });
  assert.equal(changed.manual.sha256, other);
  assert.equal(changed.documents.main.manual.sha256, hash);
  assert.throws(() => withoutDocument(changed, document.id), /principal/);
  assert.equal(gameDocuments(withoutDocument(changed, 'main')).length, 1);
  assert.equal(gameDocuments(game).length, 1);
});
test('busca unificada conserva documento, hash e página sem misturar resultados ou referências antigas', () => {
  const next = withDocument(game, document);
  const indexes = gameDocuments(next).map((doc) => ({
    document: doc,
    index: { schemaVersion: 1, gameId: id, documentId: doc.id, sourceHash: doc.manual.sha256, language: 'pt-BR', pageCount: 1, pages: [{ page: 1, text: `Preparação ${doc.name}: distribua cartas e fichas entre todos os jogadores.` }], headings: [] },
  }));
  const found = searchDocuments(indexes, null, 'preparacao', gameDocuments(next));
  assert.equal(found.length, 2);
  assert.equal(new Set(found.map((r) => r.documentId)).size, 2);
  const guide = cleanGuide({ sourceHash: hash, sections: [{ title: 'Preparação', text: 'Revisado.', page: 1, documentId: document.id, sourceHash: other }] });
  assert.equal(staleSection(next, guide.sections[0], hash), false);
  const replaced = withDocument(next, { ...document, manual: { ...document.manual, sha256: hash } });
  assert.equal(staleSection(replaced, guide.sections[0], hash), true);
  assert.equal(searchDocuments([], guide, 'preparacao', gameDocuments(replaced))[0].page, null);
});
test('mesmo PDF em documentos distintos não autoriza índice associado ao outro documento', async () => {
  const view = documentGame(game, document),
    index = { schemaVersion: 1, gameId: id, documentId: 'main', sourceHash: other, language: 'pt-BR', pageCount: 1, pages: [{ page: 1, text: 'Texto válido.' }], headings: [] };
  assert.equal(indexMatches(index, view), false);
  await assert.rejects(unpackIndex(await packIndex(index), view), /não corresponde/);
});
test('aprovação é delegável por flag; pendentes e bloqueados perdem leitura e todas as mutações', () => {
  const profile = { uid: 'sub', role: 'subadmin', status: 'approved', permissions: { approveUsers: true, addGames: true, editGames: true } };
  assert.equal(accessFor(profile, 'sub').canApproveUsers, true);
  assert.equal(accessFor({ ...profile, permissions: { addGames: true } }, 'sub').canApproveUsers, false);
  assert.equal(accessFor(profile, 'sub').canRead, true);
  for (const status of ['pending', 'rejected', 'blocked']) {
    const a = accessFor({ ...profile, status }, 'sub');
    assert.equal(a.canRead, false);
    assert.equal(a.canWrite, false);
    assert.equal(a.canApproveUsers, false);
  }
  const owner = accessFor({ uid: OWNER_UID, role: 'superadmin', status: 'approved' }, OWNER_UID);
  assert.equal(owner.canApproveUsers, true);
  assert.equal(owner.canDelete, true);
});
