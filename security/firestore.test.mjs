import { before, after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, updateDoc, deleteDoc, collection, query, where, getDocs, runTransaction, serverTimestamp, Timestamp, onSnapshot, writeBatch } from 'firebase/firestore';
import { OWNER_UID, emptyPermissions, defaultSubadminPermissions, profileSummary, userChange } from '../js/permissions.js';

let env;
const projectId = 'demo-acervo';
const flags = { approveUsers: true, addGames: true, editGames: true, deleteGames: true };
const stamp = Timestamp.fromMillis(1700000000000);
const profile = (uid, role = 'user', status = 'approved', permissions = emptyPermissions()) => ({ uid, name: uid, email: `${uid}@example.test`, role, status, permissions, createdAt: stamp, updatedAt: stamp, version: 1, lastEventId: '' });
const game = (id) => ({
  id,
  title: 'Manual de teste',
  description: '',
  minPlayers: null,
  maxPlayers: null,
  durationMinutes: null,
  tags: [],
  language: 'pt',
  manual: { path: `games/${id}/manual.pdf`, name: 'manual.pdf', type: 'application/pdf', size: 100, pages: 1, sha256: 'a'.repeat(64), storage: 'drive', driveFileId: 'manual123' },
  cover: {},
  sources: {},
  createdAt: stamp,
  updatedAt: stamp,
  createdBy: OWNER_UID,
  schemaVersion: 1,
  isPublic: false,
  deleting: false,
});
const db = (uid) => (uid ? env.authenticatedContext(uid, { email: `${uid}@example.test` }).firestore() : env.unauthenticatedContext().firestore());
async function change(database, uid, action, permissions, overrides = {}) {
  const eventId = crypto.randomUUID(),
    ref = doc(database, 'users', uid);
  return runTransaction(database, async (tx) => {
    const previous = (await tx.get(ref)).data(),
      next = userChange(previous, action, permissions),
      version = previous.version + 1;
    tx.update(ref, { ...next, version, lastEventId: eventId, updatedAt: serverTimestamp() });
    const actor = overrides.actorUid || (database === ownerDb ? OWNER_UID : 'sub');
    tx.set(doc(database, 'auditEvents', eventId), { id: eventId, targetType: 'user', targetId: uid, actorUid: actor, action, before: profileSummary(previous), after: next, version, createdAt: serverTimestamp(), ...overrides });
  });
}
let ownerDb;
before(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Testes de regras só podem usar o emulador local.');
  const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
  env = await initializeTestEnvironment({ projectId, firestore: { host, port: Number(port), rules: await readFile(new URL('../firestore.rules', import.meta.url), 'utf8') } });
});
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (context) => {
    const database = context.firestore();
    for (const p of [
      profile(OWNER_UID, 'superadmin', 'approved', flags),
      profile('sub', 'subadmin', 'approved', defaultSubadminPermissions()),
      profile('addonly', 'subadmin', 'approved', { ...emptyPermissions(), addGames: true }),
      profile('pending', 'user', 'pending'),
      profile('member'),
      profile('blocked', 'subadmin', 'blocked', defaultSubadminPermissions()),
    ])
      await setDoc(doc(database, 'users', p.uid), p);
    await setDoc(doc(database, 'settings', 'library'), { publicRead: true, version: 1, updatedAt: stamp, lastEventId: '' });
    await setDoc(doc(database, 'games', 'existing'), game('existing'));
    await setDoc(doc(database, 'games', 'published'), { ...game('published'), isPublic: true });
    await setDoc(doc(database, 'admins', 'legacy'), { enabled: true, role: 'admin' });
  });
  ownerDb = db(OWNER_UID);
});
after(async () => env?.cleanup());

