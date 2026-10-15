import { facts, positive, text } from './io.js';

const api = (input, interactive = false) => {
  const url = new URL('https://www.wikidata.org/w/api.php');
  // A documentação permite omitir maxlag em tarefas interativas nas quais a
  // pessoa espera o resultado. Chamadas não interativas continuam usando 5.
  url.search = new URLSearchParams({ format: 'json', ...(interactive ? {} : { maxlag: '5' }), ...input });
  return url.href;
};
const claims = (entity, property) => (entity.claims?.[property] || []).filter((c) => c.rank !== 'deprecated' && c.mainsnak?.snaktype === 'value');
const itemIDs = (entity, property) =>
  claims(entity, property)
    .map((c) => c.mainsnak.datavalue?.value?.id)
    .filter(Boolean);
const preferred = (map, language) => [language === 'pt-BR' ? 'pt-br' : language, 'pt', 'fr', 'en'].map((code) => map?.[code]).find((v) => v?.value);
export function wikidataCandidate(entity, language = 'pt-BR') {
  const bgg = claims(entity, 'P2339')
    .map((c) => c.mainsnak.datavalue?.value)
    .find((v) => /^[1-9]\d{0,8}$/.test(String(v)));
  // Um título homônimo de cidade/filme/videogame nunca basta para identificar um jogo.
  const classes = itemIDs(entity, 'P31');
  if (!classes.includes('Q131436') && !bgg) return null;
  if (classes.some((id) => ['Q7889', 'Q5398426', 'Q21192438'].includes(id))) return null;
  const title = preferred(entity.labels, language),
    description = preferred(entity.descriptions, language);
  if (!title) return null;
  const conflicts = [];
  const quantity = (property, field, max, units) => {
    const all = claims(entity, property);
    // Qualificadores podem distinguir edições; não fundir números dessas afirmações.
    const ambiguous = all.some((c) => Object.keys(c.qualifiers || {}).length);
    const values = [
      ...new Set(
        all
          .filter((c) => !Object.keys(c.qualifiers || {}).length)
          .map((c) => {
            const value = c.mainsnak.datavalue?.value;
            return value && units.includes(value.unit) ? positive(value.amount, max) : null;
          })
          .filter(Boolean),
      ),
    ];
    if (values.length > 1 || ambiguous) {
      conflicts.push(`${field}: afirmações divergentes ou específicas de edição no Wikidata; consulte o PDF.`);
      return null;
    }
    return values[0] || null;
  };
  let min = quantity('P1872', 'Jogadores mínimos', 100, ['1']),
    max = quantity('P1873', 'Jogadores máximos', 100, ['1']);
  if (!min || !max || min > max) min = max = null;
  const names = [];
  for (const [code, value] of Object.entries(entity.labels || {})) names.push({ value: text(value.value), language: code });
  for (const [code, values] of Object.entries(entity.aliases || {})) for (const value of values) names.push({ value: text(value.value), language: code });
  const result = facts(
    'wikidata',
    entity.id,
    `https://www.wikidata.org/wiki/${entity.id}`,
    {
      title: text(title.value),
      description: text(description?.value, 600),
      minPlayers: min,
      maxPlayers: max,
      recommendedAge: quantity('P2899', 'Idade', 100, ['1', 'http://www.wikidata.org/entity/Q24564698']),
      durationMinutes: quantity('P2047', 'Duração', 1440, ['http://www.wikidata.org/entity/Q7727']),
    },
    { names: names.filter((n) => n.value).slice(0, 40), identifiers: { wikidata: entity.id, ...(bgg ? { bgg: String(bgg) } : {}) }, language: title.language, descriptionLanguage: description?.language || '', license: 'CC0', conflicts },
  );
  // P18 é um nome de arquivo no Commons, não uma licença de reprodução da imagem.
  return result;
}
export async function wikidata(input, io) {
  let ids;
  if (input.action === 'detail') ids = [input.id];
  else {
    const languages = [
      ...new Set(
        input.expanded
          ? [input.pdfLanguage, input.preferredLanguage, 'fr', 'en'].map((l) => (l.startsWith('pt') ? 'pt' : l)).filter((l) => ['pt', 'fr', 'en'].includes(l))
          : [input.pdfLanguage === 'fr' ? 'fr' : input.pdfLanguage === 'en' ? 'en' : 'pt'],
      ),
    ];
    const results = await Promise.all(languages.map((language) => io(api({ action: 'wbsearchentities', search: input.query, language, type: 'item', limit: input.expanded ? '15' : '10' }, input.interactive))));
    const hits = results.flatMap((r) => r.search || []).filter((s) => !/video\s*game|videogame|jogo eletr[oô]nico|jeu vid[eé]o|\bfilm\b|film series|media franchise|univers fictif|fictional universe|telegram channel/i.test(s.description || ''));
    const board = (s) => /board game|tabletop game|card game|jogo de tabuleiro|jogo de cartas|jeu de soci[eé]t[eé]|jeu de plateau/i.test(s.description || '');
    // Descrição serve somente para reduzir tráfego. A identidade ainda depende
    // de P31/P2339 na entidade; não usamos essa triagem como informação do jogo.
    hits.sort((a, b) => Number(board(b)) - Number(board(a)));
    ids = [...new Set(hits.map((s) => s.id).filter((id) => /^Q[1-9]\d{0,10}$/.test(id)))].slice(0, input.expanded ? 12 : 8);
  }
  if (!ids.length) return [];
  const data = await io(api({ action: 'wbgetentities', ids: ids.join('|'), props: 'labels|descriptions|aliases|claims', languages: 'pt-br|pt|fr|en' }, input.interactive));
  return Object.values(data.entities || {})
    .map((entity) => wikidataCandidate(entity, input.preferredLanguage))
    .filter(Boolean)
    .slice(0, 10);
}
