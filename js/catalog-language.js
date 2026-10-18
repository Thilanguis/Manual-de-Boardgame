import { isPortuguese } from './translation.js';
import { vocabularyFields, knownVocabulary } from './game-vocabulary.js';

const keys = ['description', 'tags', 'mechanics', 'gameType'];
export function pdfMetadataCandidate(game) {
  const legacyFields = Object.fromEntries(
    ['title', 'edition', 'description', 'minPlayers', 'maxPlayers', 'minDurationMinutes', 'maxDurationMinutes', 'recommendedAge', 'tags', 'mechanics', 'gameType']
      .filter((key) => {
        const origin = game.sources?.[['minPlayers', 'maxPlayers'].includes(key) ? 'players' : ['minDurationMinutes', 'maxDurationMinutes'].includes(key) ? 'duration' : key];
        return /^PDF/i.test(origin?.source || '') && !origin.confirmedAt && game[key] != null && game[key] !== '' && (!Array.isArray(game[key]) || game[key].length);
      })
      .map((key) => [key, game[key]]),
  );
  const stored = game.sources?.pdfOriginalMetadata;
  const original = stored
    ? { ...stored, fields: { ...(stored.manualHash === game.manual?.sha256 ? legacyFields : {}), ...stored.fields } }
    : Object.keys(legacyFields).length
      ? { fields: legacyFields, manualHash: game.manual?.sha256, language: game.language }
      : null;
  if (!original?.fields || !original.manualHash || original.manualHash !== game.manual?.sha256) return null;
  return {
    source: 'pdf',
    manualHash: original.manualHash,
    identifiers: { manual: original.manualHash },
    id: 'pdf-extracted',
    pdfMethod: 'text',
    fields: { title: game.title, ...original.fields },
    fieldTranslations: original.translations || {},
    names: [{ value: game.title, language: game.language }],
    language: original.language,
    descriptionLanguage: original.language,
    edition: game.edition || '',
    kind: 'unknown',
    license: 'Manual enviado · conferir os trechos originais',
    evidence: Object.fromEntries(
      Object.keys(original.fields).map((key) => [
        key,
        {
          ...(game.sources?.[['minPlayers', 'maxPlayers'].includes(key) ? 'players' : ['minDurationMinutes', 'maxDurationMinutes'].includes(key) ? 'duration' : key] || {}),
          documentId: game.primaryDocumentId || 'main',
          sourceHash: original.manualHash,
        },
      ]),
    ),
    conflicts: [],
  };
}
export function portugueseCandidate(candidate) {
  const fields = vocabularyFields(candidate.fields),
    fieldLanguages = { ...candidate.fieldLanguages },
    pendingTranslations = [];
  for (const key of keys) {
    const value = candidate.fields[key];
    if (!value || (Array.isArray(value) && !value.length)) continue;
    const language = candidate.fieldLanguages?.[key] || (key === 'description' ? candidate.descriptionLanguage : '') || candidate.language || 'unknown';
    const translation = candidate.fieldTranslations?.[key];
    if (translation?.targetLanguage === 'pt-BR' && JSON.stringify(translation.sourceValue) === JSON.stringify(value)) {
      fields[key] = translation.value;
      fieldLanguages[key] = 'pt-BR';
    } else if (key !== 'description' && (Array.isArray(value) ? value.every(knownVocabulary) : knownVocabulary(value))) fieldLanguages[key] = 'pt-BR';
    else if (!isPortuguese(language) && language !== 'unknown') {
      delete fields[key];
      pendingTranslations.push({ key, value, language, source: candidate.source, id: candidate.id });
    }
  }
  return { ...candidate, fields, fieldLanguages, pendingTranslations, descriptionLanguage: fieldLanguages.description || candidate.descriptionLanguage };
}
export async function translateCatalogCandidate(candidate, translator, options = {}) {
  const next = { ...candidate, fieldTranslations: { ...candidate.fieldTranslations } };
  for (const field of portugueseCandidate(candidate).pendingTranslations) {
    const values = Array.isArray(field.value) ? field.value : [field.value],
      translated = [];
    for (const value of values) translated.push(await translator.translate(value, { ...options, sourceLanguage: field.language }));
    next.fieldTranslations[field.key] = {
      sourceValue: field.value,
      value: Array.isArray(field.value) ? translated.map((r) => r.text) : translated[0].text,
      sourceLanguage: field.language,
      targetLanguage: 'pt-BR',
      method: 'browser-local',
      createdAt: Date.now(),
      reviewed: false,
    };
  }
  return next;
}
