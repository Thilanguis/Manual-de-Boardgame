// Somente códigos públicos e mensagens controladas; nunca respostas brutas do Google.
export const DRIVE_MESSAGES = Object.freeze({
  'drive/oauth-expired': 'Conexão com Google Drive indisponível. O proprietário precisa renovar a autorização.',
  'drive/oauth-client': 'A configuração OAuth do Google Drive foi recusada. O proprietário precisa conferir o cliente e seus secrets.',
  'drive/oauth-rejected': 'O Google recusou a autorização do Drive. O proprietário precisa conferir a conexão.',
  'drive/configuration': 'A conexão do Google Drive precisa ser configurada pelo proprietário.',
  'drive/permission': 'O Google Drive recusou o acesso ao arquivo. O proprietário precisa conferir as permissões e o acesso concedido ao aplicativo.',
  'drive/file-permission': 'O Google Drive recusou acesso a este arquivo. O proprietário precisa conferir suas permissões e o acesso concedido ao aplicativo.',
  'drive/unavailable': 'O Google Drive está temporariamente indisponível. O catálogo foi preservado; tente novamente mais tarde.',
  'drive/rate-limit': 'O Google Drive limitou temporariamente as consultas. Aguarde antes de tentar novamente.',
  'drive/file-missing': 'Arquivo não encontrado no Google Drive. Ele pode ter sido removido ou não estar acessível ao aplicativo.',
});
export function centralDriveFailure(error) {
  return !!DRIVE_MESSAGES[error?.code] && !['drive/file-missing', 'drive/file-permission'].includes(error.code);
}
export function driveWarning(error, administrator = false) {
  if (!centralDriveFailure(error)) return '';
  return administrator ? DRIVE_MESSAGES[error.code] : 'Os arquivos da biblioteca estão temporariamente indisponíveis. A administração precisa conferir a conexão com Google Drive.';
}