test('remoção recuperável é exclusiva do proprietário e exige retirada atômica do documento correto', async () => {
  const extraId = '22345678-1234-1234-1234-123456789abc',
    manual = game('existing').manual;
  const main = { id: 'main', name: 'Principal', documentType: 'principal', language: 'pt', edition: '', manual };
  const extra = { ...main, id: extraId, name: 'Complemento', manual: { ...manual, path: `games/existing/documents/${extraId}.pdf`, driveFileId: 'extra123' } };
  await assertSucceeds(updateDoc(doc(ownerDb, 'games', 'existing'), { documents: { main, [extraId]: extra }, documentChanges: ['main', extraId], primaryDocumentId: 'main', updatedAt: serverTimestamp() }));
  const record = { gameId: 'existing', documentId: extraId, document: extra, indexFileId: '', indexSourceHash: '', removedBy: OWNER_UID };
  const pending = doc(ownerDb, 'games', 'existing', 'removals', extraId);
  await assertFails(setDoc(pending, record));
  const batch = writeBatch(ownerDb);
  batch.update(doc(ownerDb, 'games', 'existing'), { documents: { main }, documentChanges: [], updatedAt: serverTimestamp() });
  batch.set(pending, record);
  await assertSucceeds(batch.commit());
  await assertSucceeds(getDoc(pending));
  for (const uid of [null, 'pending', 'member', 'sub', 'blocked']) {
    const ref = doc(db(uid), 'games', 'existing', 'removals', extraId);
    await assertFails(getDoc(ref));
    await assertFails(deleteDoc(ref));
  }
  await assertFails(updateDoc(pending, { indexFileId: 'foreign123' }));
  await assertSucceeds(deleteDoc(pending));
});

test('limite de 50 MiB vale para manual legado e documentos adicionais, inclusive no cadastro', async () => {
  const sizes = [52428799, 52428800];
  for (const size of [...sizes, 52428801, 104857600, 157286400, 209715200]) {
    const id = `size-${size}`,
      record = game(id);
    record.manual.size = size;
    record.createdAt = serverTimestamp();
    record.updatedAt = serverTimestamp();
    const write = setDoc(doc(ownerDb, 'games', id), record);
    if (size > 52428800) await assertFails(write);
    else await assertSucceeds(write);
    const manual = { ...game('existing').manual, path: 'games/existing/documents/main.pdf', size },
      documents = { main: { id: 'main', name: 'Principal', documentType: 'principal', language: 'pt', edition: '', manual } };
    const update = updateDoc(doc(ownerDb, 'games', 'existing'), { manual, documents, documentChanges: ['main'], primaryDocumentId: 'main', updatedAt: serverTimestamp() });
    if (size > 52428800) await assertFails(update);
    else await assertSucceeds(update);
    const extra = {
      ...documents,
      '00000000-0000-0000-0000-000000000001': { ...documents.main, id: '00000000-0000-0000-0000-000000000001', manual: { ...manual, path: 'games/existing/documents/00000000-0000-0000-0000-000000000001.pdf', driveFileId: 'extra123' } },
    };
    const additional = updateDoc(doc(ownerDb, 'games', 'existing'), { documents: extra, documentChanges: ['00000000-0000-0000-0000-000000000001'], updatedAt: serverTimestamp() });
    if (size > 52428800) await assertFails(additional);
    else await assertSucceeds(additional);
  }
});

test('PDFs antigos acima de 50 MiB permitem leitura, edição dos dados e troca de principal; novos arquivos grandes são recusados', async () => {
  const id = 'legacy-large',
    extraId = '00000000-0000-0000-0000-000000000001';
  const original = { ...game(id), isPublic: true };
  original.manual.size = 104857600;
  const main = { id: 'main', name: 'Principal antigo', documentType: 'principal', language: 'pt', edition: '', manual: original.manual };
  const extra = { ...main, id: extraId, name: 'Complemento antigo', manual: { ...main.manual, size: 157286400, path: `games/${id}/documents/${extraId}.pdf`, driveFileId: 'legacyextra123' } };
  const documents = { main, [extraId]: extra };
  await env.withSecurityRulesDisabled((c) => setDoc(doc(c.firestore(), 'games', id), { ...original, documents, primaryDocumentId: 'main', documentChanges: [] }));
  const ref = doc(ownerDb, 'games', id);
  await assertSucceeds(getDoc(ref));
  await assertSucceeds(updateDoc(ref, { title: 'Dados corrigidos', updatedAt: serverTimestamp() }));
  await assertSucceeds(updateDoc(ref, { documents: { ...documents, [extraId]: { ...extra, name: 'Nome revisado' } }, documentChanges: [extraId], updatedAt: serverTimestamp() }));
  await assertSucceeds(updateDoc(ref, { primaryDocumentId: extraId, manual: extra.manual, language: 'pt', documentChanges: [], updatedAt: serverTimestamp() }));
  const replacement = { ...extra.manual, driveFileId: 'newlarge123', sha256: 'b'.repeat(64) };
  await assertFails(updateDoc(ref, { manual: replacement, documents: { ...documents, [extraId]: { ...extra, manual: replacement } }, documentChanges: [extraId], updatedAt: serverTimestamp() }));
});

