import { durationSuggestion } from '../../../js/research-duration.js';
import { extractMetadata } from '../../../js/recognition.js';

// Somente a ficha técnica do primeiro template de jogo. Não interpreta código
// MediaWiki nem coleta números de outras seções/expansões do artigo.
export function wikiInfobox(wikitext) {
  const text = String(wikitext || '')
    .slice(0, 30000)
    .replace(/<!--[\s\S]*?-->/g, '');
  const match = /\{\{\s*(?:Infobox\s+(?:board[ _]game|game|jeu de société)|Info\s*\/\s*Jogo)\s*[|\n]/i.exec(text);
  if (!match) return { fields: {}, evidence: {} };
  const params = [],
    start = match.index + 2;
  let depth = 0,
    links = 0,
    part = start;
  for (let i = start; i < text.length; i++) {
    const pair = text.slice(i, i + 2);
    if (pair === '{{') {
      depth++;
      i++;
    } else if (pair === '}}') {
      if (!depth) {
        params.push(text.slice(part, i));
        break;
      }
      depth--;
      i++;
    } else if (pair === '[[') {
      links++;
      i++;
    } else if (pair === ']]') {
      links = Math.max(0, links - 1);
      i++;
    } else if (text[i] === '|' && !depth && !links) {
      params.push(text.slice(part, i));
      part = i + 1;
    }
  }
  const map = new Map(),
    evidence = {},
    fields = {};
  const clean = (value) =>
    value
      .replace(/<ref\b[^>]*>[\s\S]*?<\/ref>|<ref\b[^>]*\/>/gi, '')
      .replace(/\[\[(?:[^\]|]*\|)?([^\]]+)\]\]/g, '$1')
      .replace(/\{\{(?:nowrap|nobr)\|([^{}]*)\}\}/gi, '$1')
      .replace(/<br\s*\/?>/gi, ', ')
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  for (const param of params.slice(1)) {
    const at = param.indexOf('=');
    if (at < 0) continue;
    const key = param.slice(0, at).trim().toLowerCase().replace(/[ _]+/g, '_'),
      value = clean(param.slice(at + 1));
    if (!map.has(key)) map.set(key, value);
    else if (map.get(key) !== value) map.set(key, '');
  }
  const read = (keys) => {
    const values = [...new Set(keys.map((k) => map.get(k)).filter(Boolean))];
    return values.length === 1 ? values[0] : '';
  };
  const players = read(['players', 'jogadores', 'joueurs', 'nb_joueurs']);
  if (players && !/[{}]/.test(players)) {
    const parsed = extractMetadata('Players: ' + players);
    if (parsed.minPlayers && parsed.maxPlayers)
      for (const key of ['minPlayers', 'maxPlayers']) {
        fields[key] = parsed[key];
        evidence[key] = 'Players: ' + players;
      }
  }
  const duration = read(['playing_time', 'playingtime', 'play_time', 'tempo', 'tempo_de_jogo', 'durée', 'duree']);
  // playing_time é uma duração, nunca o tempo de preparação de setup_time.
  const times = duration && !/[{}+<>]|at least|at most|minimum|maximum|environ|about|até|pelo menos/i.test(duration) ? durationSuggestion({ durationMinutes: duration }) : {};
  for (const [key, value] of Object.entries(times)) {
    fields[key] = value;
    evidence[key] = 'Playing time: ' + duration;
  }
  const age = read(['ages', 'age', 'idade', 'idades', 'âge']);
  if (/^\d{1,2}\s*(?:\+|years?(?: and (?:up|older))?|anos?(?: ou mais)?|ans(?: et plus)?)?$/i.test(age)) {
    const value = Number(age.match(/^\d+/)[0]);
    if (value > 0 && value <= 100) {
      fields.recommendedAge = value;
      evidence.recommendedAge = 'Ages: ' + age;
    }
  }
  for (const [field, keys] of [
    ['tags', ['genre', 'genres', 'categoria', 'categorias']],
    ['mechanics', ['mechanics', 'mechanisms', 'mecanicas', 'mécanismes']],
  ]) {
    const raw = read(keys);
    if (!raw || /[{}]/.test(raw)) continue;
    const values = [
      ...new Set(
        raw
          .split(/[,;\n]/)
          .map((s) => s.trim())
          .filter((s) => s && s.length <= 40),
      ),
    ].slice(0, 8);
    if (values.length) {
      fields[field] = values;
      evidence[field] = raw;
    }
  }
  return { fields, evidence };
}
