export const OWNER_UID = '7TitBObtb8a0W8GisSstSM1RHiX2';
export const DRIVE_FOLDER_ID = '1XUgXOYRigMaYuNMbFVcjDp6obEp4r7wR';
export const emptyPermissions = () => ({ approveUsers: false, addGames: false, editGames: false, deleteGames: false });
export const defaultSubadminPermissions = () => ({ approveUsers: true, addGames: true, editGames: true, deleteGames: false });
export function accessFor(profile, uid, ownerUid = OWNER_UID) {
  const owner = uid === ownerUid && profile?.uid === uid && profile?.role === 'superadmin' && profile?.status === 'approved';
  const subadmin = profile?.uid === uid && profile?.role === 'subadmin' && profile?.status === 'approved';
  const rights = {
    canApproveUsers: owner || (subadmin && profile.permissions?.approveUsers === true),
    canAdd: owner || (subadmin && profile.permissions?.addGames === true),
    canEdit: owner || (subadmin && profile.permissions?.editGames === true),
    canDelete: owner,
    canManageUsers: owner,
    canConfigure: owner,
    canReadAll: owner || subadmin,
  };
  return { ...rights, canWrite: rights.canAdd || rights.canEdit || rights.canDelete, isOwner: owner };
}
export function profileSummary(profile) {
  return { role: profile.role, status: profile.status, permissions: { ...profile.permissions } };
}
export function userChange(current, action, permissions = defaultSubadminPermissions()) {
  const next = { ...profileSummary(current) };
  if (action === 'approve' || action === 'reject') {
    if (current.status !== 'pending' || current.role !== 'user') throw new Error('Esta solicitação já foi analisada.');
    next.status = action === 'approve' ? 'approved' : 'rejected';
  } else if (action === 'promote') {
    if (current.status !== 'approved' || current.role !== 'user') throw new Error('Aprove a conta antes de promover a subadministrador.');
    next.role = 'subadmin';
    next.permissions = { ...permissions, deleteGames: false };
  } else if (action === 'demote') {
    if (current.role !== 'subadmin') throw new Error('Esta conta não é subadministradora.');
    next.role = 'user';
    next.permissions = emptyPermissions();
  } else if (action === 'permissions') {
    if (current.role !== 'subadmin') throw new Error('Esta conta não é subadministradora.');
    next.permissions = { ...permissions, deleteGames: false };
  } else if (action === 'block') {
    if (current.status === 'blocked') throw new Error('Esta conta já está bloqueada.');
    next.status = 'blocked';
  } else if (action === 'unblock') {
    if (current.status !== 'blocked') throw new Error('Esta conta não está bloqueada.');
    next.status = 'approved';
  } else throw new Error('Operação desconhecida.');
  return next;
}
export const roleLabel = (role) => ({ superadmin: 'Administrador principal', subadmin: 'Subadministrador', user: 'Usuário' })[role] || 'Visitante';
export const statusLabel = (status) => ({ pending: 'Aguardando aprovação', approved: 'Aprovado', rejected: 'Cadastro recusado', blocked: 'Conta bloqueada' })[status] || 'Sem perfil';
