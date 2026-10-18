import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocumentRepository } from '../js/document-repository.js';
import { gameDocuments } from '../js/documents.js';
import { packIndex } from '../js/pdf-index.js';
import { fileErrorMessage } from '../js/file-errors.js';

const game = { id: 'game', language: 'pt-BR', manual: { sha256: 'a'.repeat(64), pages: 1, name: 'manual.pdf' } };
const document = gameDocuments(game)[0];
const index = { schemaVersion: 1, gameId: game.id, sourceHash: game.manual.sha256, pageCount: 1, pages: [{ page: 1, text: 'Ataque: o sobrevivente usa a ação de atacar.' }], headings: [] };
function fixture({ protocol = 2, deny = true, guide = null, canEdit = true, canRead = true, assetError } = {}) {
  const calls = { metadata: 0, assets: 0, guides: [] };
  const repository = { mode: 'firebase', session: { canRead, canEdit, user: { uid: 'owner' }, storageStatus: { fileProtocol: protocol } }, getManual() {},
    async getGuide(game, draft) { calls.guides.push(draft); return guide; },
    async getGuideAsset() { calls.assets++; if (assetError) throw assetError; return packIndex(index); },
  };
  const docs = createDocumentRepository(repository, { db: {}, sdk: {
    doc: (...path) => path,
    async getDocFromServer() { calls.metadata++; if (deny) throw Object.assign(new Error('Denied'), { code: 'permission-denied' }); return { exists: () => false }; },
  } });
  return { docs, calls };
}
test('índice legado autorizado continua pesquisável quando coleção nova é negada', async () => {
  const { docs, calls } = fixture({ guide: { sourceHash: game.manual.sha256, indexFileId: 'legacy' } });
  const found = await docs.getTechnicalIndex(game, document);
  assert.equal(found.pages[0].text, index.pages[0].text);
  assert.equal(found.legacyShared, true);
  assert.deepEqual(calls.guides, [false], 'guia publicado não depende do rascunho');
});
test('servidor antigo não consulta a coleção nova nem simula índice vazio', async () => {
  const { docs, calls } = fixture({ protocol: 1 });
  await assert.rejects(docs.getTechnicalIndex(game, document), (error) => error.code === 'index/server-update');
  assert.equal(calls.metadata, 0);
});
test('compatibilidade não usa outro hash, documento ou conteúdo sem autorização', async () => {
  const { docs, calls } = fixture({ guide: { sourceHash: 'b'.repeat(64), indexFileId: 'legacy' } });
  await assert.rejects(docs.getTechnicalIndex(game, document), (error) => error.code === 'index/access');
  assert.equal(calls.assets, 0);
  const denied = fixture({ canRead: false });
  await assert.rejects(denied.docs.getTechnicalIndex(game, document), /conta aprovada/);
  assert.equal(denied.calls.metadata, 0);
  const asset = fixture({ guide: { sourceHash: game.manual.sha256, indexFileId: 'legacy' }, assetError: { status: 403 } });
  await assert.rejects(asset.docs.getTechnicalIndex(game, document), (error) => error.status === 403);
  const extra = fixture({ guide: { sourceHash: game.manual.sha256, indexFileId: 'legacy' } });
  await assert.rejects(extra.docs.getTechnicalIndex(game, { ...document, id: 'other' }), (error) => error.code === 'index/access');
  assert.equal(extra.calls.assets, 0);
});
test('falha do índice é distinguida de revogação do arquivo e da sessão', () => {
  assert.match(fileErrorMessage({ code: 'index/access', status: 403 }), /índice de pesquisa/);
  assert.doesNotMatch(fileErrorMessage({ code: 'index/access', status: 403 }), /revogado|Sua conta/);
  assert.match(fileErrorMessage({ code: 'index/server-update', status: 426 }), /atualização do servidor/);
  assert.match(fileErrorMessage({ status: 403 }), /não tem acesso/);
});
