import { normalizeText, isTechnicalTitle } from './model.js';
import { reviewedIdentity } from './game-identities.js';
import { textQuality } from './text-quality.js';

const genericTitle =
  /^(livro de(?: regras)?$|manual|regras?|rule\s*book|rules?|instructions?|instru[cç][oõ]es|sum[aá]rio|contents|introdu[cç][aã]o|objetivo|game rules|untitled|document|microsoft|adobe|componente|prepara[cç][aã]o|setup|dura[cç][aã]o|jogadores|players|joueurs|playing time|conte[uú]do|vis[aã]o geral|overview|game overview|règles|livret|sommaire|composants|préparation|mise en place|but du jeu|âge|idade|s[ií]mbolos|assista|nota da editora|amarelo|azul|verde|vermelho|cinza|roxo|édition|edi[cç][aã]o|edition\b|mécaniques|catégories)/i;

export function titleCandidates({ metadataTitle = '', filename = '', lines = [] } = {}) {
  const clean = (value) =>
    String(value)
      .replace(/\.pdf$/i, '')
      .replace(/[_\-–—]+/g, ' ')
      .replace(/^(?:bem vindo ao mundo de|welcome to (?:the world of)?|bienvenue dans)\s+/i, '')
      .replace(/\b(manual|rulebook|regras|rules|pt\s?br|layout|portugu[eê]s|english|fran[cç]ais|french|r[eè]gles|livret)\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .replace(/^[\s\-–:]+|[\s\-–:]+$/g, '')
      .trim();
  const valid = (value) =>
    value.length >= 2 &&
    value.length <= 100 &&
    !isTechnicalTitle(value) &&
    value.split(/\s+/).length <= 12 &&
    /[a-zA-ZÀ-ÿ]/.test(value) &&
    !genericTitle.test(value) &&
    !/^\d+$/.test(value) &&
    !/\b(?:jogadores|players|joueurs|minutos|minutes)\b/i.test(value);
  const titleLines = lines.filter((line) => valid(line.text));
  const largest = Math.max(0, ...lines.map((line) => line.height));
  const identity = reviewedIdentity('', metadataTitle + ' ' + filename);
  const technical = { test: isTechnicalTitle };
  const ranked = [
    ...(identity ? [{ text: identity.names[0].value, source: 'Código editorial do PDF · alias revisado', score: 110 }] : []),
    ...(valid(metadataTitle) && !technical.test(metadataTitle) ? [{ text: clean(metadataTitle), source: 'Metadados do PDF', score: 100 }] : []),
    ...titleLines
      .filter((line) => line.height >= largest * 0.8)
      .sort((a, b) => b.height - a.height)
      .slice(0, 6)
      .map((line, i) => ({ text: clean(line.text), source: 'Título na primeira página', score: 90 - i })),
    { text: clean(filename), source: 'Nome do arquivo', score: 50 },
  ];
  const seen = new Set();
  return ranked.filter((item) => valid(item.text) && !seen.has(normalizeText(item.text)) && seen.add(normalizeText(item.text))).slice(0, 5);
}

export function extractPageMetadata(pages) {
  const combined = extractMetadata(pages.map((p) => p.text).join('\n'));
  const cover = pages.find((p) => p.page === 1);
  if (!cover) return combined;
  // A ficha na capa descreve o jogo. Faixas citadas no corpo podem apenas
  // distinguir regras para subgrupos e não devem invalidar esse cabeçalho.
  const labels = cover.text
    .split(/\n+/)
    .map((s) => s.trim())
    .filter((line) => /^(?:(?:jogadores|players|joueurs)\s*:\s*\d{1,2}(?:\s*[-–aà]\s*\d{1,2})?|\d{1,2}\s*[-–aà]\s*\d{1,2}\s*(?:jogadores|players|joueurs)|(?:idades?|ages?|âge)\s*:?\s*\d{1,2}\s*(?:\+|anos|years|ans)?)\s*$/i.test(line));
  const header = extractMetadata(labels.join('\n'));
  for (const [keys, origin] of [
    [['minPlayers', 'maxPlayers'], 'players'],
    [['recommendedAge'], 'recommendedAge'],
  ]) {
    if (!keys.every((k) => header[k] != null)) continue;
    for (const key of keys) combined[key] = header[key];
    combined.sources[origin] = { ...header.sources[origin], page: 1 };
  }
  return combined;
}

export function extractMetadata(text) {
  // Só aceita números acompanhados da unidade/contexto. Ausência nunca vira estimativa.
  const normalized = String(text)
    .replace(/\u00ad/g, '')
    .replace(/[‐‑–—]/g, '-');
  const playerPatterns = [
    /(?:jogadores|players|joueurs)\s*[:：]?\s*(\d{1,2})\s*(?:a|à|to|até|e|-|–)\s*(\d{1,2})\b/i,
    /\b(\d{1,2})\s*(?:a|à|to|até|e|-|–)\s*(\d{1,2})\s*(?:jogadores|players|joueurs)\b/i,
    /\b(um|uma|one|un|une|dois|two|deux|três|three|trois|quatro|four|quatre|cinco|five|cinq|seis|six)\s+(?:a|à|to|até|e|-)\s+(um|uma|one|un|une|dois|two|deux|três|three|trois|quatro|four|quatre|cinco|five|cinq|seis|six)\s+(?:jogadores|players|joueurs)\b/i,
    /(?:jogadores|players|joueurs)\s*[:：]\s*(\d{1,2})\b/i,
    /\b(\d{1,2})\s*(?:jogadores|players|joueurs)\b/i,
  ];
  // Múltiplas faixas podem pertencer a expansões/cenários; não escolher a primeira.
  const matchesFor = (patterns) => patterns.flatMap((pattern) => [...normalized.matchAll(new RegExp(pattern.source, 'gi'))]);
  const numberWords = { um: 1, uma: 1, one: 1, un: 1, une: 1, dois: 2, two: 2, deux: 2, tres: 3, three: 3, trois: 3, quatro: 4, four: 4, quatre: 4, cinco: 5, five: 5, cinq: 5, seis: 6, six: 6 };
  const playerNumber = (v) => numberWords[normalizeText(v)] || Number(v);
  const ranges = matchesFor(playerPatterns.slice(0, 3));
  const playerMatches = ranges.length ? ranges : matchesFor(playerPatterns.slice(3));
  const uniquePlayers = new Map(playerMatches.map((m) => [playerNumber(m[1]) + ':' + playerNumber(m[2] || m[1]), m]));
  const playerMatch = uniquePlayers.size === 1 ? [...uniquePlayers.values()][0] : null;
  let minPlayers = playerMatch ? playerNumber(playerMatch[1]) : null;
  let maxPlayers = playerMatch ? playerNumber(playerMatch[2] || playerMatch[1]) : null;
  if (minPlayers < 1 || maxPlayers > 100 || minPlayers > maxPlayers) minPlayers = maxPlayers = null;
  const labeledTime =
    /(?:dura[cç][aã]o(?: da partida| do jogo)?|tempo (?:de jogo|de partida)|playing time|playtime|game length|durée(?: du jeu)?|temps de jeu)\s*[:：]?\s*(?:de |from |entre )?(\d{1,3})(?:\s*(?:a|à|to|e|-|até)\s*(\d{1,3}))?\s*(minutos?|minutes?|min\b|horas?|hours?|heures?)/i;
  const rawTime = /\b(\d{1,3})(?:\s*(?:a|à|to|e|-|até)\s*(\d{1,3}))?\s*(minutos?|minutes?|min\b|horas?|hours?|heures?)\b/i;
  const timeMatches = matchesFor([labeledTime]);
  if (!timeMatches.length) timeMatches.push(...matchesFor([rawTime]));
  const times = new Map(
    timeMatches.map((m) => {
      const factor = /hora|hour|heure/i.test(m[3]) ? 60 : 1;
      return [Number(m[1]) * factor + ':' + Number(m[2] || m[1]) * factor, m];
    }),
  );
  const timeMatch = times.size === 1 ? [...times.values()][0] : null;
  const factor = timeMatch && /hora|hour|heure/i.test(timeMatch[3]) ? 60 : 1;
  let minDurationMinutes = timeMatch ? Number(timeMatch[1]) * factor : null,
    maxDurationMinutes = timeMatch ? Number(timeMatch[2] || timeMatch[1]) * factor : null;
  if (minDurationMinutes < 1 || maxDurationMinutes > 1440 || minDurationMinutes > maxDurationMinutes) minDurationMinutes = maxDurationMinutes = null;
  const durationMinutes = minDurationMinutes === maxDurationMinutes ? minDurationMinutes : null;
  const paragraphs = normalized
    .split(/\n/)
    .map((t) => t.trim())
    .filter(Boolean);
  const heading =
    /^(?:resumo|introdu[cç][aã]o(?: ao jogo)?|vis[aã]o geral(?: e objetivo)?|objetivo(?: do jogo| da partida)?|sobre o jogo|contexto|overview|summary|game overview|object of the game|objectif(?: du jeu)?|but du jeu|r[eé]sum[eé])\s*[:：]?\s*/i;
  const stop = /^(?:sum[aá]rio|componentes|conte[uú]do|prepara[cç][aã]o|configura[cç][aã]o|components|setup|composants|préparation|mise en place|cr[eé]ditos|credits)\b/i;
  let description = '';
  for (let i = 0; i < paragraphs.length; i++)
    if ((heading.test(paragraphs[i]) || /^(?:resumo|introducao|visao geral e objetivo|objectif du jeu|but du jeu|resume)$/.test(normalizeText(paragraphs[i]))) && paragraphs[i].length < 160) {
      const pieces = [],
        inline = paragraphs[i].replace(heading, '').trim();
      if (inline.length > 20) pieces.push(inline);
      for (let j = i + 1; j < Math.min(paragraphs.length, i + 14); j++) {
        const line = paragraphs[j];
        if (stop.test(line) || (/^[A-ZÀ-Ü\d ,:-]{4,}$/.test(line) && line.length < 100)) break;
        if (/^\d+$/.test(line)) continue;
        pieces.push(line);
        if (pieces.join(' ').length > 800) break;
      }
      const candidate = pieces.join(' ').replace(/\s+/g, ' ').trim();
      if (candidate.length >= 15) {
        description = candidate.slice(0, 1100);
        break;
      }
    }
  // Sem cabeçalho: aceita somente parágrafo introdutório que declara o jogo,
  // não frases soltas de componentes, exemplos ou sugestões estratégicas.
  if (!description) {
    const start = paragraphs.findIndex((p) =>
      /^(?:neste jogo|controlando\b|assumindo o papel|os jogadores (?:assumem|controlam|exploram)|voc[eê] e seus amigos|em .{2,90}, (?:voc[eê]|os jogadores)|.{2,90} [eé] um jogo|in this game|dans ce jeu)\b/i.test(p),
    );
    if (start >= 0) {
      const pieces = [];
      for (let i = start; i < Math.min(paragraphs.length, start + 14); i++) {
        if (stop.test(paragraphs[i]) || /^escaneie|^assista|^sum[aá]rio/i.test(paragraphs[i])) break;
        pieces.push(paragraphs[i]);
        if (pieces.join(' ').length > 1000) break;
      }
      description = pieces.join(' ').slice(0, 1100);
    }
  }
  if (textQuality(description).corrupt) description = '';
  const sources = {};
  const publisher = normalized.match(/^(?:editora|publisher|[ée]diteur)\s*[:：]\s*(.{2,100})$/im);
  const year = normalized.match(/^(?:ano(?: de publica[cç][aã]o)?|publication year|year|ann[ée]e)\s*[:：]\s*((?:19|20)\d{2})\b/im);
  if (publisher) sources.publisher = { source: 'PDF · editora explícita', excerpt: publisher[1].trim() };
  if (year) sources.year = { source: 'PDF · ano explícito', excerpt: year[1] };
  const originalTitle = normalized.match(/^(?:t[ií]tulo original|original title|titre original)\s*[:：]\s*(.{2,160})$/im);
  if (originalTitle) sources.originalTitle = { source: 'PDF · título original explícito', excerpt: originalTitle[1].trim() };
  if (minPlayers) sources.players = { source: 'PDF', excerpt: playerMatch[0] };
  else if (uniquePlayers.size > 1)
    sources.players = {
      source: 'PDF · faixas diferentes; conferir jogo básico, expansão e edição',
      excerpt: [...uniquePlayers.values()]
        .map((m) => m[0])
        .join(' / ')
        .slice(0, 500),
    };
  if (timeMatch) sources.duration = { source: 'PDF', excerpt: timeMatch[0] };
  else if (times.size > 1)
    sources.duration = {
      source: 'PDF · durações diferentes; conferir edição/cenário',
      excerpt: [...times.values()]
        .map((m) => m[0])
        .join(' / ')
        .slice(0, 500),
    };
  if (description) sources.description = { source: 'PDF · objetivo do jogo', excerpt: description };
  const age =
    normalized.match(/(?<![a-zà-ÿ])(?:idades?(?: recomendada)?|ages?|age recommendation|âge|age conseillé)\s*[:：]?\s*(\d{1,2})\s*(?:\+|anos|years|ans)?/i) ||
    normalized.match(/(?:a partir (?:de|dos)|maiores de|idades? de)\s+(\d{1,2})\s*anos|\b(\d{1,2})\s*(?:anos?\s*(?:ou mais|em diante)|years (?:and up|and older)|ans et plus)/i);
  const ageEvidence = age || normalized.match(/(?:à partir de|dès)\s+(\d{1,2})\s*ans/i);
  const recommendedAge = ageEvidence && Number(ageEvidence[1] || ageEvidence[2]) >= 1 ? Number(ageEvidence[1] || ageEvidence[2]) : null;
  const type = normalized.match(/(?:jogo|game|jeu)\s+(cooperativo|competitivo|por equipes|cooperative|competitive|team[- ]based|coopératif|compétitif)/i) || normalized.match(/(cooperative|competitive|team[- ]based)\s+game/i);
  const types = {
    coopératif: 'Cooperativo',
    compétitif: 'Competitivo',
    cooperative: 'Cooperativo',
    cooperativo: 'Cooperativo',
    competitive: 'Competitivo',
    competitivo: 'Competitivo',
    'por equipes': 'Por equipes',
    'team-based': 'Por equipes',
    'team based': 'Por equipes',
  };
  const cooperation = normalized.match(/(?:trabalhando em equipe,?\s+todos|todos (?:os jogadores )?(?:vencem|ganham|perdem) juntos|os jogadores (?:cooperam|colaboram) (?:entre si|para))/i);
  const opposition = normalized.match(/(?:entre voc[eê] e seu oponente|cada jogador compete contra|um jogo para dois jogadores que competem)/i);
  const gameType = type ? types[type[1].toLowerCase()] || '' : cooperation ? 'Cooperativo' : opposition ? 'Competitivo' : '';
  const editionMatch = normalized.match(/^(?:edi[cç][aã]o|vers[aã]o|edition|édition|version)\s*[:：]\s*(.{1,100})$/im);
  const edition = editionMatch?.[1]?.trim() || '';
  const mechanicsMatch = normalized.match(/^(?:mec[aâ]nicas?|mechanics|mécaniques)\s*[:：]\s*(.{1,320})$/im),
    categoriesMatch = normalized.match(/^(?:categorias?|categories|catégories)\s*[:：]\s*(.{1,320})$/im);
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
  const terms = [
    ['Rolagem de dados', /\b(?:(?:rolagem|lan[cç]amento) de dados|dice rolling|lancer de d[eé]s)\b/i],
    ['Construção de baralho', /\b(?:constru[cç][aã]o de (?:baralho|deck)|deck[- ]building|construction de (?:paquet|deck))\b/i],
    ['Colocação de trabalhadores', /\b(?:(?:coloca[cç][aã]o|aloca[cç][aã]o) de trabalhadores|worker placement|placement d.ouvriers)\b/i],
    ['Controle de área', /\b(?:controle de [aá]rea|area control|contr[oô]le de territoire)\b/i],
  ];
  for (const [label, pattern] of terms) {
    const evidence = normalized.match(pattern);
    if (evidence && !mechanics.some((value) => normalizeText(value) === normalizeText(label))) {
      mechanics.push(label);
      sources.mechanics = { source: 'PDF · termo explícito; confirmar classificação', excerpt: evidence[0] };
    }
  }
  if (!tags.length && gameType === 'Cooperativo') {
    tags.push('Cooperativo');
    sources.tags = { source: 'PDF · cooperação descrita; classificação para revisão', excerpt: (type || cooperation)?.[0] || '' };
  }
  if (!type && (cooperation || opposition)) sources.gameType = { source: 'PDF · modo de interação descrito; confirmar', excerpt: (cooperation || opposition)[0] };
  const vocab = {
    'pt-BR': ['jogadores', 'jogador', 'personagens', 'partida', 'partidas', 'preparação', 'jogo', 'vitória', 'rodada', 'cartas', 'tabuleiro', 'pontos', 'peças'],
    en: ['players', 'player', 'characters', 'setup', 'game', 'victory', 'round', 'cards', 'board', 'points', 'pieces'],
    fr: ['joueurs', 'joueur', 'partie', 'personnages', 'préparation', 'jeu', 'victoire', 'tour', 'cartes', 'plateau', 'points', 'pièces'],
    es: ['jugadores', 'preparación', 'juego', 'victoria', 'ronda', 'cartas', 'tablero', 'puntos', 'fichas'],
  };
  const tokens = new Set(normalized.toLowerCase().split(/[^a-zà-ÿ]+/));
  const scores = Object.entries(vocab)
    .map(([code, words]) => [code, words.filter((w) => tokens.has(w)).length])
    .sort((a, b) => b[1] - a[1]);
  const language = scores[0][1] >= 5 && scores[0][1] >= scores[1][1] * 1.5 ? scores[0][0] : 'other';
  for (const [field, match] of [
    ['recommendedAge', ageEvidence],
    ['gameType', type],
    ['edition', editionMatch],
    ['mechanics', mechanicsMatch],
    ['tags', categoriesMatch],
  ])
    if (match) sources[field] = { source: 'PDF · informação explícita', excerpt: match[0] };
  if (language !== 'other') sources.language = { source: 'PDF · idioma sugerido por vocabulário; confirmar', excerpt: language };
  return { minPlayers, maxPlayers, durationMinutes, minDurationMinutes, maxDurationMinutes, description, recommendedAge, gameType, edition, mechanics, tags, language, sources };
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
