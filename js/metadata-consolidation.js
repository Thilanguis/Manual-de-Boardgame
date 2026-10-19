import { consolidateCandidates, factSignature, researchName } from './research-knowledge.js';
import { sameWork, linkCatalogIdentities } from './research-client.js';
import { reviewedIdentity } from './game-identities.js';
import { resolveMetadataConsensus, independenceFor } from './metadata-consensus.js';

export const metadataKeys = ['title', 'edition', 'description', 'minPlayers', 'maxPlayers', 'minDurationMinutes', 'maxDurationMinutes', 'recommendedAge', 'tags', 'mechanics', 'gameType'];
export const sourceField = (key) => (['minPlayers', 'maxPlayers'].includes(key) ? 'players' : ['minDurationMinutes', 'maxDurationMinutes'].includes(key) ? 'duration' : key);
export const emptyValue = (value) => value == null || value === '' || (Array.isArray(value) && !value.length);
const kindOf = (v) =>
  v.kind && v.kind !== 'unknown' ? v.kind : /expansao|expansion/.test(researchName(v.gameType || v.fields?.gameType)) ? 'expansion' : /jogo base|base game/.test(researchName(v.gameType || v.fields?.gameType)) ? 'base' : 'unknown';
const compatible = (a, b) => (!a.edition || !b.edition || researchName(a.edition) === researchName(b.edition)) && !(kindOf(a) !== 'unknown' && kindOf(b) !== 'unknown' && kindOf(a) !== kindOf(b));
const equal = (a, b) => factSignature(a) === factSignature(b);
const signature = (value) => (Array.isArray(value) ? JSON.stringify([...new Set(value.map(researchName))].sort()) : typeof value === 'string' ? researchName(value) : factSignature(value));

// Só um grupo de identidade pode contribuir. Um nome exato é uma pista quando
// há uma única obra; homônimos/IDs incompatíveis exigem escolha explícita.
export function consolidateMetadata(game, input, chosen = null) {
  const hash = game.manual?.sha256;
  const manual = input.filter((c) => ['pdf', 'gemini'].includes(c.source) && hash && c.manualHash === hash && compatible(game, c));
  const external = linkCatalogIdentities(input.filter((c) => !['pdf', 'gemini'].includes(c.source) && compatible(game, c)));
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
  const originalTitle = game.sources?.originalTitle;
  const titles = [game.title, hash && originalTitle?.sourceHash === hash && /^PDF/i.test(originalTitle.source || '') && originalTitle.excerpt].filter(Boolean).map(researchName);
  const named = groups.filter((group) => group.names.some((name) => titles.includes(researchName(name.value))));
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
      const fact = {
        ...origin,
        value: single.fields[key],
        independenceKey: independenceFor(member, key),
        independenceVerified: member.independenceVerified === true || !!member.sourceFamily || !!member.derivedFrom,
        quality: member.quality || 'catalog',
        manualHash: member.manualHash || '',
        edition: member.edition || '',
        editionUnconfirmed: member.evidence?.[key]?.editionUnconfirmed ?? (!['pdf', 'gemini'].includes(member.source) && (!game.edition || !member.edition || !!member.requiresEditionReview)),
      };
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
    if (key === 'description') {
      const summary = facts.find((f) => f.generated && /^pt/i.test(f.language || '') && String(f.evidence?.excerpt || '').trim().length >= 8);
      if (summary) {
        fields[key] = summary.value;
        fieldSources[key] = summary;
      }
    }
  }
  const resolutions = resolveMetadataConsensus(alternatives, fields, fieldSources, consistency);
  return { fields, fieldSources, alternatives, consistency, resolutions, members, ambiguous: !selected && groups.length > 0 ? groups : [], pendingTranslations: members.flatMap((c) => consolidateCandidates([c])[0].pendingTranslations || []) };
}

// Uma resposta progressiva pode atualizar sugestões automáticas anteriores,
// mas nunca um campo salvo, editado ou intencionalmente esvaziado.
export function metadataUpdates(model, game, dirty = new Set(), automatic = {}) {
  const values = {};
  for (const [key, value] of Object.entries(model.fields)) {
    const origin = game.sources?.[sourceField(key)];
    if (model.consistency?.[key] === 'conflict' || dirty.has(key) || origin?.confirmedAt || /conferido|corrigido|ajustado por voc/i.test(origin?.source || '')) continue;
    // Classificações extraídas automaticamente do PDF podem ser completadas,
    // sem remover nenhum termo existente nem tocar em listas editadas/conferidas.
    const extendsPdfList = ['tags', 'mechanics'].includes(key) && /^PDF/i.test(origin?.source || '') && Array.isArray(game[key]) && Array.isArray(value) && game[key].every((item) => value.some((v) => researchName(item) === researchName(v)));
    const improvesPdfSummary = key === 'description' && /^PDF/i.test(origin?.source || '') && model.fieldSources[key]?.generated;
    if (!equal(game[key], value) && (emptyValue(game[key]) || extendsPdfList || improvesPdfSummary || (key in automatic && equal(game[key], automatic[key])))) values[key] = value;
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
