import { normalizeText, durationRange, synopsisText } from './model.js';
import { RESEARCH_PROTOCOL } from './research-contract.js';
import { durationSuggestion } from './research-duration.js';

export const sourceNames = { ludopedia: 'Ludopedia', wikidata: 'Wikidata', wikipedia: 'Wikipédia', pdf: 'PDF · texto do manual', bgg: 'BoardGameGeek' };
export function researchSummary(sources, statuses) {
  const active = sources.filter((s) => s.enabled),
    disabled = sources.filter((s) => !s.enabled),
    messages = [];
  messages.push(`${active.length} de ${sources.length} conectores externos habilitados. ${disabled.length ? 'Pesquisa parcial: ' + disabled.map((s) => sourceNames[s.id] || s.name).join(', ') + ' sem autorização/configuração.' : ''}`);
  for (const source of active) {
    const result = statuses.get(source.id);
    messages.push(
      `${sourceNames[source.id] || source.name}: ${!result ? 'ainda não consultada' : result.status === 'loading' ? 'consultando' : result.status === 'error' ? 'falhou — ' + result.error : result.diagnostics?.complete === false ? 'resposta parcial — ' + (result.candidates?.length || 0) + ' resultado(s); houve consultas que falharam' : result.candidates?.length ? result.candidates.length + ' correspondência(s)' : 'respondeu, sem correspondência nas consultas realizadas'}.`,
    );
  }
  return messages.join(' ');
}
export const manualSources = [
  ['Devir Brasil', 'https://devir.com.br/', 'pt-BR'],
  ['MeepleBR', 'https://meeplebr.com/', 'pt-BR'],
  ['Galápagos / Asmodee Brasil', 'https://www.mundogalapagos.com.br/', 'pt-BR'],
  ['L’Imaginaire (Québec)', 'https://imaginaire.com/fr/', 'fr'],
  ['Asmodee Canada', 'https://www.asmodee.ca/', 'fr'],
  ['Philibert', 'https://www.philibertnet.com/fr/', 'fr'],
];
export function normalizedQuery(value) {
  return String(value || '')
    .replace(/[_\-–—]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
}
export async function researchRequest(base, getToken, source, input, { signal, timeoutMs = input?.expanded ? 9500 : 4500, fetcher = fetch } = {}) {
  const timeout = AbortSignal.timeout(timeoutMs),
    combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let abort;
  try {
    const token =
      source === 'sources'
        ? ''
        : await Promise.race([
            getToken(),
            new Promise((_, reject) => {
              abort = () => reject(combined.reason);
              if (combined.aborted) abort();
              else combined.addEventListener('abort', abort, { once: true });
            }),
          ]);
    combined.throwIfAborted();
    if (source !== 'sources' && !token) throw new Error('Entre com uma conta autorizada para pesquisar.');
    const response = await fetcher(`${base.replace(/\/$/, '')}/v1/research/${source}`, {
      method: source === 'sources' ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(source !== 'sources' ? { body: JSON.stringify({ ...input, protocol: RESEARCH_PROTOCOL }) } : {}),
      signal: combined,
    });
    const data = await response.json();
    if (!response.ok) {
      const error = new Error(data.error || 'Esta fonte não respondeu.');
      error.status = response.status;
      throw error;
    }
    return data;
  } catch (error) {
    if (timeout.aborted) throw new Error('Esta fonte demorou. Os outros resultados continuam disponíveis.');
    throw error;
  } finally {
    if (abort) combined.removeEventListener('abort', abort);
  }
}
export async function parallelResearch(sources, query, request, { signal, onUpdate = () => {} } = {}) {
  // Nenhuma fonte aguarda outra; cada conclusão é entregue imediatamente.
  return Promise.allSettled(
    sources
      .filter((s) => s.enabled)
      .map(async (source) => {
        onUpdate({ source: source.id, status: 'loading' });
        try {
          const result = await request(source.id, query, { signal });
          if (!signal?.aborted) onUpdate({ source: source.id, status: 'done', ...result });
          return result;
        } catch (error) {
          if (!signal?.aborted) onUpdate({ source: source.id, status: 'error', error: error.message });
          throw error;
        }
      }),
  );
}
export function sameWork(a, b) {
  // Nomes parecidos não demonstram identidade ou edição.
  if (a.kind !== 'unknown' && b.kind !== 'unknown' && a.kind !== b.kind) return false;
  if (a.edition && b.edition && normalizeText(a.edition) !== normalizeText(b.edition)) return false;
  const shared = Object.entries(a.identifiers || {}).filter(([key, id]) => id && b.identifiers?.[key]);
  return shared.length > 0 && shared.every(([key, id]) => b.identifiers[key] === id);
}
export function matchWarnings(candidate, { title, edition = '', kind = 'unknown' }, others = []) {
  const names = candidate.names?.map((n) => normalizeText(n.value)) || [];
  const warnings = [...(candidate.conflicts || [])];
  if (!names.includes(normalizeText(title))) warnings.push('O título não coincide com um nome ou tradução registrado por esta fonte. Verifique possíveis homônimos.');
  if (kind !== 'unknown' && candidate.kind !== 'unknown' && kind !== candidate.kind) warnings.push('Jogo base e expansão não correspondem: esta sugestão não pode ser aplicada.');
  if (!candidate.edition) warnings.push(`A edição${edition ? ` “${edition}” do PDF` : ''} não foi confirmada por esta fonte. Dados gerais podem diferir do manual.`);
  for (const other of others.filter((c) => c !== candidate && sameWork(candidate, c))) {
    for (const [field, value] of Object.entries(candidate.fields)) {
      const second = other.fields[field];
      if (second !== undefined && !['title', 'description'].includes(field) && JSON.stringify(value) !== JSON.stringify(second)) warnings.push(`${field}: ${sourceNames[candidate.source]} e ${sourceNames[other.source]} discordam. Confira o PDF.`);
    }
  }
  return [...new Set(warnings)];
}
export const fieldLabels = {
  title: 'Nome',
  description: 'Sobre o jogo',
  minPlayers: 'Mín. jogadores',
  maxPlayers: 'Máx. jogadores',
  minDurationMinutes: 'Duração mínima (min)',
  maxDurationMinutes: 'Duração máxima (min)',
  recommendedAge: 'Idade',
  tags: 'Categorias',
  mechanics: 'Mecânicas',
  gameType: 'Tipo',
  edition: 'Edição',
  language: 'Idioma do manual',
};
export function selectedFields(candidate, current) {
  const { durationMinutes, minDurationMinutes, maxDurationMinutes, ...otherFields } = candidate.fields;
  const fields = { ...otherFields, ...durationSuggestion(candidate.fields) };
  current = { ...current, ...durationRange(current) };
  return Object.entries(fields)
    .filter(([key, value]) => fieldLabels[key] && value !== '' && value != null && (!Array.isArray(value) || value.length) && (key !== 'description' || synopsisText(value)))
    .map(([key, value]) => ({
      key,
      value,
      current: current[key],
      conflict: current[key] !== '' && current[key] !== null && current[key] !== undefined && JSON.stringify(current[key]) !== JSON.stringify(value),
      checked: (current[key] === '' || current[key] == null || (Array.isArray(current[key]) && !current[key].length)) && !candidate.conflicts?.length && (!candidate.requiresEditionReview || key === 'title'),
    }));
}
