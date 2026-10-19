import { normalizeText } from '../../js/model.js';
import { modelProfileFields, validModelProfileValue } from '../../js/profile-facts.js';

// Complemento expressamente distinto de extração. Não cria citações nem prova
// equivalência entre jogos. Só preenche campos sem fatos utilizáveis nas fontes.
export function completeProfileFromModel(raw, game, sources, occupied = {}, model = '') {
  const analysis = { version: 1, status: 'not-returned', filled: [], rejected: [] };
  const empty = () => ({ fields: {}, source: null, analysis });
  if (!raw || typeof raw !== 'object') return empty();
  if (normalizeText(game.title).length < 2 || normalizeText(raw.requestedTitle) !== normalizeText(game.title) || normalizeText(raw.requestedEdition || '') !== normalizeText(game.edition || '')) {
    analysis.status = 'identity-mismatch';
    return empty();
  }
  if (raw.recognized !== true) {
    analysis.status = 'unknown-game';
    return empty();
  }
  analysis.status = 'examined';
  const input = { ...raw.fields };
  if (Number.isInteger(input.durationMinutes) && input.minDurationMinutes == null && input.maxDurationMinutes == null) input.minDurationMinutes = input.maxDurationMinutes = input.durationMinutes;
  const blocked = new Set(Object.keys(occupied));
  for (const key of modelProfileFields)
    if (
      sources.some(
        (s) =>
          !s.modelOnly &&
          s.profileEligible !== false &&
          (s.profileSpecificEligible !== false || !['minPlayers', 'maxPlayers', 'minDurationMinutes', 'maxDurationMinutes', 'recommendedAge'].includes(key)) &&
          validModelProfileValue(key, s.facts?.[key] ?? (/DurationMinutes$/.test(key) ? s.facts?.durationMinutes : undefined)),
      )
    )
      blocked.add(key);
  for (const [min, max] of [
    ['minPlayers', 'maxPlayers'],
    ['minDurationMinutes', 'maxDurationMinutes'],
  ]) {
    if (blocked.has(min) || blocked.has(max)) {
      blocked.add(min);
      blocked.add(max);
      continue;
    }
    if (input[min] == null && input[max] == null) continue;
    if (!validModelProfileValue(min, input[min]) || !validModelProfileValue(max, input[max]) || input[min] > input[max]) {
      delete input[min];
      delete input[max];
      analysis.rejected.push({ key: min, reason: 'model-range' });
    }
  }
  const claims = {};
  for (const key of modelProfileFields) {
    if (blocked.has(key) || input[key] == null) continue;
    if (!validModelProfileValue(key, input[key])) {
      analysis.rejected.push({ key, reason: 'model-value' });
      continue;
    }
    claims[key] = Array.isArray(input[key]) ? [...new Set(input[key].map((v) => v.trim()))] : typeof input[key] === 'string' ? input[key].trim() : input[key];
  }
  analysis.filled = Object.keys(claims);
  if (!analysis.filled.length) return empty();
  const source = {
    id: 'gemini-model-profile',
    name: 'Gemini · conhecimento do modelo',
    origin: 'model-knowledge',
    modelOnly: true,
    profileOnly: true,
    profileEligible: true,
    model,
    claims,
    language: 'pt-BR',
    url: '',
    license: 'Conteúdo gerado por IA · sem fonte externa verificada',
    independenceKey: 'gemini-model:' + model,
    contextManualHashes: sources.filter((s) => s.pages).map((s) => s.sourceHash),
    fetchedAt: Date.now(),
    editionConfirmed: false,
  };
  const fields = Object.fromEntries(Object.entries(claims).map(([key, value]) => [key, { value, sourceId: source.id, basis: 'model', verified: false, generated: true, language: 'pt-BR', model, url: '', license: source.license }]));
  return { fields, source, analysis };
}
