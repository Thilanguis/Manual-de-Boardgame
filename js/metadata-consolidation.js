import { consolidateCandidates, factSignature, researchName } from './research-knowledge.js';
import { sameWork } from './research-client.js';
import { reviewedIdentity } from './game-identities.js';

export const metadataKeys = ['title', 'edition', 'description', 'minPlayers', 'maxPlayers', 'minDurationMinutes', 'maxDurationMinutes', 'recommendedAge', 'tags', 'mechanics', 'gameType'];
export const sourceField = (key) => (['minPlayers', 'maxPlayers'].includes(key) ? 'players' : ['minDurationMinutes', 'maxDurationMinutes'].includes(key) ? 'duration' : key);
export const emptyValue = (value) => value == null || value === '' || (Array.isArray(value) && !value.length);
const compatible = (a, b) => (!a.edition || !b.edition || researchName(a.edition) === researchName(b.edition)) && !(a.kind && b.kind && a.kind !== 'unknown' && b.kind !== 'unknown' && a.kind !== b.kind);
const equal = (a, b) => factSignature(a) === factSignature(b);
const signature = (value) => (Array.isArray(value) ? JSON.stringify([...new Set(value.map(researchName))].sort()) : typeof value === 'string' ? researchName(value) : factSignature(value));

// Só um grupo de identidade pode contribuir. Um nome exato é uma pista quando
// há uma única obra; homônimos/IDs incompatíveis exigem escolha explícita.
export function consolidateMetadata(game, input, chosen = null) {
  const hash = game.manual?.sha256;
  const manual = input.filter((c) => ['pdf', 'gemini'].includes(c.source) && hash && c.manualHash === hash && compatible(game, c));
  const external = input.filter((c) => !['pdf', 'gemini'].includes(c.source) && compatible(game, c));
  const buckets = [];
  for (const candidate of external) {
    const bucket = buckets.find((items) => items.every((other) => compatible(candidate, other) && sameWork(candidate, other)));
    if (bucket) bucket.push(candidate);
    else buckets.push([candidate]);
  }
  const groups = buckets.map((members) => {
    // Uma fonte da mesma identidade sem edição pode completar metadados gerais.
    // A ausência de edição continua registrada em cada fato original.
    const edition = game.edition || members.find((member) => member.edition)?.edition || '';
    return { ...consolidateCandidates(members.map((member) => ({ ...member, edition })))[0], members };
  });
  const identity = reviewedIdentity(game.title);
  const known = [...(game.sources?.catalog?.matches || []), ...(identity ? [{ identifiers: { wikidata: identity.wikidata, bgg: identity.bgg }, kind: 'unknown' }] : [])];
  const matching = groups.filter((group) => known.some((item) => sameWork({ kind: 'unknown', ...item }, group)));
  const named = groups.filter((group) => group.names.some((name) => researchName(name.value) === researchName(game.title)));
  const eligible = matching.length ? matching : named.filter((group) => !known.some((item) => Object.entries(item.identifiers || {}).some(([key, id]) => id && group.identifiers?.[key] && id !== group.identifiers[key])));
  const selected = chosen ? groups.find((group) => group.members.some((member) => `${member.source}:${member.id}` === chosen)) : eligible.length === 1 ? eligible[0] : null;
  const members = [...manual, ...(selected?.members || [])];
  const rank = (c) => (c.source === 'pdf' ? 0 : c.source === 'gemini' ? 2 : 1);
  members.sort((a, b) => rank(a) - rank(b) || Number(!/^pt/i.test(a.language)) - Number(!/^pt/i.test(b.language)));
  const fields = {},
    alternatives = {},
    fieldSources = {},
    consistency = {};
  for (const member of members) {
    const single = consolidateCandidates([member])[0];
    for (const key of metadataKeys) {
      if (!(key in single.fields)) continue;
      const origin = single.fieldSources[key];
      const fact = { ...origin, value: single.fields[key], manualHash: member.manualHash || '', edition: member.edition || '', editionUnconfirmed: !['pdf', 'gemini'].includes(member.source) && !!game.edition && !member.edition };
      (alternatives[key] ||= []).push(fact);
      if (!(key in fields)) {
        fields[key] = fact.value;
        fieldSources[key] = fact;
      }
    }
  }
  for (const [key, facts] of Object.entries(alternatives)) {
    const distinct = new Set(facts.map((f) => signature(f.value)));
    const independent = new Set(facts.map((f) => f.evidenceGroup || `${f.source}:${f.id}`));
    const scalarConflict = !['description', 'title', 'tags', 'mechanics'].includes(key) && distinct.size > 1;
    consistency[key] = scalarConflict ? 'conflict' : distinct.size === 1 && independent.size > 1 ? 'consistent' : 'single-source';
    if (['tags', 'mechanics'].includes(key)) {
      const seen = new Set();
      fields[key] = facts
        .flatMap((f) => f.value)
        .filter((v) => {
          const id = researchName(v);
          if (seen.has(id)) return false;
          seen.add(id);
          return true;
        });
      fieldSources[key] = { ...facts[0], value: fields[key], origins: facts };
      if (!facts.some((fact) => equal(fact.value, fields[key]))) alternatives[key] = [fieldSources[key], ...facts];
    }
    // O título brasileiro confirmado pela identidade pública é uma alternativa
    // editorial, nunca uma tradução inventada de nome próprio.
    if (key === 'title') {
      const pt = facts.find((f) => /^pt/i.test(f.language) && !['pdf', 'gemini'].includes(f.source));
      if (pt) {
        fields[key] = pt.value;
        fieldSources[key] = pt;
      }
    }
  }
  return { fields, fieldSources, alternatives, consistency, members, ambiguous: !selected && groups.length > 0 ? groups : [], pendingTranslations: members.flatMap((c) => consolidateCandidates([c])[0].pendingTranslations || []) };
}

// Uma resposta progressiva pode atualizar sugestões automáticas anteriores,
// mas nunca um campo salvo, editado ou intencionalmente esvaziado.
export function metadataUpdates(model, game, dirty = new Set(), automatic = {}) {
  const values = {};
  for (const [key, value] of Object.entries(model.fields)) {
    const origin = game.sources?.[sourceField(key)];
    if (dirty.has(key) || origin?.confirmedAt || /conferido|corrigido|ajustado por voc/i.test(origin?.source || '')) continue;
    if (emptyValue(game[key]) || (key in automatic && equal(game[key], automatic[key]))) values[key] = value;
  }
  // Não completar metade de uma faixa com outro valor sem conferência.
  for (const pair of [
    ['minPlayers', 'maxPlayers'],
    ['minDurationMinutes', 'maxDurationMinutes'],
  ]) {
    const [min, max] = pair.map((k) => values[k] ?? game[k]);
    if (min && max && min > max) for (const key of pair) delete values[key];
  }
  return values;
}

export function storedCatalogCandidates(game) {
  return (game.sources?.catalog?.matches || []).filter((m) => m.manualHash === game.manual?.sha256 && m.originalFields).map((m) => ({ ...m, fields: m.originalFields, language: m.language || 'unknown', kind: m.kind || 'unknown', conflicts: [] }));
}
