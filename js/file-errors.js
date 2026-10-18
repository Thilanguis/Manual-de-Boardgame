export function fileErrorMessage(error) {
  if (error?.code === 'index/server-update') return 'A pesquisa deste PDF precisa da atualização do servidor.';
  if (error?.code === 'index/access') return 'Não foi possível acessar o índice de pesquisa. As permissões desse recurso precisam ser verificadas no servidor.';
  const status = error?.status || { 'permission-denied': 403, unauthenticated: 401 }[error?.code];
  return (
    {
      401: 'Sua sessão expirou. Entre novamente para abrir o arquivo.',
      403: 'Sua conta não tem acesso a este arquivo, ou o acesso foi revogado.',
      404: 'Arquivo não encontrado. Ele pode ter sido removido ou ainda não estar disponível nesta conexão.',
      409: 'Este documento mudou. Feche e reabra o jogo para consultar a versão atual.',
      410: 'Este arquivo está sendo removido.',
      426: 'A conexão dos documentos precisa ser atualizada para abrir este arquivo.',
    }[status] || (error instanceof TypeError || globalThis.navigator?.onLine === false ? 'Não foi possível carregar o arquivo. Confira sua conexão e tente novamente.' : error?.message || 'Não foi possível abrir o arquivo. Tente novamente.')
  );
}