test('pesquisa reutilizável é privada, versionada e respeita permissão, autor e jogo existente', async () => {
  const record = { gameId: 'existing', schemaVersion: 1, aliases: ['sina da sociedade'], content: JSON.stringify({ schemaVersion: 1, candidates: [] }), fetchedAt: Date.now(), revision: 1, updatedBy: OWNER_UID, updatedAt: serverTimestamp() };
  for (const uid of [null, 'pending', 'member', 'blocked']) await assertFails(setDoc(doc(db(uid), 'gameResearch', 'existing'), { ...record, updatedBy: uid || 'visitor' }));
  await assertSucceeds(setDoc(doc(ownerDb, 'gameResearch', 'existing'), record));
  for (const uid of [null, 'pending', 'member', 'blocked']) await assertFails(getDoc(doc(db(uid), 'gameResearch', 'existing')));
  await assertSucceeds(getDoc(doc(db('sub'), 'gameResearch', 'existing')));
  await assertSucceeds(getDocs(query(collection(db('sub'), 'gameResearch'), where('aliases', 'array-contains', 'sina da sociedade'))));
  await assertFails(updateDoc(doc(db('sub'), 'gameResearch', 'existing'), { revision: 2, updatedBy: OWNER_UID, updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(db('sub'), 'gameResearch', 'existing'), { revision: 3, updatedBy: 'sub', updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(db('sub'), 'gameResearch', 'existing'), { revision: 2, updatedBy: 'sub', content: 'a'.repeat(120001), updatedAt: serverTimestamp() }));
  await assertSucceeds(updateDoc(doc(db('sub'), 'gameResearch', 'existing'), { revision: 2, updatedBy: 'sub', updatedAt: serverTimestamp() }));
  await assertFails(setDoc(doc(db('sub'), 'gameResearch', 'missing'), { ...record, gameId: 'missing', updatedBy: 'sub' }));
  await assertFails(updateDoc(doc(db('addonly'), 'gameResearch', 'existing'), { revision: 3, updatedBy: 'addonly', updatedAt: serverTimestamp() }));
  await assertFails(deleteDoc(doc(db('sub'), 'gameResearch', 'existing')));
  await assertSucceeds(deleteDoc(doc(ownerDb, 'gameResearch', 'existing')));
});

test('proveniência de catálogo e aliases são salvos apenas por editor aprovado, com leitura privada', async () => {
  const sources = {
    description: { source: 'Wikidata · confirmado', excerpt: 'jogo de tabuleiro', url: 'https://www.wikidata.org/wiki/Q17271', license: 'CC0', language: 'pt', confirmedAt: 1 },
    catalog: {
      source: 'Correspondências confirmadas',
      excerpt: 'Catan',
      matches: [{ source: 'wikidata', id: 'Q17271', identifiers: { bgg: '13' }, names: [{ value: 'Colonizadores de Catan', language: 'pt-br' }], originalFields: { minPlayers: 3 } }],
    },
  };
  await assertSucceeds(updateDoc(doc(db('sub'), 'games', 'existing'), { sources, updatedAt: serverTimestamp() }));
  await assertFails(getDoc(doc(db(), 'games', 'existing')));
  const publicRecord = await assertSucceeds(getDoc(doc(ownerDb, 'games', 'existing')));
  assert.equal(publicRecord.data().sources.catalog.matches[0].id, 'Q17271');
  for (const uid of ['pending', 'member', 'blocked']) await assertFails(updateDoc(doc(db(uid), 'games', 'existing'), { sources, updatedAt: serverTimestamp() }));
});

const guideRecord = (id, revision = 1, overrides = {}) => ({
  gameId: id,
  schemaVersion: 1,
  revision,
  content: JSON.stringify([{ title: 'Objetivo', text: 'Texto revisado.', reviewed: true }]),
  sourceHash: 'a'.repeat(64),
  assets: {},
  indexFileId: '',
  reviewed: true,
  updatedAt: serverTimestamp(),
  updatedBy: OWNER_UID,
  ...overrides,
});
async function publish(database, id, revision = 1, overrides = {}) {
  const eventId = crypto.randomUUID();
  return runTransaction(database, async (tx) => {
    tx.set(doc(database, 'gameGuides', id), { ...guideRecord(id, revision), draftRevision: 1, lastEventId: eventId, ...overrides });
    tx.set(doc(database, 'auditEvents', eventId), {
      id: eventId,
      targetType: 'guide',
      targetId: id,
      actorUid: OWNER_UID,
      action: 'publishGuide',
      before: { revision: revision - 1 },
      after: { revision },
      version: revision,
      createdAt: serverTimestamp(),
    });
  });
}
test('rascunhos privados exigem editGames e controle de revisão', async () => {
  await assertSucceeds(setDoc(doc(ownerDb, 'guideDrafts', 'existing'), guideRecord('existing')));
  for (const uid of [null, 'pending', 'member', 'blocked', 'addonly']) {
    await assertFails(getDoc(doc(db(uid), 'guideDrafts', 'existing')));
    await assertFails(setDoc(doc(db(uid), 'guideDrafts', 'published'), guideRecord('published', 1, { updatedBy: uid || '' })));
  }
  await assertSucceeds(getDoc(doc(db('sub'), 'guideDrafts', 'existing')));
  await assertFails(updateDoc(doc(ownerDb, 'guideDrafts', 'existing'), { content: '[]', updatedAt: serverTimestamp() }));
  await assertSucceeds(setDoc(doc(ownerDb, 'guideDrafts', 'existing'), guideRecord('existing', 2)));
});
test('publicação exige rascunho revisado, versão do PDF, cópia fiel e auditoria', async () => {
  await assertSucceeds(setDoc(doc(ownerDb, 'guideDrafts', 'existing'), guideRecord('existing', 1, { reviewed: false })));
  await assertFails(publish(ownerDb, 'existing'));
  await assertSucceeds(setDoc(doc(ownerDb, 'guideDrafts', 'published'), guideRecord('published')));
  await assertFails(setDoc(doc(ownerDb, 'gameGuides', 'published'), guideRecord('published')));
  await assertFails(publish(ownerDb, 'published', 1, { content: 'Texto diferente do rascunho' }));
  await assertSucceeds(publish(ownerDb, 'published'));
  assert.match((await getDoc(doc(db('member'), 'gameGuides', 'published'))).data().content, /Texto revisado/);
  await assertSucceeds(setDoc(doc(ownerDb, 'guideDrafts', 'published'), guideRecord('published', 2, { content: 'Alteração privada', reviewed: false })));
  assert.match((await getDoc(doc(db('member'), 'gameGuides', 'published'))).data().content, /Texto revisado/);
  await assertSucceeds(updateDoc(doc(ownerDb, 'games', 'published'), { manual: { ...game('published').manual, sha256: 'b'.repeat(64) }, updatedAt: serverTimestamp() }));
  await assertSucceeds(getDoc(doc(db('member'), 'gameGuides', 'published')));
  await assertFails(publish(ownerDb, 'published', 2, { draftRevision: 2 }));
  await assertFails(deleteDoc(doc(db('sub'), 'gameGuides', 'published')));
});
test('guia publicado herda visibilidade do jogo; limpeza é exclusiva do proprietário', async () => {
  await assertSucceeds(setDoc(doc(ownerDb, 'guideDrafts', 'existing'), guideRecord('existing')));
  await assertSucceeds(publish(ownerDb, 'existing'));
  await env.withSecurityRulesDisabled(async (context) => {
    await updateDoc(doc(context.firestore(), 'settings', 'library'), { publicRead: false });
  });
  await assertFails(getDoc(doc(db(), 'gameGuides', 'existing')));
  await assertFails(setDoc(doc(ownerDb, 'guideDeletion', 'existing'), { remaining: [], preserved: false }));
  await assertSucceeds(updateDoc(doc(ownerDb, 'games', 'existing'), { deleting: true, deleteRequestedBy: OWNER_UID, updatedAt: serverTimestamp() }));
  await assertSucceeds(setDoc(doc(ownerDb, 'guideDeletion', 'existing'), { remaining: ['asset123'], preserved: false }));
  await assertFails(getDoc(doc(db('sub'), 'guideDeletion', 'existing')));
  await assertFails(setDoc(doc(ownerDb, 'guideDrafts', 'existing'), guideRecord('existing', 2)));
  await assertSucceeds(deleteDoc(doc(ownerDb, 'guideDrafts', 'existing')));
});

test('visitante não lê catálogo, mesmo com biblioteca antiga marcada pública', async () => {
  const guest = db();
  await assertFails(getDoc(doc(guest, 'games', 'existing')));
  await assertFails(getDocs(query(collection(guest, 'games'), where('deleting', '==', false))));
  await assertFails(setDoc(doc(guest, 'games', 'new'), { ...game('new'), createdAt: serverTimestamp(), updatedAt: serverTimestamp() }));
  await assertFails(getDocs(collection(guest, 'users')));
});
test('registro só cria o próprio pending/user, sem permissões e com e-mail autenticado', async () => {
  const signup = db('new');
  const pending = { ...profile('new', 'user', 'pending'), createdAt: serverTimestamp(), updatedAt: serverTimestamp() };
  await assertSucceeds(setDoc(doc(signup, 'users', 'new'), pending));
  assert.equal((await getDoc(doc(signup, 'users', 'new'))).data().status, 'pending');
  for (const [uid, override] of [
    ['bad-approved', { status: 'approved' }],
    ['bad-role', { role: 'subadmin', permissions: defaultSubadminPermissions() }],
    ['bad-email', { email: 'someone@example.test' }],
  ]) {
    await assertFails(setDoc(doc(db(uid), 'users', uid), { ...profile(uid, 'user', 'pending'), ...override, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }));
  }
  await assertFails(setDoc(doc(signup, 'users', 'other'), { ...pending, uid: 'other' }));
});
test('usuário não altera o próprio status, cargo, permissões nem recria após rejeição', async () => {
  const pendingDb = db('pending');
  for (const patch of [{ status: 'approved' }, { role: 'superadmin' }, { permissions: flags }]) await assertFails(updateDoc(doc(pendingDb, 'users', 'pending'), { ...patch, updatedAt: serverTimestamp() }));
  await assertSucceeds(change(ownerDb, 'pending', 'reject'));
  await assertFails(deleteDoc(doc(pendingDb, 'users', 'pending')));
  await assertFails(setDoc(doc(pendingDb, 'users', 'pending'), { ...profile('pending', 'user', 'pending'), createdAt: serverTimestamp(), updatedAt: serverTimestamp() }));
});
test('somente proprietário aprova; subadmin não recebe poder de aprovação por flag legada', async () => {
  await env.withSecurityRulesDisabled((c) => updateDoc(doc(c.firestore(), 'users', 'sub'), { 'permissions.approveUsers': true }));
  await assertFails(change(db('sub'), 'pending', 'approve'));
  await assertFails(change(db('sub'), 'pending', 'reject'));
  await assertSucceeds(change(ownerDb, 'pending', 'approve'));
  const approved = (await getDoc(doc(db('pending'), 'users', 'pending'))).data();
  assert.equal(approved.role, 'user');
  assert.deepEqual(approved.permissions, emptyPermissions());
  await assertFails(updateDoc(doc(db('pending'), 'games', 'existing'), { title: 'Sem autorização', updatedAt: serverTimestamp() }));
});
test('aprovação aparece em listener real sem atualizar a página', async () => {
  const pendingQuery = query(collection(ownerDb, 'users'), where('status', '==', 'pending'));
  let stop;
  const changed = new Promise((resolve, reject) => {
    stop = onSnapshot(
      pendingQuery,
      (snapshot) => {
        if (snapshot.docs.some((d) => d.id === 'realtime')) resolve();
      },
      reject,
    );
  });
  await assertSucceeds(setDoc(doc(db('realtime'), 'users', 'realtime'), { ...profile('realtime', 'user', 'pending'), createdAt: serverTimestamp(), updatedAt: serverTimestamp() }));
  await changed;
  stop();
});
test('subadmin não promove, bloqueia, modifica permissões ou configura biblioteca', async () => {
  const sub = db('sub');
  await assertFails(change(sub, 'member', 'promote'));
  await assertFails(change(sub, 'member', 'block'));
  await assertFails(change(sub, 'addonly', 'permissions', defaultSubadminPermissions()));
  await assertFails(updateDoc(doc(sub, 'settings', 'library'), { publicRead: false, updatedAt: serverTimestamp() }));
  await assertFails(change(db('addonly'), 'pending', 'approve', undefined, { actorUid: 'addonly' }));
});
test('proprietário promove, restringe, rebaixa, bloqueia e desbloqueia com auditoria', async () => {
  await assertSucceeds(change(ownerDb, 'member', 'promote'));
  await assertSucceeds(change(ownerDb, 'member', 'permissions', { ...emptyPermissions(), addGames: true }));
  await assertSucceeds(change(ownerDb, 'member', 'block'));
  await assertSucceeds(change(ownerDb, 'member', 'unblock'));
  await assertSucceeds(change(ownerDb, 'member', 'demote'));
  const result = (await getDoc(doc(ownerDb, 'users', 'member'))).data();
  assert.equal(result.role, 'user');
  assert.equal(result.version, 6);
  assert.equal((await getDocs(collection(ownerDb, 'auditEvents'))).size, 5);
});
test('proprietário é protegido contra remoção ou mudança, inclusive pelo próprio cliente', async () => {
  for (const database of [ownerDb, db('sub'), db('pending')]) {
    await assertFails(deleteDoc(doc(database, 'users', OWNER_UID)));
    await assertFails(updateDoc(doc(database, 'users', OWNER_UID), { role: 'user', status: 'blocked', updatedAt: serverTimestamp() }));
  }
});
test('alteração sem histórico, histórico forjado ou histórico apagado são negados', async () => {
  await assertFails(updateDoc(doc(ownerDb, 'users', 'pending'), { status: 'approved', version: 2, updatedAt: serverTimestamp(), lastEventId: 'missing' }));
  await assertFails(change(ownerDb, 'pending', 'approve', undefined, { actorUid: 'fake-actor' }));
  await assertFails(change(ownerDb, 'pending', 'approve', undefined, { before: { role: 'superadmin', status: 'approved', permissions: flags } }));
  await assertSucceeds(change(ownerDb, 'pending', 'approve'));
  const audit = (await getDocs(collection(ownerDb, 'auditEvents'))).docs[0];
  await assertFails(deleteDoc(audit.ref));
  await assertFails(updateDoc(audit.ref, { action: 'reject' }));
});
test('adição e edição respeitam flags; subadministrador nunca exclui definitivamente', async () => {
  const add = db('addonly'),
    sub = db('sub');
  await assertSucceeds(setDoc(doc(add, 'games', 'new'), { ...game('new'), createdBy: 'addonly', createdAt: serverTimestamp(), updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(add, 'games', 'existing'), { title: 'Não editar', updatedAt: serverTimestamp() }));
  await assertSucceeds(updateDoc(doc(sub, 'games', 'existing'), { title: 'Edição permitida', updatedAt: serverTimestamp() }));
  await assertFails(deleteDoc(doc(sub, 'games', 'existing')));
  await assertFails(updateDoc(doc(sub, 'games', 'existing'), { deleting: true, deleteRequestedBy: 'sub', updatedAt: serverTimestamp() }));
  await assertSucceeds(deleteDoc(doc(ownerDb, 'games', 'new')));
});
test('bloqueio revoga escrita para uma sessão já autenticada, e leitura', async () => {
  const sub = db('sub');
  await assertSucceeds(updateDoc(doc(sub, 'games', 'existing'), { title: 'Antes do bloqueio', updatedAt: serverTimestamp() }));
  await assertSucceeds(change(ownerDb, 'sub', 'block'));
  await assertFails(updateDoc(doc(sub, 'games', 'existing'), { title: 'Após bloqueio', updatedAt: serverTimestamp() }));
  await assertFails(change(sub, 'pending', 'approve'));
  await assertFails(getDoc(doc(sub, 'games', 'existing')));
});
test('cadastros pendentes, rejeitados, bloqueados e admin legado não ganham escrita', async () => {
  await assertSucceeds(change(ownerDb, 'pending', 'reject'));
  for (const uid of ['pending', 'blocked', 'member', 'legacy']) await assertFails(updateDoc(doc(db(uid), 'games', 'existing'), { title: 'Sem acesso', updatedAt: serverTimestamp() }));
});
test('desligar leitura global exige auditagem e mantém jogos publicados disponíveis', async () => {
  const eventId = crypto.randomUUID();
  await assertSucceeds(
    runTransaction(ownerDb, async (tx) => {
      const ref = doc(ownerDb, 'settings', 'library'),
        before = (await tx.get(ref)).data();
      tx.update(ref, { publicRead: false, version: before.version + 1, updatedAt: serverTimestamp(), lastEventId: eventId });
      tx.set(doc(ownerDb, 'auditEvents', eventId), {
        id: eventId,
        targetType: 'settings',
        targetId: 'library',
        actorUid: OWNER_UID,
        action: 'librarySettings',
        before: { publicRead: true },
        after: { publicRead: false },
        version: 2,
        createdAt: serverTimestamp(),
      });
    }),
  );
  await assertFails(getDoc(doc(db(), 'games', 'existing')));
  await assertFails(getDoc(doc(db(), 'games', 'published')));
  await assertSucceeds(getDoc(doc(db('member'), 'games', 'published')));
});

test('intervalos de duração são validados no servidor sem conceder escrita a leitores', async () => {
  const change = { minDurationMinutes: 60, maxDurationMinutes: 120, durationMinutes: null, updatedAt: serverTimestamp() };
  await assertSucceeds(updateDoc(doc(ownerDb, 'games', 'existing'), change));
  assert.equal((await getDoc(doc(ownerDb, 'games', 'existing'))).data().maxDurationMinutes, 120);
  for (const uid of ['member', 'pending', 'blocked']) await assertFails(updateDoc(doc(db(uid), 'games', 'existing'), { ...change, minDurationMinutes: 30 }));
  for (const values of [
    { minDurationMinutes: 60, maxDurationMinutes: null },
    { minDurationMinutes: 120, maxDurationMinutes: 60 },
    { minDurationMinutes: 0, maxDurationMinutes: 60 },
    { minDurationMinutes: 60.5, maxDurationMinutes: 120 },
    { minDurationMinutes: 60, maxDurationMinutes: 120, durationMinutes: 90 },
  ])
    await assertFails(updateDoc(doc(ownerDb, 'games', 'existing'), { ...change, ...values }));
  await assertSucceeds(updateDoc(doc(ownerDb, 'games', 'existing'), { minDurationMinutes: 45, maxDurationMinutes: 45, durationMinutes: 45, updatedAt: serverTimestamp() }));
  await assertSucceeds(updateDoc(doc(ownerDb, 'games', 'existing'), { minDurationMinutes: null, maxDurationMinutes: null, durationMinutes: null, updatedAt: serverTimestamp() }));
});

test('jogo legado com durationMinutes continua editável sem migração forçada', async () => {
  await assertSucceeds(updateDoc(doc(ownerDb, 'games', 'existing'), { durationMinutes: 45, updatedAt: serverTimestamp() }));
  const legacy = (await getDoc(doc(ownerDb, 'games', 'existing'))).data();
  assert.equal(legacy.durationMinutes, 45);
  assert.equal(Object.hasOwn(legacy, 'minDurationMinutes'), false);
  await assertFails(updateDoc(doc(ownerDb, 'games', 'existing'), { minDurationMinutes: 30, updatedAt: serverTimestamp() }));
});

test('cache privado exige aprovação, pertence à conta e não admite chave trocada pelo cliente', async () => {
  for (const uid of [null, 'pending', 'blocked']) await assertFails(setDoc(doc(db(uid), 'cacheKeys', uid || 'guest'), { key: 'a'.repeat(64) }));
  await assertSucceeds(setDoc(doc(db('member'), 'cacheKeys', 'member'), { key: 'a'.repeat(64) }));
  await assertSucceeds(getDoc(doc(db('member'), 'cacheKeys', 'member')));
  for (const uid of [null, 'pending', 'blocked', 'sub', OWNER_UID]) await assertFails(getDoc(doc(db(uid), 'cacheKeys', 'member')));
  await assertFails(updateDoc(doc(db('member'), 'cacheKeys', 'member'), { key: 'b'.repeat(64) }));
  await assertSucceeds(change(ownerDb, 'member', 'block'));
  await assertFails(getDoc(doc(db('member'), 'cacheKeys', 'member')));
});
test('índice técnico é independente de guia, privado e vinculado ao documento e hash atuais', async () => {
  const ref = (database) => doc(database, 'games', 'published', 'indexes', 'main');
  const data = { documentId: 'main', sourceHash: 'a'.repeat(64), fileId: 'index-123', state: 'ready', revision: 1, updatedAt: serverTimestamp(), updatedBy: OWNER_UID };
  await assertSucceeds(setDoc(ref(ownerDb), data));
  await assertSucceeds(getDoc(ref(db('member'))));
  for (const uid of [null, 'pending', 'blocked']) await assertFails(getDoc(ref(db(uid))));
  await assertFails(setDoc(ref(db('member')), { ...data, revision: 2, updatedBy: 'member' }));
  await assertFails(updateDoc(ref(ownerDb), { sourceHash: 'b'.repeat(64), revision: 2, updatedAt: serverTimestamp() }));
  await assertFails(setDoc(doc(ownerDb, 'games', 'published', 'indexes', 'other'), { ...data, documentId: 'other' }));
  await assertSucceeds(change(ownerDb, 'member', 'block'));
  await assertFails(getDoc(ref(db('member'))));
});
test('múltiplos documentos preservam legado, validam alterações e impedem remoção por subadmin', async () => {
  let documents = { main: { id: 'main', name: 'Principal', documentType: 'principal', language: game('existing').language, edition: '', manual: game('existing').manual } };
  await assertSucceeds(updateDoc(doc(ownerDb, 'games', 'existing'), { documents, documentChanges: ['main'], primaryDocumentId: 'main', updatedAt: serverTimestamp() }));
  for (let n = 1; n < 12; n++) {
    const id = `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
    documents = { ...documents, [id]: { id, name: `Documento ${n}`, documentType: 'referencia', language: 'pt-BR', edition: '', manual: { ...game('existing').manual, path: `games/existing/documents/${id}.pdf`, driveFileId: `document-${n}` } } };
    await assertSucceeds(updateDoc(doc(ownerDb, 'games', 'existing'), { documents, documentChanges: [id], updatedAt: serverTimestamp() }));
  }
  const keys = Object.keys(documents),
    removed = { ...documents };
  delete removed[keys[1]];
  await assertFails(updateDoc(doc(db('sub'), 'games', 'existing'), { documents: removed, documentChanges: [], updatedAt: serverTimestamp() }));
  await assertSucceeds(updateDoc(doc(ownerDb, 'games', 'existing'), { documents: removed, documentChanges: [], updatedAt: serverTimestamp() }));
  await assertFails(updateDoc(doc(db('member'), 'games', 'existing'), { documents: removed, documentChanges: [], updatedAt: serverTimestamp() }));
  const invalid = { ...removed, main: { ...removed.main, manual: { ...removed.main.manual, path: 'personal/private.pdf' } } };
  await assertFails(updateDoc(doc(ownerDb, 'games', 'existing'), { documents: invalid, documentChanges: ['main'], manual: invalid.main.manual, updatedAt: serverTimestamp() }));
});

test('disponibilidade global legada é preservada apenas para contas aprovadas; opção desligada respeita cada jogo', async () => {
  await assertSucceeds(getDoc(doc(db('member'), 'games', 'existing')));
  for (const uid of [null, 'pending', 'blocked']) await assertFails(getDoc(doc(db(uid), 'games', 'existing')));
  await env.withSecurityRulesDisabled((c) => updateDoc(doc(c.firestore(), 'settings', 'library'), { publicRead: false }));
  await assertFails(getDoc(doc(db('member'), 'games', 'existing')));
  await assertSucceeds(getDoc(doc(db('member'), 'games', 'published')));
  await assertSucceeds(getDoc(doc(ownerDb, 'games', 'existing')));
});
