import { indexMatches } from './pdf-index.js';
import { extractPageMetadata } from './recognition.js';
import { documentGame } from './documents.js';
import { normalizeText } from './model.js';
import { profileDefinitions } from './profile-facts.js';

// Fatos explícitos do índice existente. Não resume regras nem inventa sinopse.
export function pdfIndexCandidate(index, game, document) {
  if (!indexMatches(index, documentGame(game, document))) return null;
  const metadata = extractPageMetadata(index.pages);
  const fields = {},
    evidence = {};
  for (const key of Object.keys(profileDefinitions)) {
    const value = metadata[key];
    const originKey = /Players$/.test(key) ? 'players' : /Duration/.test(key) ? 'duration' : key;
    const origin = metadata.sources?.[originKey];
    const page = origin?.excerpt && index.pages.find((p) => normalizeText(p.text).includes(normalizeText(origin.excerpt)));
    if (!page || value == null || value === '' || (Array.isArray(value) && !value.length)) continue;
    fields[key] = value;
    evidence[key] = { ...origin, page: page.page, documentId: document.id, sourceHash: document.manual.sha256 };
  }
  if (!Object.keys(fields).length) return null;
  return {
    source: 'pdf',
    id: 'local-index',
    manualHash: document.manual.sha256,
    fields,
    evidence,
    names: [{ value: game.title, language: document.language || game.language }],
    language: document.language || game.language,
    descriptionLanguage: document.language || game.language,
    edition: game.edition || '',
    kind: 'unknown',
    license: 'Manual enviado · índice verificado',
    conflicts: [],
  };
}
