import { normalizeText } from './model.js';

// Identidade editorial revisada, não um catálogo nem resposta simulada de API.
// Nomes são fatos de identificação; nenhum texto promocional ou capa foi copiado.
export const reviewedIdentities = [
  {
    id: 'fate-of-the-fellowship',
    wikidata: 'Q137295527',
    bgg: '436217',
    codes: ['ZMGPSM0101'],
    names: [
      { value: 'O Senhor dos Anéis: Sina da Sociedade', language: 'pt-BR' },
      { value: 'Sina da Sociedade', language: 'pt-BR' },
      { value: 'The Lord of the Rings: Fate of the Fellowship', language: 'en' },
      { value: 'Le Seigneur des Anneaux: Le Destin de la Communauté', language: 'fr' },
    ],
    references: [
      'https://boardgamegeek.com/boardgameversion/754600/portuguese-edition',
      'https://www.zmangames.com/announcements/announcing-the-lord-of-the-rings-fate-of-the-fellowship/',
      'https://www.asmodee.fr/product/seigneur-des-anneaux-le-destin-de-la-communaute/',
    ],
    editionNote: 'Identidade da obra revisada com o manual brasileiro Galápagos v1.0. Isso não confirma a edição do arquivo enviado; dados Wikidata são gerais.',
  },
];
const key = (value) => normalizeText(value).replace(/^(?:o|a|os|as|the|le|les) /, '');
export function reviewedIdentity(title, metadata = '') {
  const candidate = key(title);
  return reviewedIdentities.find((item) => item.names.some((name) => key(name.value) === candidate) || item.codes.some((code) => new RegExp(`\\b${code}(?:_|\\b)`, 'i').test(metadata))) || null;
}
export function queryVariants(input) {
  const identity = reviewedIdentity(input.query),
    values = [],
    seen = new Set();
  const add = (query, language, reason) => {
    language = language.startsWith('pt') ? 'pt' : language;
    query = String(query || '')
      .replace(/[™®]/g, '')
      .replace(/[_–—-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 160);
    const normalized = normalizeText(query);
    if (normalized.length < 2 || seen.has(`${language}:${normalized}`)) return;
    seen.add(`${language}:${normalized}`);
    values.push({ query, language: language.startsWith('pt') ? 'pt' : language, reason });
  };
  add(input.query, 'pt', 'título enviado, prioridade PT-BR');
  for (const name of identity?.names || []) add(name.value, name.language, 'alias editorial revisado');
  for (const name of input.alternateTitles || [])
    for (const language of ['pt-BR', 'en', 'fr'].includes(name.language) ? [name.language] : ['en', 'fr', 'pt']) add(name.value, language, 'título original explícito no PDF; idioma do nome não presumido');
  if (!identity) {
    add(input.query, 'en', 'mesmo título, índice inglês');
    add(input.query, 'fr', 'mesmo título, índice francês');
    const parts = String(input.query).split(/\s*[:：]\s*/);
    if (parts.length > 1 && normalizeText(parts.at(-1)).split(' ').length >= 2) add(parts.at(-1), 'pt', 'subtítulo; identidade ainda não confirmada');
  }
  if (input.expanded) {
    add(normalizeText(input.query), 'pt', 'variação sem acentos/pontuação');
    for (const name of identity?.names || []) {
      const subtitle = name.value.split(':').at(-1);
      add(subtitle, name.language, 'subtítulo do alias revisado');
    }
  }
  // Garante cobertura dos três índices, inclusive para PDF português.
  for (const language of ['en', 'fr']) add(input.query, language, 'índice complementar');
  const preferred = ['pt', 'en', 'fr'].map((language) => values.find((v) => v.language === language)).filter(Boolean);
  return [...preferred, ...values.filter((v) => !preferred.includes(v))].slice(0, input.expanded ? 8 : 6);
}
