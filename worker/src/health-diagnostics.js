import { ApiError, permissions } from './auth.js';
import { driveMetadata, belongsToProject } from './services.js';
import { DRIVE_MESSAGES } from '../../js/drive-diagnostics.js';
export const driveConfigured = (env) => [env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, env.GOOGLE_REFRESH_TOKEN, env.DRIVE_FOLDER_ID, env.DRIVE_OWNER_EMAIL, env.TICKET_KEY].every(Boolean);

// identity.profile é o perfil recém-lido e autorizado pelo roteador, não pelo cliente.
export async function diagnoseHealth(env, identity, fetcher = fetch) {
  if (!identity || !permissions(identity.profile, identity.uid, env.OWNER_UID).delete) throw new ApiError(identity ? 403 : 401, 'Somente o administrador principal pode conferir a saúde do Acervo.');
  const configured = driveConfigured(env);
  let drive = { configured, verified: false, state: 'configuration', code: 'drive/configuration', message: DRIVE_MESSAGES['drive/configuration'], check: 'authenticated-folder-read' };
  if (configured) {
    try {
      const folder = await driveMetadata(env, env.DRIVE_FOLDER_ID, fetcher);
      if (!folder || folder.trashed) drive = { ...drive, state: 'missing', code: 'drive/file-missing', message: DRIVE_MESSAGES['drive/file-missing'] };
      else if (!belongsToProject(folder, env, { kind: 'folder' })) drive = { ...drive, state: 'permission', code: 'drive/permission', message: DRIVE_MESSAGES['drive/permission'] };
      else drive = { ...drive, verified: true, state: 'operational', code: '', message: 'Leitura autenticada da pasta autorizada concluída. Os arquivos individuais não foram verificados.' };
    } catch (error) {
      const code = DRIVE_MESSAGES[error.code] ? error.code : 'drive/unavailable';
      const state = code.startsWith('drive/oauth-') ? 'oauth' : code.includes('permission') ? 'permission' : code === 'drive/rate-limit' ? 'limited' : code === 'drive/configuration' ? 'configuration' : 'unavailable';
      drive = { ...drive, state, code, message: DRIVE_MESSAGES[code] };
    }
  }
  return {
    checkedAt: Date.now(),
    firebase: { state: 'operational', verified: true, check: 'authenticated-profile-read', message: 'Login verificado e perfil autorizado lido no Firestore. Não verifica todas as operações do Firebase.' },
    drive,
    gemini: { state: !env.GEMINI_API_KEY ? 'configuration' : env.ALLOW_MANUAL_AI === 'true' ? 'configured' : 'disabled', configured: !!env.GEMINI_API_KEY, enabled: env.ALLOW_MANUAL_AI === 'true', verified: false, check: 'configuration-only', message: 'Nenhuma chamada ao Gemini foi executada. Configuração não comprova disponibilidade, cota ou faturamento.' },
  };
}
