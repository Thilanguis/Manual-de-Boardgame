import { normalizeText } from './model.js';
import { factSignature } from './research-knowledge.js';

const identity = (f) => f.independenceKey || f.evidenceGroup || `${f.source}:${f.id}`;
const verifiedManual = (f) => ['pdf', 'gemini'].includes(f.source) && f.manualHash && f.evidence?.page && String(f.evidence.excerpt || '').trim().length >= 8;
const voteKey = (f) => `${f.source}:${f.id}`;

function choose(votes) {
  const signatures = new Set(votes.map((v) => factSignature(v.value)));
  const manuals = votes.filter((v) => v.facts.every(verifiedManual));
  if (manuals.length && new Set(manuals.map((v) => factSignature(v.value))).size === 1)
    return { chosen: manuals[0], state: signatures.size > 1 ? 'manual-preferred' : new Set(votes.map((v) => identity(v.facts[0]))).size > 1 ? 'consistent' : 'single-source' };
  if (manuals.length) return { state: 'conflict' };
  if (signatures.size <= 1) return { chosen: votes[0], state: votes.every((v) => v.facts.every((f) => !f.editionUnconfirmed && f.independenceVerified)) && new Set(votes.map((v) => identity(v.facts[0]))).size > 1 ? 'consistent' : 'single-source' };
  // Uma família que se contradiz se abstém. Edição desconhecida não vota sobre faixas/idade.
  const families = new Map();
  for (const vote of votes.filter((v) => v.facts.every((f) => !f.editionUnconfirmed && f.independenceVerified && f.quality !== 'low'))) {
    const key = identity(vote.facts[0]);
    if (!families.has(key)) families.set(key, []);
    families.get(key).push(vote);
  }
  const unique = [...families.values()].filter((vs) => new Set(vs.map((v) => factSignature(v.value))).size === 1).map((vs) => vs[0]);
  const counts = new Map();
  for (const vote of unique) {
    const key = factSignature(vote.value);
    const group = counts.get(key) || [];
    group.push(vote);
    counts.set(key, group);
  }
  const ranked = [...counts.values()].sort((a, b) => b.length - a.length);
  if (ranked[0]?.length >= 2 && ranked[0].length > unique.length / 2) return { chosen: ranked[0][0], state: 'consensus', votes: ranked[0].length, total: unique.length };
  return { state: 'conflict' };
}

export function resolveMetadataConsensus(alternatives, fields, fieldSources, consistency) {
  const paired = new Set();
  const decisions = {};
  for (const keys of [['minPlayers', 'maxPlayers'], ['minDurationMinutes', 'maxDurationMinutes'], ['recommendedAge'], ['gameType'], ['edition']]) {
    keys.forEach((k) => paired.add(k));
    const facts = alternatives[keys[0]] || [];
    const votes = facts
      .map((fact) => {
        const group = keys.map((key) => alternatives[key]?.find((f) => voteKey(f) === voteKey(fact)));
        if (group.some((f) => !f)) return null;
        const values = group.map((f) => f.value);
        if (values.length === 2 && values[0] > values[1]) return null;
        return { facts: group, value: values.length === 1 ? values[0] : values };
      })
      .filter(Boolean);
    // Um único limite parcial continua visível para revisão, mas não compõe faixas de fontes distintas.
    if (!votes.length) {
      if (keys.length === 2 && keys.some((k) => alternatives[k]?.length)) for (const key of keys) consistency[key] = 'conflict';
      continue;
    }
    const result = choose(votes);
    decisions[keys[0]] = { state: result.state, votes: result.votes || 0, total: result.total || 0, keys };
    keys.forEach((key, i) => {
      consistency[key] = result.state;
      if (result.chosen) {
        fields[key] = result.chosen.facts[i].value;
        fieldSources[key] = { ...result.chosen.facts[i], resolution: result.state };
      }
    });
  }
  return decisions;
}

export function independenceFor(candidate, field) {
  const explicit = candidate.independenceKey || candidate.sourceFamily || candidate.derivedFrom || candidate.evidence?.[field]?.derivedFrom;
  if (explicit) return typeof explicit === 'string' ? explicit : JSON.stringify(explicit);
  if (['pdf', 'gemini'].includes(candidate.source)) return `manual:${candidate.evidence?.[field]?.sourceHash || candidate.manualHash || ''}`;
  // Wikidata e Wikipédia podem reproduzir a mesma origem: não presumir dois votos.
  if (['wikidata', 'wikipedia'].includes(candidate.source)) return 'wikimedia';
  try {
    return new URL(candidate.url).hostname.replace(/^www\./, '');
  } catch {
    return normalizeText(candidate.source || 'unknown');
  }
}
