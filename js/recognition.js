import { normalizeText } from './model.js';

const genericTitle =
  /^(livro de(?: regras)?$|manual|regras?|rule\s*book|rules?|instructions?|instru[cç][oõ]es|sum[aá]rio|contents|introdu[cç][aã]o|objetivo|game rules|untitled|document|microsoft|adobe|componente|prepara[cç][aã]o|setup|dura[cç][aã]o|jogadores|players|playing time|conte[uú]do|vis[aã]o geral|overview|game overview)/i;

export function titleCandidates({ metadataTitle = '', filename = '', lines = [] } = {}) {
  const clean = (value) =>
    String(value)
      .replace(/\.pdf$/i, '')
      .replace(/[_\-–—]+/g, ' ')
      .replace(/\b(manual|rulebook|regras|rules|pt\s?br|layout|portugu[eê]s|english)\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .replace(/^[\s\-–:]+|[\s\-–:]+$/g, '')
      .trim();
  const valid = (value) => value.length >= 2 && value.length <= 100 && /[a-zA-ZÀ-ÿ]/.test(value) && !genericTitle.test(value) && !/^\d+$/.test(value) && !/\b(?:jogadores|players|minutos|minutes)\b/i.test(value);
  const titleLines = lines.filter((line) => valid(line.text));
  const largest = Math.max(0, ...titleLines.map((line) => line.height));
  const ranked = [
    ...(valid(metadataTitle) ? [{ text: clean(metadataTitle), source: 'Metadados do PDF', score: 100 }] : []),
    ...titleLines
      .filter((line) => line.height >= largest * 0.65)
      .sort((a, b) => b.height - a.height)
      .slice(0, 6)
      .map((line, i) => ({ text: clean(line.text), source: 'Título na primeira página', score: 90 - i })),
    { text: clean(filename), source: 'Nome do arquivo', score: 50 },
  ];
  const seen = new Set();
  return ranked.filter((item) => valid(item.text) && !seen.has(normalizeText(item.text)) && seen.add(normalizeText(item.text))).slice(0, 5);
}

export function extractMetadata(text) {
  // Só aceita números acompanhados da unidade/contexto. Ausência nunca vira estimativa.
  const normalized = String(text)
    .replace(/\u00ad/g, '')
    .replace(/[‐‑–—]/g, '-');
  const playerPatterns = [
    /(?:jogadores|players)\s*[:：]?\s*(\d{1,2})\s*(?:a|to|até|e|-|–)\s*(\d{1,2})\b/i,
    /\b(\d{1,2})\s*(?:a|to|até|e|-|–)\s*(\d{1,2})\s*(?:jogadores|players)\b/i,
    /(?:jogadores|players)\s*[:：]\s*(\d{1,2})\b/i,
    /\b(\d{1,2})\s*(?:jogadores|players)\b/i,
  ];
  const playerMatch = playerPatterns.map((pattern) => normalized.match(pattern)).find(Boolean);
  let minPlayers = playerMatch ? Number(playerMatch[1]) : null;
  let maxPlayers = playerMatch ? Number(playerMatch[2] || playerMatch[1]) : null;
  if (minPlayers < 1 || maxPlayers > 100 || minPlayers > maxPlayers) minPlayers = maxPlayers = null;
  const timeMatch =
    normalized.match(/(?:dura[cç][aã]o|tempo (?:de jogo|de partida)|playing time|playtime|game length)\s*[:：]?\s*(\d{1,3})(?:\s*(?:a|to|-|até)\s*(\d{1,3}))?\s*(minutos?|minutes?|min\b|horas?|hours?)/i) ||
    normalized.match(/\b(\d{1,3})(?:\s*(?:a|to|-|até)\s*(\d{1,3}))?\s*(minutos?|minutes?)\s*(?:por partida|de jogo|per game)?/i);
  // Quando o PDF informa uma faixa, preserva-a na evidência e deixa a duração média para revisão.
  const durationMinutes = timeMatch && !timeMatch[2] ? Number(timeMatch[1]) * (/hora|hour/i.test(timeMatch[3]) ? 60 : 1) : null;
  const paragraphs = normalized
    .split(/\n/)
    .map((t) => t.trim())
    .filter(Boolean);
  const objective = paragraphs.findIndex((t) => /^(?:objetivo (?:do jogo|da partida)|vis[aã]o geral|game overview|object of the game|overview)\s*[:：]?\s*$/i.test(t));
  const description =
    objective >= 0
      ? paragraphs
          .slice(objective + 1, objective + 4)
          .join(' ')
          .split(/(?:Componentes|Prepara[cç][aã]o|Components|Setup|Conte[uú]do)/i)[0]
          .slice(0, 600)
          .trim()
      : '';
  const sources = {};
  if (minPlayers) sources.players = { source: 'PDF', excerpt: playerMatch[0] };
  if (timeMatch) sources.duration = { source: 'PDF', excerpt: timeMatch[0] };
  if (description) sources.description = { source: 'PDF · objetivo do jogo', excerpt: description };
  const age = normalized.match(/(?:idade(?: recomendada)?|ages?|age recommendation)\s*[:：]?\s*(\d{1,2})\s*(?:\+|anos|years)?/i) || normalized.match(/\b(\d{1,2})\s*(?:\+\s*anos|anos ou mais|years and up)\b/i);
  const recommendedAge = age && Number(age[1]) >= 1 ? Number(age[1]) : null;
  const type = normalized.match(/(?:jogo|game)\s+(cooperativo|competitivo|por equipes|cooperative|competitive|team[- ]based)/i) || normalized.match(/(cooperative|competitive|team[- ]based)\s+game/i);
  const types = { cooperative: 'Cooperativo', cooperativo: 'Cooperativo', competitive: 'Competitivo', competitivo: 'Competitivo', 'por equipes': 'Por equipes', 'team-based': 'Por equipes', 'team based': 'Por equipes' };
  const gameType = type ? types[type[1].toLowerCase()] || '' : '';
  const editionMatch = normalized.match(/^(?:edi[cç][aã]o|vers[aã]o|edition|version)\s*[:：]\s*(.{1,100})$/im);
  const edition = editionMatch?.[1]?.trim() || '';
  const mechanicsMatch = normalized.match(/^(?:mec[aâ]nicas?|mechanics)\s*[:：]\s*(.{1,320})$/im),
    categoriesMatch = normalized.match(/^(?:categorias?|categories)\s*[:：]\s*(.{1,320})$/im);
  const list = (match) =>
    match
      ? match[1]
          .split(/[,;]/)
          .map((s) => s.trim().slice(0, 40))
          .filter(Boolean)
          .slice(0, 8)
      : [];
  const mechanics = list(mechanicsMatch),
    tags = list(categoriesMatch);
  const vocab = {
    'pt-BR': ['jogadores', 'preparação', 'jogo', 'vitória', 'rodada', 'cartas', 'tabuleiro', 'pontos', 'peças'],
    en: ['players', 'setup', 'game', 'victory', 'round', 'cards', 'board', 'points', 'pieces'],
    es: ['jugadores', 'preparación', 'juego', 'victoria', 'ronda', 'cartas', 'tablero', 'puntos', 'fichas'],
  };
  const tokens = new Set(normalized.toLowerCase().split(/[^a-zà-ÿ]+/));
  const scores = Object.entries(vocab)
    .map(([code, words]) => [code, words.filter((w) => tokens.has(w)).length])
    .sort((a, b) => b[1] - a[1]);
  const language = scores[0][1] >= 5 && scores[0][1] >= scores[1][1] * 1.5 ? scores[0][0] : 'other';
  for (const [field, match] of [
    ['recommendedAge', age],
    ['gameType', type],
    ['edition', editionMatch],
    ['mechanics', mechanicsMatch],
    ['tags', categoriesMatch],
  ])
    if (match) sources[field] = { source: 'PDF · informação explícita', excerpt: match[0] };
  if (language !== 'other') sources.language = { source: 'PDF · idioma sugerido por vocabulário; confirmar', excerpt: language };
  return { minPlayers, maxPlayers, durationMinutes, description, recommendedAge, gameType, edition, mechanics, tags, language, sources };
}

export function linesFromItems(items) {
  const lines = [];
  for (const item of items) {
    if (!item.str || !item.transform) continue;
    const y = item.transform[5];
    let line = lines.find((line) => Math.abs(line.y - y) < 3);
    if (!line) {
      line = { y, height: 0, chunks: [] };
      lines.push(line);
    }
    line.height = Math.max(line.height, item.height || Math.abs(item.transform[3]));
    line.chunks.push({ x: item.transform[4], text: item.str });
  }
  return lines
    .sort((a, b) => b.y - a.y)
    .map((line) => ({
      text: line.chunks
        .sort((a, b) => a.x - b.x)
        .map((item) => item.text)
        .join(' ')
        .trim(),
      height: line.height,
    }));
}
