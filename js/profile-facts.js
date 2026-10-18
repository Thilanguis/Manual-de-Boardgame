import { normalizeText } from './model.js';
import { extractMetadata } from './recognition.js';

// Somente campos editoriais já existentes no formulário. Idioma continua sendo o do PDF.
export const profileDefinitions = {
  title: { type: 'string', max: 160 },
  edition: { type: 'string', max: 100 },
  description: { type: 'string', max: 2000 },
  minPlayers: { type: 'integer', max: 100 },
  maxPlayers: { type: 'integer', max: 100 },
  minDurationMinutes: { type: 'integer', max: 1440 },
  maxDurationMinutes: { type: 'integer', max: 1440 },
  recommendedAge: { type: 'integer', max: 100 },
  tags: { type: 'array', max: 8 },
  mechanics: { type: 'array', max: 8 },
  gameType: { type: 'string', max: 80 },
};
export const PROFILE_INSTRUCTION =
  'Além das seções, preencha metadata com a ficha estruturada do jogo, somente quando sustentada pelas fontes: título oficial (não invente tradução), edição, descrição curta em PT-BR, jogadores mínimos/máximos, duração mínima/máxima em minutos, idade, categorias/temas em tags, mecânicas e tipo (inclua Jogo base ou Expansão somente se comprovado). Cada campo contém value, sourceId e a referência de evidência exigida. Use o mesmo passage que sustenta o valor, não um título genérico. Não use contagens de componentes como jogadores ou idade. Faixas devem vir da mesma fonte e manter mínimo <= máximo. Não confunda idioma do manual com edição. Categorias e mecânicas devem estar em PT-BR. Omita campos desconhecidos; não use zero nem valores aproximados inventados. Esta ficha é adicional e não altera as instruções das seções de regras.';

export function profileSchema(manual) {
  return {
    type: 'object',
    properties: Object.fromEntries(
      Object.entries(profileDefinitions).map(([key, definition]) => [
        key,
        {
          type: 'object',
          properties: {
            value: definition.type === 'array' ? { type: 'array', items: { type: 'string' } } : { type: definition.type },
            sourceId: { type: 'string' },
            ...(manual ? { page: { type: 'integer' }, evidenceId: { type: 'string' } } : { quote: { type: 'string' } }),
            excerpt: { type: 'string' },
          },
          required: ['value', 'sourceId', ...(manual ? ['page', 'evidenceId'] : ['quote'])],
        },
      ]),
    ),
  };
}

export function validateProfile(raw, sources, passagesFor) {
  const fields = {};
  for (const [key, definition] of Object.entries(profileDefinitions)) {
    const item = raw?.[key],
      source = sources.find((s) => s.id === item?.sourceId);
    if (!item || !source || source.profileEligible === false || source.scope === 'general-work-only' || source.scope === 'edition-unconfirmed') continue;
    const page = source.pages?.find((p) => p.page === item.page);
    const passage = page && passagesFor?.(page, source.id).find((p) => p.id === item.evidenceId);
    const quote = passagesFor && source.pages ? passage?.text : item.quote;
    const evidence = source.pages ? page?.text : JSON.stringify(source.facts || {});
    if (!quote || quote.length < 8 || quote.length > 1500 || !normalizeText(evidence).includes(normalizeText(quote))) continue;
    const snippet = typeof item.excerpt === 'string' && item.excerpt.trim() ? item.excerpt.trim() : quote;
    if (!normalizeText(quote).includes(normalizeText(snippet))) continue;
    let value = item.value;
    if (definition.type === 'integer') {
      const parsed = extractMetadata(snippet)[key];
      if (!Number.isInteger(value) || value < 1 || value > definition.max || (parsed != null && parsed !== value) || (parsed == null && !new RegExp(`\\b${value}\\b`).test(snippet))) continue;
      const context = normalizeText(snippet);
      if (/Players$/.test(key) && !/jogador|player|joueur/.test(context)) continue;
      if (/Duration/.test(key) && !/minut|\bmin\b|hora|hour|heure/.test(context)) continue;
      if (key === 'recommendedAge' && !/idade|anos|years|age|\bans\b|\d\s*\+/.test(context + ' ' + quote)) continue;
    } else if (definition.type === 'array') {
      if (!Array.isArray(value) || !value.length || value.length > definition.max || value.some((v) => typeof v !== 'string' || !v.trim() || v.length > 40)) continue;
      value = [...new Set(value.map((v) => v.trim()))];
    } else {
      if (typeof value !== 'string' || !value.trim() || value.length > definition.max) continue;
      value = value.trim();
      if (['title', 'edition'].includes(key) && !normalizeText(quote).includes(normalizeText(value))) continue;
    }
    fields[key] = {
      value,
      sourceId: source.id,
      quote,
      excerpt: snippet,
      language: 'pt-BR',
      originalLanguage: source.language,
      generated: true,
      ...(page ? { page: page.page, evidenceId: item.evidenceId, documentId: source.documentId || 'main', sourceHash: source.sourceHash } : {}),
      license: source.license || '',
      url: source.url || '',
    };
  }
  for (const pair of [
    ['minPlayers', 'maxPlayers'],
    ['minDurationMinutes', 'maxDurationMinutes'],
  ]) {
    const [a, b] = pair.map((k) => fields[k]);
    if (!!a !== !!b || (a && (a.sourceId !== b.sourceId || a.value > b.value))) for (const key of pair) delete fields[key];
  }
  return fields;
}
