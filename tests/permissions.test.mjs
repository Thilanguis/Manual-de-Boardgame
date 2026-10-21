import test from 'node:test';
import assert from 'node:assert/strict';
import { OWNER_UID, accessFor, emptyPermissions, defaultSubadminPermissions, profileSummary, userChange } from '../js/permissions.js';
const account = (role = 'user', status = 'approved', permissions = emptyPermissions()) => ({ uid: 'person', role, status, permissions });

test('aprovação e promoção conservam o formato aceito pelas regras publicadas, sem marcador vazio novo', () => {
  const current = account();
  assert.deepEqual(Object.keys(profileSummary(current)).sort(), ['permissions', 'role', 'status']);
  assert.equal(Object.hasOwn(userChange(current, 'promote'), 'blockedFrom'), false);
  assert.equal(Object.hasOwn(userChange(account('user', 'pending'), 'approve'), 'blockedFrom'), false);
  assert.equal(Object.hasOwn(userChange(account('subadmin'), 'permissions', emptyPermissions()), 'blockedFrom'), false);
  assert.equal(profileSummary({ ...current, blockedFrom: '' }).blockedFrom, '', 'campo já existente continua explícito para limpar um bloqueio');
});

test('aprovação e promoção não concedem flags implicitamente; concessões explícitas são independentes', () => {
  assert.deepEqual(defaultSubadminPermissions(), emptyPermissions());
  const approved = { ...account('user', 'pending'), ...userChange(account('user', 'pending'), 'approve') };
  assert.deepEqual(approved.permissions, emptyPermissions());
  assert.equal(accessFor(approved, approved.uid).canWrite, false);
  const promoted = { ...approved, ...userChange(approved, 'promote') };
  assert.deepEqual(promoted.permissions, emptyPermissions());
  for (const [addGames, editGames] of [[true, false], [false, true], [true, true], [false, false]]) {
    const changed = { ...promoted, ...userChange(promoted, 'permissions', { addGames, editGames, approveUsers: true, deleteGames: true }) };
    const rights = accessFor(changed, changed.uid);
    assert.equal(rights.canAdd, addGames);
    assert.equal(rights.canEdit, editGames);
    assert.equal(rights.canApproveUsers, true);
    assert.equal(rights.canManageUsers, false);
    assert.equal(rights.canDelete, false);
  }
});

test('aprovar cadastros é independente de adicionar/editar e não permite gerenciar cargos', () => {
  const current = account('subadmin', 'approved', { ...emptyPermissions(), approveUsers: true });
  const rights = accessFor(current, current.uid);
  assert.equal(rights.canApproveUsers, true);
  assert.equal(rights.canManageUsers, false);
  assert.equal(rights.canConfigure, false);
  assert.equal(rights.canWrite, false);
  assert.equal(accessFor({ ...current, permissions: emptyPermissions() }, current.uid).canApproveUsers, false);
});

test('flags inconsistentes não concedem poder a usuário comum, bloqueado ou UID divergente', () => {
  const flags = { approveUsers: true, addGames: true, editGames: true, deleteGames: true };
  for (const current of [account('user', 'approved', flags), account('subadmin', 'blocked', flags), account('subadmin', 'pending', flags), { ...account('subadmin', 'approved', flags), uid: 'other' }]) {
    const rights = accessFor(current, 'person');
    assert.equal(rights.canWrite, false);
    assert.equal(rights.canApproveUsers, false);
    assert.equal(rights.canManageUsers, false);
  }
  const sub = account('subadmin', 'approved', flags);
  assert.equal(accessFor({ ...sub, uid: undefined }, undefined).canWrite, false, 'perfil sem identidade autenticada não concede privilégios');
  assert.deepEqual(userChange(sub, 'demote').permissions, emptyPermissions());
  assert.equal(accessFor({ ...sub, ...userChange(sub, 'demote') }, 'person').canWrite, false);
  const owner = { uid: OWNER_UID, role: 'superadmin', status: 'approved' };
  assert.equal(accessFor(owner, OWNER_UID).canDelete, true);
  assert.throws(() => userChange(owner, 'block'), /protegida/);
});

test('desbloqueio restaura status anterior sem aprovar pendentes, rejeitados ou legados desconhecidos', () => {
  for (const status of ['pending', 'approved', 'rejected']) {
    const current = account('user', status);
    const blocked = { ...current, ...userChange(current, 'block') };
    assert.equal(blocked.status, 'blocked');
    assert.equal(blocked.blockedFrom, status);
    const restored = { ...blocked, ...userChange(blocked, 'unblock') };
    assert.equal(restored.status, status);
    assert.equal(restored.blockedFrom, '');
  }
  assert.equal(userChange(account('user', 'blocked'), 'unblock').status, 'pending');
  const blocked = { ...account('subadmin', 'blocked'), version: 2 };
  const event = { action: 'block', targetType: 'user', targetId: blocked.uid, version: 2, before: { status: 'approved' }, after: { status: 'blocked', role: 'subadmin' } };
  assert.equal(userChange(blocked, 'unblock', undefined, event).status, 'approved');
  assert.equal(userChange(blocked, 'unblock', undefined, { ...event, targetId: 'other' }).status, 'pending');
  const explicit = account('subadmin', 'approved', { ...emptyPermissions(), editGames: true });
  assert.deepEqual(userChange(explicit, 'block').permissions, explicit.permissions);
});
