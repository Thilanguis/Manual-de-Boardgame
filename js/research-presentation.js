import { durationLabel, playersLabel, synopsisText } from './model.js';
import { sameWork, selectedFields } from './research-client.js';

export function presentCandidate(candidate, others = []) {
  const related = others.filter((other) => other !== candidate && sameWork(candidate, other));
  const names = [...(candidate.names || []), ...related.flatMap((other) => other.names || [])];
  const portuguese = names.find((name) => /^pt-br$/i.test(name.language)) || names.find((name) => /^pt$/i.test(name.language));
  const title = portuguese?.value || candidate.fields.title || '';
  const english = names.find((name) => /^en(?:-|$)/i.test(name.language) && name.value !== title);
  const fields = { ...candidate.fields, ...(title ? { title } : {}) };
  fields.description = synopsisText(fields.description);
  if (!fields.description) delete fields.description;
  return { ...candidate, fields, names, secondaryTitle: english?.value || '', fieldLanguages: { ...candidate.fieldLanguages, ...(portuguese ? { title: portuguese.language } : {}) } };
}

export function candidateFacts(candidate) {
  const fields = Object.fromEntries(selectedFields(candidate, {}).map(({ key, value }) => [key, value]));
  return [
    ['Jogadores', fields.minPlayers && fields.maxPlayers ? playersLabel(fields) : fields.minPlayers ? `A partir de ${fields.minPlayers}` : fields.maxPlayers ? `Até ${fields.maxPlayers}` : ''],
    ['Duração', fields.minDurationMinutes && fields.maxDurationMinutes ? durationLabel(fields) : ''],
    ['Idade', fields.recommendedAge ? `${fields.recommendedAge}+ anos` : ''],
    ['Tipo', fields.gameType],
    ['Categorias', fields.tags?.join(', ')],
    ['Mecânicas', fields.mechanics?.join(', ')],
  ].filter(([, value]) => value);
}

export function resultSummary(candidates, sources, statuses) {
  const works = [];
  for (const candidate of candidates) if (!works.some((work) => (work.source === candidate.source && work.id === candidate.id) || sameWork(work, candidate))) works.push(candidate);
  const loading = [...statuses.values()].some((result) => result.status === 'loading');
  const failed = [...statuses.values()].some((result) => result.status === 'error' || result.diagnostics?.complete === false);
  const count = works.length;
  return `${count ? `${count} ${count === 1 ? 'jogo encontrado' : 'jogos encontrados'}.` : loading ? 'Pesquisando…' : sources.some((source) => source.enabled) ? 'Nenhum jogo encontrado nas fontes disponíveis.' : 'Pesquisa externa indisponível.'}${count && loading ? ' Buscando mais resultados…' : ''}${failed ? ' Algumas fontes não responderam.' : ''}`;
}
