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

export function isTechnicalTitle(value = '') {
  return /\.(?:indd|idml|ai|psd|docx?)(?:\b|$)|^(?:microsoft (?:word|powerpoint)|adobe (?:indesign|illustrator))\b|^[A-Z]{2,}[A-Z0-9]*\d{3,}[_\s-]+(?:rulebook|rules|v\d)/i.test(String(value).trim());
}

export function durationRange(game = {}) {
  const explicit = Object.hasOwn(game, 'minDurationMinutes') || Object.hasOwn(game, 'maxDurationMinutes');
  const value = (v) => (v === '' || v == null ? null : Number(v));
  return explicit ? { minDurationMinutes: value(game.minDurationMinutes), maxDurationMinutes: value(game.maxDurationMinutes) } : { minDurationMinutes: value(game.durationMinutes), maxDurationMinutes: value(game.durationMinutes) };
}

export function durationLabel(game, unit = 'min') {
  const { minDurationMinutes: min, maxDurationMinutes: max } = durationRange(game);
  return min > 0 && max >= min ? `${min}${max === min ? '' : '–' + max} ${unit}` : 'Não informada';
}

export const displayTitle = (game) => (isTechnicalTitle(game.title) ? 'Título a revisar' : game.title || 'Jogo sem título');

// Rótulos de catálogo identificam a obra, mas não são sinopses.
export function synopsisText(value) {
  const text = String(value || '').trim();
  return /^(?:(?:a |an |um |un |une )?(?:\d{4} )?(?:board game|tabletop game|card game|jogo de tabuleiro|jogo de cartas|jeu de soci[eé]t[eé]|jeu de plateau)(?: (?:de |from |released in |de l'ann[eé]e )?\d{4})?[.!]?)$/i.test(text) ? '' : text;
}

export function displayDescription(game) {
  const evidence = game.sources?.description;
  const language = evidence?.language || '';
  if (language && language !== 'unknown' && !/^pt(?:-|$)/i.test(language) && !evidence.confirmedAt && !/confirmad|ajustado por você/i.test(evidence.source || '')) return '';
  return synopsisText(game.description);
}

export function validateGame(input) {
  const title = String(input.title || '').trim();
  if (!title || title.length > 160) throw new Error('Informe um título com até 160 caracteres.');
  if (isTechnicalTitle(title)) throw new Error('Este parece ser um título técnico de editoração. Confirme o nome real do jogo antes de salvar.');
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
  const range = durationRange(input),
    minDurationMinutes = number(range.minDurationMinutes, 'Duração mínima', 1440),
    maxDurationMinutes = number(range.maxDurationMinutes, 'Duração máxima', 1440);
  if ((minDurationMinutes === null) !== (maxDurationMinutes === null)) throw new Error('Preencha a duração mínima e máxima, ou deixe as duas em branco.');
  if (minDurationMinutes > maxDurationMinutes) throw new Error('A duração mínima não pode superar a máxima.');
  const durationMinutes = minDurationMinutes === maxDurationMinutes ? minDurationMinutes : null;
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
  const recommendedAge = number(input.recommendedAge, 'Idade recomendada', 100),
    gameType = String(input.gameType || '').trim(),
    edition = String(input.edition || '').trim(),
    mechanics = [
      ...new Set(
        String(input.mechanics || '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      ),
    ].slice(0, 8);
  if (gameType.length > 80 || edition.length > 100 || mechanics.some((s) => s.length > 40)) throw new Error('Revise o tipo, a edição e as mecânicas: os textos excedem o limite.');
  return {
    title,
    description,
    minPlayers,
    maxPlayers,
    durationMinutes,
    minDurationMinutes,
    maxDurationMinutes,
    recommendedAge,
    gameType,
    edition,
    mechanics,
    tags,
    language: String(input.language || 'other').slice(0, 20),
    isPublic: input.isPublic === true || input.isPublic === 'on',
  };
}

// Rascunho para conferência: campos incompletos são editáveis, nunca publicados sem validateGame.
export function normalizeGameDraft(input) {
  const game = {};
  for (const key of ['title', 'description', 'gameType', 'edition', 'language']) game[key] = String(input[key] ?? '').trim();
  for (const key of ['minPlayers', 'maxPlayers', 'minDurationMinutes', 'maxDurationMinutes', 'recommendedAge']) game[key] = input[key] === '' || input[key] == null ? null : Number(input[key]);
  for (const key of ['tags', 'mechanics']) game[key] = (Array.isArray(input[key]) ? input[key] : String(input[key] || '').split(',')).map((value) => String(value).trim()).filter(Boolean);
  game.durationMinutes = game.minDurationMinutes === game.maxDurationMinutes ? game.minDurationMinutes : null;
  game.isPublic = input.isPublic === true || input.isPublic === 'on';
  return game;
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
    if (filter === 'quick' && !(durationRange(game).maxDurationMinutes > 0 && durationRange(game).maxDurationMinutes <= 30)) return false;
    return true;
  });
  result.sort(
    sort === 'az'
      ? (a, b) => displayTitle(a).localeCompare(displayTitle(b), 'pt-BR')
      : sort === 'duration'
        ? (a, b) => (durationRange(a).minDurationMinutes || Infinity) - (durationRange(b).minDurationMinutes || Infinity) || (durationRange(a).maxDurationMinutes || Infinity) - (durationRange(b).maxDurationMinutes || Infinity)
        : (a, b) => (b.createdAt || 0) - (a.createdAt || 0),
  );
  return result;
}
