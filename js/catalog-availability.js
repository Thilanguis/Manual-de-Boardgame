// Estado derivado do Drive; nunca deve ser persistido no documento do jogo.
export function readableGame(game) {
  return !game.deleting && game._driveAvailability?.available !== false;
}
export function annotateAvailability(games, statuses = new Map()) {
  return games.map((game) => {
    const status = statuses.get(game.id);
    return status && status.manualId === game.manual?.driveFileId ? { ...game, _driveAvailability: status.result } : game;
  });
}
export function unavailableReason(game) {
  if (game.deleting) return 'Exclusão pendente';
  return game._driveAvailability?.reason === 'trashed' ? 'PDF removido para a lixeira do Drive' : 'PDF indisponível no Drive';
}
