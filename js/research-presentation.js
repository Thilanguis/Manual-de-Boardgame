import { durationLabel, playersLabel, synopsisText } from './model.js';
import { sameWork, selectedFields } from './research-client.js';
import { portugueseCandidate } from './catalog-language.js';

export function presentCandidate(candidate, others = []) {
  if (!candidate.members) candidate = portugueseCandidate(candidate);
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
    ['Duração', fields.minDurationMinutes && fields.maxDurationMinutes ? durationLabel(fields) : fields.minDurationMinutes ? `A partir de ${fields.minDurationMinutes} min` : fields.maxDurationMinutes ? `Até ${fields.maxDurationMinutes} min` : ''],
    ['Idade', fields.recommendedAge ? `${fields.recommendedAge}+ anos` : ''],
    ['Tipo', fields.gameType],
    ['Categorias', fields.tags?.join(', ')],
    ['Mecânicas', fields.mechanics?.join(', ')],
  ].filter(([, value]) => value);
}

// O snapshot não guarda estados de transporte. Um resultado salvo não é uma
// consulta em andamento, e a ausência nele não comprova uma consulta nova.
export function researchSourceState(source, statuses, candidates, snapshot) {
  const runtime = statuses.get(source);
  if (runtime) return runtime;
  const found = candidates.filter((c) => c.source === source);
  if (found.length) return { status: 'done', cached: true, candidates: found };
  if (snapshot?.query && snapshot.fetchedAt) return { status: 'cached', cached: true, candidates: [] };
}

export function resultSummary(candidates, sources, statuses, { pending = false } = {}) {
  if (pending) return 'Completando informações…';
  const members = candidates.flatMap((c) => c.members || [c]);
  const external = members.filter((c) => !['pdf', 'gemini', 'gemini-public'].includes(c.source));
  const works = [];
  for (const candidate of external) if (!works.some((work) => (work.source === candidate.source && work.id === candidate.id) || sameWork(work, candidate))) works.push(candidate);
  const loading = [...statuses.values()].some((result) => result.status === 'loading');
  const failed = [...statuses.values()].some((result) => result.status === 'error' || result.diagnostics?.complete === false);
  const count = works.length;
  const useful = new Set(external.filter((c) => selectedFields(portugueseCandidate({ ...c, fields: c.fields || {} }), {}).some((f) => !['title', 'edition'].includes(f.key))).map((c) => c.source));
  const possible = candidates.flatMap((c) => c.ambiguous || []).length;
  const prefix = count
    ? `${count} ${count === 1 ? 'jogo encontrado nas fontes' : 'jogos encontrados nas fontes'}.${useful.size ? ` ${useful.size} ${useful.size === 1 ? 'fonte com dados aproveitáveis' : 'fontes com dados aproveitáveis'}.` : ' Sem informações adicionais aproveitáveis.'}`
    : `${members.some((c) => c.source === 'pdf') ? 'Identificado pelo PDF. ' : ''}${loading ? 'Pesquisando…' : possible ? 'Confira qual jogo corresponde ao manual.' : sources.some((s) => s.enabled) ? 'Nenhuma correspondência externa confirmada nas fontes disponíveis.' : 'Pesquisa externa indisponível.'}`;
  return `${prefix}${count && loading ? ' Buscando mais resultados…' : ''}${failed ? ' Algumas fontes não responderam.' : ''}`;
}
