export function normalizeText(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function safeImageUrl(value) {
  if (!value) return '';
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : '';
  } catch {
    return '';
  }
}

export function validateGame(input) {
  const title = String(input.title || '').trim();
  if (!title || title.length > 160) throw new Error('Informe um título com até 160 caracteres.');
  const description = String(input.description || '').trim();
  if (description.length > 2000) throw new Error('A descrição deve ter até 2.000 caracteres.');
  const number = (value, name, max) => {
    if (value === '' || value === undefined || value === null) return null;
    const n = Number(value);
    if (!Number.isInteger(n) || n < 1 || n > max) throw new Error(`${name}: informe um número inteiro entre 1 e ${max}.`);
    return n;
  };
  const minPlayers = number(input.minPlayers, 'Mínimo de jogadores', 100);
  const maxPlayers = number(input.maxPlayers, 'Máximo de jogadores', 100);
  const durationMinutes = number(input.durationMinutes, 'Duração em minutos', 1440);
  if ((minPlayers === null) !== (maxPlayers === null)) throw new Error('Preencha o mínimo e o máximo de jogadores, ou deixe os dois em branco.');
  if (minPlayers > maxPlayers) throw new Error('O mínimo de jogadores não pode superar o máximo.');
  const tags = [
    ...new Set(
      String(input.tags || '')
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
    ),
  ].slice(0, 8);
  if (tags.some((t) => t.length > 40)) throw new Error('Cada categoria deve ter até 40 caracteres.');
  return { title, description, minPlayers, maxPlayers, durationMinutes, tags, language: String(input.language || 'pt-BR').slice(0, 20), isPublic: input.isPublic === true || input.isPublic === 'on' };
}

export function playersLabel(game) {
  return game.minPlayers ? `${game.minPlayers}${game.maxPlayers !== game.minPlayers ? `–${game.maxPlayers}` : ''} ${game.maxPlayers === 1 ? 'jogador' : 'jogadores'}` : 'Jogadores não informados';
}

export function filterGames(games, { query = '', filter = 'all', players = '', sort = 'recent', favorites = [] } = {}) {
  const search = normalizeText(query);
  const result = games.filter((game) => {
    if (search && !normalizeText(`${game.title} ${(game.tags || []).join(' ')}`).includes(search)) return false;
    if (players && !(game.minPlayers <= Number(players) && game.maxPlayers >= Number(players))) return false;
    if (filter === 'favorites' && !favorites.includes(game.id)) return false;
    if (filter === 'solo' && game.minPlayers !== 1) return false;
    if (filter === 'two' && !(game.minPlayers <= 2 && game.maxPlayers >= 2)) return false;
    if (filter === 'quick' && !(game.durationMinutes > 0 && game.durationMinutes <= 30)) return false;
    return true;
  });
  result.sort(sort === 'az' ? (a, b) => a.title.localeCompare(b.title, 'pt-BR') : sort === 'duration' ? (a, b) => (a.durationMinutes || Infinity) - (b.durationMinutes || Infinity) : (a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return result;
}
