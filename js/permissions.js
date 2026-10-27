export const OWNER_UID = '7TitBObtb8a0W8GisSstSM1RHiX2';
export const DRIVE_FOLDER_ID = '1XUgXOYRigMaYuNMbFVcjDp6obEp4r7wR';
export const emptyPermissions = () => ({ approveUsers: false, addGames: false, editGames: false, deleteGames: false });
export const defaultSubadminPermissions = emptyPermissions;
export const subadminPermissions = (value = {}) => ({ ...emptyPermissions(), approveUsers: value?.approveUsers === true, addGames: value?.addGames === true, editGames: value?.editGames === true });
export function accessFor(profile, uid, ownerUid = OWNER_UID) {
  const owner = !!uid && uid === ownerUid && profile?.uid === uid && profile?.role === 'superadmin' && profile?.status === 'approved';
  const subadmin = !!uid && profile?.uid === uid && profile?.role === 'subadmin' && profile?.status === 'approved';
  const reader = !!uid && profile?.uid === uid && profile?.status === 'approved' && (['user', 'subadmin'].includes(profile.role) || owner);
  const rights = {
    canRead: reader,
    canApproveUsers: owner || (subadmin && profile.permissions?.approveUsers === true),
    canAdd: owner || (subadmin && profile.permissions?.addGames === true),
    canEdit: owner || (subadmin && profile.permissions?.editGames === true),
    canDelete: owner,
    canManageUsers: owner,
    canConfigure: owner,
    canReadAll: owner || subadmin,
    canAskRules: reader,
  };
  return { ...rights, canWrite: rights.canAdd || rights.canEdit || rights.canDelete, isOwner: owner };
}
export function profileSummary(profile) {
  return { role: profile.role, status: profile.status, permissions: { ...profile.permissions }, ...(Object.hasOwn(profile, 'blockedFrom') ? { blockedFrom: profile.blockedFrom || '' } : {}) };
}
export function unblockedStatus(current, event) {
  if (['approved', 'pending', 'rejected'].includes(current.blockedFrom)) return current.blockedFrom;
  if (event?.action === 'block' && event.targetType === 'user' && event.targetId === current.uid && event.version === current.version && event.after?.status === 'blocked' && event.after?.role === current.role && ['approved', 'pending', 'rejected'].includes(event.before?.status)) return event.before.status;
  return 'pending';
}
export function userChange(current, action, permissions = defaultSubadminPermissions(), previousBlockEvent) {
  if (current.uid === OWNER_UID || current.role === 'superadmin') throw new Error('A conta do proprietário está protegida.');
  const next = { ...profileSummary(current) };
  if (action === 'approve' || action === 'reject') {
    if (current.status !== 'pending' || current.role !== 'user') throw new Error('Esta solicitação já foi analisada.');
    next.status = action === 'approve' ? 'approved' : 'rejected';
  } else if (action === 'promote') {
    if (current.status !== 'approved' || current.role !== 'user') throw new Error('Aprove a conta antes de promover a subadministrador.');
    next.role = 'subadmin';
    next.permissions = subadminPermissions(permissions);
  } else if (action === 'demote') {
    if (current.role !== 'subadmin') throw new Error('Esta conta não é subadministradora.');
    next.role = 'user';
    next.permissions = emptyPermissions();
  } else if (action === 'permissions') {
    if (current.role !== 'subadmin') throw new Error('Esta conta não é subadministradora.');
    next.permissions = subadminPermissions(permissions);
  } else if (action === 'block') {
    if (current.status === 'blocked') throw new Error('Esta conta já está bloqueada.');
    next.status = 'blocked';
    next.blockedFrom = current.status;
  } else if (action === 'unblock') {
    if (current.status !== 'blocked') throw new Error('Esta conta não está bloqueada.');
    next.status = unblockedStatus(current, previousBlockEvent);
    if (Object.hasOwn(current, 'blockedFrom')) next.blockedFrom = '';
  } else throw new Error('Operação desconhecida.');
  if (current.status === 'blocked' && next.status === 'blocked' && !next.blockedFrom) next.blockedFrom = unblockedStatus(current, previousBlockEvent);
  next.permissions = next.role === 'subadmin' ? subadminPermissions(next.permissions) : emptyPermissions();
  return next;
}
export const roleLabel = (role) => ({ superadmin: 'Administrador principal', subadmin: 'Subadministrador', user: 'Usuário' })[role] || 'Visitante';
export const statusLabel = (status) => ({ pending: 'Aguardando aprovação', approved: 'Aprovado', rejected: 'Cadastro recusado', blocked: 'Conta bloqueada' })[status] || 'Sem perfil';
