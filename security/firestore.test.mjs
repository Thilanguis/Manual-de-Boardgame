import { before, after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, updateDoc, deleteDoc, collection, query, where, getDocs, runTransaction, serverTimestamp, Timestamp, onSnapshot } from 'firebase/firestore';
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

test('visitante lê catálogo público e manual referenciado sem login, mas não escreve', async () => {
  const guest = db();
  await assertSucceeds(getDoc(doc(guest, 'games', 'existing')));
  await assertSucceeds(getDocs(query(collection(guest, 'games'), where('deleting', '==', false))));
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
test('subadmin aprova ou recusa somente pending/user; usuário aprovado continua comum', async () => {
  await assertSucceeds(change(db('sub'), 'pending', 'approve'));
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
test('bloqueio revoga escrita para uma sessão já autenticada, mas mantém leitura pública', async () => {
  const sub = db('sub');
  await assertSucceeds(updateDoc(doc(sub, 'games', 'existing'), { title: 'Antes do bloqueio', updatedAt: serverTimestamp() }));
  await assertSucceeds(change(ownerDb, 'sub', 'block'));
  await assertFails(updateDoc(doc(sub, 'games', 'existing'), { title: 'Após bloqueio', updatedAt: serverTimestamp() }));
  await assertFails(change(sub, 'pending', 'approve'));
  await assertSucceeds(getDoc(doc(sub, 'games', 'existing')));
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
  await assertSucceeds(getDoc(doc(db(), 'games', 'published')));
});
