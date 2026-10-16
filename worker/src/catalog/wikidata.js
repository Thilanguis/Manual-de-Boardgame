import { facts, positive, text, catalogPlans } from './io.js';
import { queryVariants, reviewedIdentity } from '../../../js/game-identities.js';
import { normalizeText } from '../../../js/model.js';

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
const preferred = (map, language, pdfLanguage) => [language === 'pt-BR' ? 'pt-br' : language, 'pt', pdfLanguage === 'fr' ? 'fr' : 'en', 'fr', 'en'].map((code) => map?.[code]).find((v) => v?.value);
export function wikidataCandidate(entity, language = 'pt-BR', classesData = {}, pdfLanguage = '') {
  const bgg = claims(entity, 'P2339')
    .map((c) => c.mainsnak.datavalue?.value)
    .find((v) => /^[1-9]\d{0,8}$/.test(String(v)));
  // Um título homônimo de cidade/filme/videogame nunca basta para identificar um jogo.
  const classes = itemIDs(entity, 'P31');
  if (!classes.some((id) => ['Q131436', 'Q142714', 'Q60474521'].includes(id)) && !bgg) return null;
  if (classes.some((id) => ['Q7889', 'Q5398426', 'Q21192438'].includes(id))) return null;
  const title = preferred(entity.labels, language, pdfLanguage),
    description = preferred(entity.descriptions, language, pdfLanguage);
  if (!title) return null;
  const conflicts = [];
  const quantity = (property, field, max, units, factors = {}) => {
    const all = claims(entity, property);
    // Qualificadores podem distinguir edições; não fundir números dessas afirmações.
    const ambiguous = all.some((c) => Object.keys(c.qualifiers || {}).length);
    const values = [
      ...new Set(
        all
          .filter((c) => !Object.keys(c.qualifiers || {}).length)
          .map((c) => {
            const value = c.mainsnak.datavalue?.value;
            return value && units.includes(value.unit) ? positive(Number(value.amount) * (factors[value.unit] || 1), max) : null;
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
  const explicitItems = (property) => {
    if (claims(entity, property).some((claim) => Object.keys(claim.qualifiers || {}).length)) conflicts.push(`${property}: classificação específica de edição; confira o manual.`);
    return claims(entity, property)
      .filter((claim) => !Object.keys(claim.qualifiers || {}).length)
      .map((claim) => claim.mainsnak.datavalue?.value?.id)
      .filter(Boolean);
  };
  const mechanics = explicitItems('P4151')
    .map((id) => ({ id, label: preferred(classesData[id]?.labels, language, pdfLanguage) }))
    .filter((value) => value.label);
  const genres = explicitItems('P136')
    .filter((id) => !['Q142714', 'Q131436', 'Q3244175'].includes(id))
    .map((id) => ({ id, label: preferred(classesData[id]?.labels, language, pdfLanguage) }))
    .filter((v) => v.label);
  const cooperative = classes.includes('Q1783817');
  const categories = genres.map((v) => text(v.label.value, 40));
  if (cooperative) categories.unshift(language === 'fr' ? 'Coopératif' : language === 'en' ? 'Cooperative' : 'Cooperativo');
  const result = facts(
    'wikidata',
    entity.id,
    `https://www.wikidata.org/wiki/${entity.id}`,
    {
      title: text(title.value),
      gameType: cooperative ? (language === 'fr' ? 'Coopératif' : language === 'en' ? 'Cooperative' : 'Cooperativo') : '',
      tags: [...new Set(categories)].slice(0, 8),
      description: text(description?.value, 600),
      minPlayers: min,
      maxPlayers: max,
      mechanics: mechanics.map((value) => text(value.label.value, 40)).slice(0, 12),
      recommendedAge: quantity('P2899', 'Idade', 100, ['1', 'http://www.wikidata.org/entity/Q24564698', 'http://www.wikidata.org/entity/Q577']),
      durationMinutes: quantity('P2047', 'Duração', 1440, ['http://www.wikidata.org/entity/Q7727', 'http://www.wikidata.org/entity/Q25235'], { 'http://www.wikidata.org/entity/Q25235': 60 }),
    },
    {
      names: names.filter((n) => n.value).slice(0, 40),
      identifiers: { wikidata: entity.id, ...(bgg ? { bgg: String(bgg) } : {}) },
      language: title.language,
      descriptionLanguage: description?.language || '',
      license: 'CC0',
      kind: classes.includes('Q60474521') ? 'expansion' : 'unknown',
      conflicts,
    },
  );
  // P18 é um nome de arquivo no Commons, não uma licença de reprodução da imagem.
  result.fieldReasons = {
    recommendedAge: result.fields.recommendedAge ? '' : 'Wikidata não informou idade inequívoca (P2899).',
    durationMinutes: result.fields.durationMinutes ? '' : 'Duração ausente ou divergente; não calculamos uma média.',
    mechanics: mechanics.length ? '' : 'A fonte não informou mecânicas explícitas (P4151); gênero não é convertido em mecânica.',
    tags: categories.length ? '' : 'Não há gênero/categoria explícitos utilizáveis nesta entidade.',
    gameType: cooperative ? '' : 'A entidade não declara um tipo de partida específico utilizável.',
  };
  result.fieldEvidence = {
    mechanics: mechanics.map((value) => value.id + ' → ' + value.label.value).join('; '),
    gameType: cooperative ? 'P31 → Q1783817 (cooperative board game)' : '',
    tags: genres.map((v) => v.id + ' → ' + v.label.value).join('; '),
  };
  result.fieldLanguages = {
    mechanics: [...new Set(mechanics.map((value) => value.label.language))].join(', ') || language,
    title: title.language,
    description: description?.language || '',
    gameType: language,
    tags: [...new Set(genres.map((v) => v.label.language))].join(', ') || language,
  };
  return result;
}
export async function wikidataEntities(ids, input, io) {
  if (!ids.length) return [];
  const data = await io(api({ action: 'wbgetentities', ids: ids.slice(0, 12).join('|'), props: 'labels|descriptions|aliases|claims|sitelinks', languages: 'pt-br|pt|fr|en' }, input.interactive));
  const entities = Object.values(data.entities || {});
  const classIDs = [...new Set(entities.flatMap((e) => [...itemIDs(e, 'P31'), ...itemIDs(e, 'P136'), ...itemIDs(e, 'P4151')]))].slice(0, 16);
  let classes = {};
  if (classIDs.length) {
    try {
      classes = (await io(api({ action: 'wbgetentities', ids: classIDs.join('|'), props: 'labels', languages: 'pt-br|pt|fr|en' }, input.interactive))).entities || {};
    } catch (error) {
      input.diagnostics?.failures?.push({ stage: 'classificações', error: error.message });
    }
  }
  return entities
    .map((entity) => {
      const candidate = wikidataCandidate(entity, input.preferredLanguage, classes, input.pdfLanguage);
      return candidate ? { ...candidate, sitelinks: entity.sitelinks || {} } : null;
    })
    .filter(Boolean);
}
export async function wikidata(input, io) {
  const diagnostics = (input.diagnostics = { complete: true, queries: [], failures: [], returned: 0 });
  let ids = [];
  const identity = reviewedIdentity(input.query);
  if (input.action === 'detail') ids = [input.id];
  else {
    const plans = queryVariants(input);
    const results = await catalogPlans(plans, async (plan) => {
      const result = await io(api({ action: 'wbsearchentities', search: plan.query, language: plan.language, type: 'item', limit: input.expanded ? '15' : '10' }, input.interactive));
      diagnostics.queries.push({ ...plan, status: 'ok', rawCount: result.search?.length || 0 });
      return result.search || [];
    });
    for (let i = 0; i < results.length; i++) if (results[i].status === 'rejected') diagnostics.failures.push({ ...plans[i], error: results[i].reason.message });
    const hits = results
      .filter((r) => r.status === 'fulfilled')
      .flatMap((r) => r.value)
      .filter((s) => !/video\s*game|videogame|jogo eletr[oô]nico|jeu vid[eé]o|\bfilm\b|media franchise|fictional universe|telegram channel/i.test(s.description || ''));
    const board = (s) => /board game|tabletop game|card game|jogo de tabuleiro|jogo de cartas|jeu de soci[eé]t[eé]|jeu de plateau/i.test(s.description || '');
    hits.sort((a, b) => Number(board(b)) - Number(board(a)));
    ids = [...new Set([...(identity?.wikidata ? [identity.wikidata] : []), ...hits.map((s) => s.id).filter((id) => /^Q[1-9]\d{0,10}$/.test(id))])].slice(0, input.expanded ? 12 : 8);
    if (!ids.length) {
      try {
        const fallback = await io(api({ action: 'query', list: 'search', srnamespace: '0', srsearch: '"' + input.query.replace(/"/g, '') + '"', srlimit: '8', formatversion: '2' }, input.interactive));
        ids = (fallback.query?.search || []).map((v) => v.title).filter((id) => /^Q[1-9]\d{0,10}$/.test(id));
        diagnostics.queries.push({ query: input.query, language: 'multilingual', reason: 'índice de texto completo', status: 'ok', rawCount: ids.length });
      } catch (error) {
        diagnostics.failures.push({ stage: 'índice de texto completo', error: error.message });
      }
    }
    if (identity) diagnostics.identityResolution = { method: 'alias editorial revisado', references: identity.references, editionConfirmed: false };
  }
  const candidates = await wikidataEntities(ids, input, io);
  for (const candidate of candidates)
    if (identity?.wikidata === candidate.id && candidate.identifiers.bgg === identity.bgg) {
      candidate.names.push(...identity.names.map((n) => ({ ...n, origin: 'alias editorial revisado' })));
      candidate.identityNote = identity.editionNote;
      candidate.identityReferences = identity.references;
    }
  diagnostics.complete = diagnostics.failures.length === 0;
  diagnostics.returned = candidates.length;
  return candidates.slice(0, 10);
}
