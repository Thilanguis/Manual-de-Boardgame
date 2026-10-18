import { normalizeText } from './model.js';
import { sameWork, selectedFields } from './research-client.js';
import { portugueseCandidate } from './catalog-language.js';

export const RESEARCH_SCHEMA = 1;
export const factSignature = (value) => JSON.stringify(Array.isArray(value) ? [...value].sort((a, b) => String(a).localeCompare(String(b))) : value);
export const researchName = (value) =>
  normalizeText(value)
    .replace(/[™®]/g, '')
    .replace(/[_–—-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
const languageRank = (value) => (/^pt/i.test(value || '') ? 0 : /^en/i.test(value || '') ? 1 : 2);
const editionCompatible = (a, b) => researchName(a.edition || '') === researchName(b.edition || '');
const manualHash = (value) => (typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value) ? value.toLowerCase() : '');
const sameManual = (a, b) => !!manualHash(a.manualHash) && manualHash(a.manualHash) === manualHash(b.manualHash);
const differentEditions = (a, b) => !!researchName(a.edition) && !!researchName(b.edition) && !editionCompatible(a, b);
const reviewedInContext = (decision, context) => sameManual({ manualHash: decision.manualHash ?? context.manualHash }, context) && editionCompatible({ edition: decision.edition ?? context.edition }, context);
const fieldValues = (candidate) => Object.fromEntries(selectedFields(candidate, {}).map(({ key, value }) => [key, value]));
export function consolidateCandidates(input) {
  const groups = [];
  for (const candidate of input) {
    const group = groups.find((items) =>
      items.every((other) => sameWork(candidate, other) && editionCompatible(candidate, other) && ((candidate.kind || 'unknown') === (other.kind || 'unknown') || ![candidate.kind, other.kind].includes('expansion'))),
    );
    if (group) group.push(candidate);
    else groups.push([candidate]);
  }
  return groups.map((members) => {
    const ordered = [...members].sort((a, b) => Number(a.source === 'gemini') - Number(b.source === 'gemini') || languageRank(a.language) - languageRank(b.language));
    const first = ordered[0],
      fields = {},
      fieldSources = {},
      alternatives = {},
      consistency = {},
      conflicts = [...new Set(members.flatMap((c) => c.conflicts || []))];
    for (const candidate of ordered) {
      const normalized = portugueseCandidate(candidate);
      for (const field of selectedFields(normalized, {})) {
        const provenance = {
          source: candidate.source,
          id: candidate.id,
          url: candidate.url || '',
          language: normalized.fieldLanguages?.[field.key] || (field.key === 'description' ? normalized.descriptionLanguage || candidate.language : candidate.language) || 'unknown',
          originalLanguage: candidate.fieldLanguages?.[field.key] || candidate.language || 'unknown',
          translationMethod: candidate.fieldTranslations?.[field.key]?.method || '',
          license: candidate.license || '',
          licenseUrl: candidate.licenseUrl || '',
          authorsUrl: candidate.authorsUrl || '',
          fetchedAt: candidate.fetchedAt || Date.now(),
          originalValue: candidate.fields[field.key] ?? candidate.fields.durationMinutes ?? field.value,
          evidenceGroup: ['pdf', 'gemini'].includes(candidate.source) ? `manual:${candidate.evidence?.[field.key]?.sourceHash || candidate.manualHash || ''}` : `${candidate.source}:${candidate.id}`,
          ...(candidate.source === 'gemini' ? { generated: true } : {}),
          ...(candidate.evidence?.[field.key] ? { evidence: candidate.evidence[field.key] } : {}),
        };
        const fact = { value: field.value, ...provenance };
        alternatives[field.key] ||= [];
        if (!alternatives[field.key].some((old) => JSON.stringify(old.value) === JSON.stringify(fact.value) && old.source === fact.source && old.language === fact.language)) alternatives[field.key].push(fact);
        if (!(field.key in fields)) {
          fields[field.key] = fact.value;
          fieldSources[field.key] = provenance;
        }
      }
    }
    for (const [field, facts] of Object.entries(alternatives)) {
      const independent = new Set(facts.map((fact) => fact.evidenceGroup));
      consistency[field] = new Set(facts.map((fact) => factSignature(fact.value))).size > 1 ? 'conflict' : independent.size > 1 ? 'consistent' : 'single-source';
      if (['tags', 'mechanics'].includes(field)) {
        const value = [...new Set(facts.flatMap((fact) => fact.value))];
        fields[field] = value;
        fieldSources[field] = { ...fieldSources[field], origins: facts };
        // A união é a sugestão principal; as origens individuais continuam na revisão.
        alternatives[field] = [{ ...fieldSources[field], value }, ...facts];
        continue;
      }
      // Nomes e textos em idiomas diferentes são alternativas, não contradições numéricas.
      if (!['title', 'description'].includes(field) && new Set(facts.map((f) => factSignature(f.value))).size > 1) conflicts.push(`${field}: fontes com valores diferentes; escolha na revisão.`);
    }
    const names = members
      .flatMap((c) => c.names || [])
      .filter((name, i, all) => all.findIndex((n) => n.value === name.value && n.language === name.language) === i)
      .slice(0, 32);
    const pt = names.find((n) => /^pt-BR$/i.test(n.language)) || names.find((n) => /^pt$/i.test(n.language));
    if (pt) {
      const member = ordered.find((candidate) => candidate.names?.some((name) => name.value === pt.value && name.language === pt.language));
      const origin = {
        source: member.source,
        id: member.id,
        url: member.url || '',
        language: pt.language,
        originalLanguage: pt.language,
        license: member.license || '',
        licenseUrl: member.licenseUrl || '',
        authorsUrl: member.authorsUrl || '',
        fetchedAt: member.fetchedAt || Date.now(),
        originalValue: pt.value,
        translationMethod: '',
      };
      fields.title = pt.value;
      fieldSources.title = origin;
      alternatives.title ||= [];
      if (!alternatives.title.some((fact) => fact.value === pt.value && fact.source === member.source && fact.id === member.id)) alternatives.title.unshift({ ...origin, value: pt.value });
    }
    return {
      ...first,
      kind: members.find((member) => member.kind && member.kind !== 'unknown')?.kind || first.kind || 'unknown',
      fields,
      names,
      fieldSources,
      alternatives,
      consistency,
      pendingTranslations: ordered.flatMap((candidate) => portugueseCandidate(candidate).pendingTranslations),
      requiresEditionReview: members.some((c) => c.requiresEditionReview),
      conflicts: [...new Set(conflicts)],
      contributors: members.map(({ source, id, url = '' }) => ({ source, id, url })),
      members,
    };
  });
}

// Persistência opt-in por licença. Tokens, respostas brutas e conteúdo de fontes restritas nunca entram.
export function researchSnapshot(input, candidates, decisions = []) {
  const safe = candidates.filter((c) => (c.source === 'wikidata' && c.license === 'CC0') || (c.source === 'wikipedia' && c.license === 'CC BY-SA 4.0'));
  const references = new Set(safe.map((candidate) => `${candidate.source}:${candidate.id}`));
  const reviewed = decisions
    .filter((decision) => sameManual(decision, input) && editionCompatible(decision, input))
    .map((decision) => {
      const facts = (decision.facts || []).filter((fact) => references.has(`${fact.source}:${fact.id}`) && fact.key in fieldValues({ fields: { [fact.key]: fact.value } }));
      return {
        manualHash: input.manualHash || '',
        edition: input.edition || '',
        reviewedAt: decision.reviewedAt,
        reviewedBy: decision.reviewedBy || 'device',
        facts,
        fields: facts.map((fact) => fact.key),
        values: Object.fromEntries(facts.map((fact) => [fact.key, fact.value])),
        rejected: references.has(`${decision.source}:${decision.id}`) ? decision.rejected || [] : [],
        source: decision.source,
        id: decision.id,
      };
    })
    .filter((decision) => decision.facts.length);
  const snapshot = JSON.parse(
    JSON.stringify({
      schemaVersion: RESEARCH_SCHEMA,
      query: input.query,
      aliases: [...new Set([input.query, ...(input.alternateTitles || []).map((n) => n.value), ...safe.flatMap((c) => (c.names || []).map((n) => n.value))].map(researchName))].filter(Boolean).slice(0, 32),
      hints: (input.alternateTitles || []).slice(0, 6),
      identities: safe.map((candidate) => ({
        workId: candidate.identifiers?.wikidata ? `wikidata:${candidate.identifiers.wikidata}` : candidate.identifiers?.bgg ? `bgg:${candidate.identifiers.bgg}` : `${candidate.source}:${candidate.id}`,
        identifiers: candidate.identifiers || {},
        names: candidate.names || [],
        kind: candidate.kind || 'unknown',
        edition: input.edition || candidate.edition || '',
        editionConfirmed: reviewed.some((decision) => decision.facts.some((fact) => fact.key === 'edition' && fact.id === candidate.id)),
      })),
      edition: input.edition || '',
      kind: input.kind || 'unknown',
      preferredLanguage: input.preferredLanguage || 'pt-BR',
      manualHash: input.manualHash || '',
      fetchedAt: input.fetchedAt || Date.now(),
      expiresAt: (input.fetchedAt || Date.now()) + 21600000,
      // Uma revisão parcial no novo PDF não aprova silenciosamente os campos restantes.
      candidates: safe.slice(0, 12).map((candidate) => {
        if (!candidate.requiresEditionReview) return candidate;
        const fields = candidate.fields.title ? { title: candidate.fields.title } : {};
        for (const decision of reviewed) for (const fact of decision.facts) if (fact.source === candidate.source && fact.id === candidate.id) fields[fact.key] = fact.value;
        const fieldLanguages = { ...candidate.fieldLanguages };
        for (const decision of reviewed) for (const fact of decision.facts) if (fact.source === candidate.source && fact.id === candidate.id && fact.language) fieldLanguages[fact.key] = fact.language;
        return { ...candidate, fields, fieldLanguages, requiresEditionReview: false };
      }),
      decisions: reviewed.slice(-20),
    }),
  );
  if (new TextEncoder().encode(JSON.stringify(snapshot)).length > 120000) throw new Error('A pesquisa excedeu o limite de armazenamento. Os campos podem ser usados sem guardar esta consulta.');
  return snapshot;
}
export function researchForReuse(snapshot, input, now = Date.now()) {
  if (!compatibleResearch(snapshot, input)) return null;
  if (reusableResearch(snapshot, input, now)) return snapshot;
  // Dados já conferidos são conhecimento durável. Não renovar a data da consulta ou
  // reapresentar campos antigos que nunca foram revisados como se fossem confirmados.
  const fresh = snapshot.expiresAt > now;
  const decisions = (snapshot.decisions || []).filter((decision) => reviewedInContext(decision, snapshot));
  if (!fresh && !decisions.length) return null;
  const candidates = fresh
    ? snapshot.candidates
    : snapshot.candidates
        .map((candidate) => {
          const fields = {};
          for (const decision of decisions) for (const fact of decision.facts || []) if (fact.source === candidate.source && fact.id === candidate.id) fields[fact.key] = fact.value;
          const fieldLanguages = { ...candidate.fieldLanguages };
          for (const decision of decisions) for (const fact of decision.facts || []) if (fact.source === candidate.source && fact.id === candidate.id && fact.language) fieldLanguages[fact.key] = fact.language;
          return { ...candidate, fields, fieldLanguages };
        })
        .filter((candidate) => Object.keys(candidate.fields).length);
  if (sameManual(snapshot, input) && editionCompatible(snapshot, input) && !candidates.some((candidate) => differentEditions(candidate, input))) return candidates.length ? { ...snapshot, candidates, decisions, reviewedOnly: true } : null;

  // Título/identificadores são da obra. Metadados de outro PDF são apenas sugestões
  // sem aprovação; regras, páginas, idioma e referências do manual nunca atravessam.
  const projected = candidates.map((candidate) => {
    const fields = fieldValues(candidate);
    delete fields.edition;
    delete fields.language;
    const identityOnly = differentEditions(snapshot, input) || differentEditions(candidate, input);
    return {
      source: candidate.source,
      id: candidate.id,
      url: candidate.url || '',
      names: candidate.names,
      identifiers: candidate.identifiers || {},
      kind: candidate.kind || 'unknown',
      edition: '',
      fields: identityOnly ? (fields.title ? { title: fields.title } : {}) : fields,
      language: candidate.language,
      descriptionLanguage: candidate.descriptionLanguage,
      fieldLanguages: candidate.fieldLanguages,
      fieldTranslations: candidate.fieldTranslations,
      license: candidate.license,
      licenseUrl: candidate.licenseUrl,
      authorsUrl: candidate.authorsUrl,
      fetchedAt: candidate.fetchedAt,
      conflicts: [],
      requiresEditionReview: true,
    };
  });
  return projected.length ? { ...snapshot, candidates: projected, decisions: [], identities: [], needsEditionReview: true, reviewedOnly: !fresh } : null;
}
export function reusableResearch(snapshot, input, now = Date.now()) {
  return compatibleResearch(snapshot, input) && snapshot.expiresAt > now && sameManual(snapshot, input) && editionCompatible(snapshot, input) && !snapshot.candidates.some((candidate) => differentEditions(candidate, input));
}
function compatibleResearch(snapshot, input) {
  return (
    snapshot?.schemaVersion === RESEARCH_SCHEMA &&
    Array.isArray(snapshot.candidates) &&
    snapshot.candidates.length <= 12 &&
    snapshot.candidates.every(
      (candidate) => candidate && typeof candidate.id === 'string' && typeof candidate.source === 'string' && candidate.fields && typeof candidate.fields === 'object' && !Array.isArray(candidate.fields) && Array.isArray(candidate.names),
    ) &&
    Array.isArray(snapshot.aliases) &&
    snapshot.aliases.length <= 32 &&
    snapshot.aliases.every((alias) => typeof alias === 'string') &&
    snapshot.preferredLanguage === input.preferredLanguage &&
    (snapshot.kind === 'unknown' || input.kind === 'unknown' || snapshot.kind === input.kind) &&
    snapshot.aliases.includes(researchName(input.query))
  );
}
