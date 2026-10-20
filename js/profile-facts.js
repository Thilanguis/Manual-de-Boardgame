import { normalizeText, synopsisText } from './model.js';
import { extractMetadata } from './recognition.js';
import { textQuality } from './text-quality.js';
import { durationSuggestion } from './research-duration.js';

// Somente campos editoriais já existentes no formulário. Idioma continua sendo o do PDF.
export const profileDefinitions = {
  title: { type: 'string', max: 160 },
  edition: { type: 'string', max: 100 },
  description: { type: 'string', max: 2000 },
  minPlayers: { type: 'integer', max: 100 },
  maxPlayers: { type: 'integer', max: 100 },
  minDurationMinutes: { type: 'integer', max: 1440 },
  maxDurationMinutes: { type: 'integer', max: 1440 },
  recommendedAge: { type: 'integer', max: 100 },
  tags: { type: 'array', max: 8 },
  mechanics: { type: 'array', max: 8 },
  gameType: { type: 'string', max: 80 },
};
export const modelProfileFields = Object.keys(profileDefinitions).filter((key) => !['title', 'edition'].includes(key));
// Esta validação é de formato, não confirmação externa de uma afirmação da IA.
export function validModelProfileValue(key, value) {
  if (!modelProfileFields.includes(key)) return false;
  const definition = profileDefinitions[key];
  if (definition.type === 'integer') return Number.isInteger(value) && value > 0 && value <= definition.max;
  if (definition.type === 'array') return Array.isArray(value) && value.length > 0 && value.length <= definition.max && value.every((v) => typeof v === 'string' && v.trim() && v.length <= 40 && !textQuality(v).corrupt);
  return typeof value === 'string' && !!value.trim() && value.length <= definition.max && !textQuality(value).corrupt;
}
export function modelProfileSchema() {
  return {
    type: 'object',
    required: ['requestedTitle', 'requestedEdition', 'recognized', 'fields'],
    properties: {
      requestedTitle: { type: 'string' },
      requestedEdition: { type: 'string' },
      recognized: { type: 'boolean' },
      fields: {
        type: 'object',
        required: modelProfileFields,
        properties: {
          ...Object.fromEntries(modelProfileFields.map((key) => [key, { type: profileDefinitions[key].type, nullable: true, ...(profileDefinitions[key].type === 'array' ? { items: { type: 'string' } } : {}) }])),
          durationMinutes: { type: 'integer', nullable: true },
        },
      },
    },
  };
}
export const PROFILE_INSTRUCTION =
  'Além das seções, examine obrigatoriamente TODOS os campos de metadata, não apenas a descrição: title, edition, description, minPlayers, maxPlayers, minDurationMinutes, maxDurationMinutes, recommendedAge, tags, mechanics e gameType. Preencha título oficial (não invente tradução), edição, resumo em PT-BR, jogadores, duração, idade, categorias/temas, mecânicas e tipo quando sustentados pelas fontes. Categorias, mecânicas e tipo podem sintetizar o que as passagens descrevem, em PT-BR, com evidência da classificação. Não deixe de examinar um campo porque já existe um resumo. Cada campo encontrado contém value, sourceId e referência verificável; campo examinado sem informação é null. Use o passage que sustenta cada valor. Se a duração for fixa, REPITA o mesmo número em minDurationMinutes e maxDurationMinutes (90 minutos = 90 e 90). Se houver intervalo, use o menor no mínimo e o maior no máximo, convertidos em minutos. Nunca use duração de uma ação/rodada como duração da partida. Faixas devem vir da mesma fonte. Não use contagens de componentes como jogadores ou idade. Não confunda idioma do manual com edição. Não invente valores, edições, categorias ou mecânicas. Esta ficha é adicional e não altera as instruções das seções de regras.';

export function profileSchema(manual, mixed = false) {
  return {
    type: 'object',
    required: Object.keys(profileDefinitions),
    properties: Object.fromEntries(
      Object.entries(profileDefinitions).map(([key, definition]) => [
        key,
        {
          type: 'object',
          nullable: true,
          properties: {
            value: definition.type === 'array' ? { type: 'array', items: { type: 'string' } } : { type: definition.type },
            sourceId: { type: 'string' },
            ...(manual ? { page: { type: 'integer' }, evidenceId: { type: 'string' } } : {}),
            ...(!manual || mixed ? { quote: { type: 'string' } } : {}),
            excerpt: { type: 'string' },
          },
          required: ['value', 'sourceId', ...(mixed ? [] : manual ? ['page', 'evidenceId'] : ['quote'])],
        },
      ]),
    ),
  };
}

export function inspectProfile(raw, sources, passagesFor) {
  const received = raw;
  raw = { ...raw };
  const min = raw.minDurationMinutes,
    max = raw.maxDurationMinutes,
    legacy = raw.durationMinutes;
  const singleton = min || max || legacy;
  const singletonSource = sources.find((s) => s.id === singleton?.sourceId);
  const singletonPage = singletonSource?.pages?.find((p) => p.page === singleton?.page);
  const singletonQuote = singleton?.excerpt || (singletonPage && passagesFor ? passagesFor(singletonPage, singletonSource.id).find((p) => p.id === singleton?.evidenceId)?.text : singleton?.quote) || '';
  const bound = /(?:no m[ií]nimo|no m[aá]ximo|pelo menos|at least|at most|up to|minimum of|maximum of|jusqu|au moins)/i.test(singletonQuote);
  const explicit = { ...extractMetadata(singletonQuote), ...(!singletonSource?.pages ? durationSuggestion(singletonSource?.facts || {}) : {}) };
  const evidenceRange = explicit.minDurationMinutes != null && explicit.maxDurationMinutes != null ? `${explicit.minDurationMinutes}-${explicit.maxDurationMinutes}` : undefined;
  const normalized = durationSuggestion({ minDurationMinutes: min?.value, maxDurationMinutes: max?.value, durationMinutes: legacy?.value ?? evidenceRange, durationBound: bound && !(min && max) });
  // Um extremo ausente só é completado quando a evidência confirma ambos os limites.
  const canComplete = !!(min && max) || (!bound && normalized.minDurationMinutes != null && explicit.minDurationMinutes === normalized.minDurationMinutes && explicit.maxDurationMinutes === normalized.maxDurationMinutes);
  if (singleton && canComplete)
    for (const key of ['minDurationMinutes', 'maxDurationMinutes']) {
      if (normalized[key] == null) continue;
      const origin = [min, max, legacy].find((f) => f && Number(f.value) === normalized[key]) || singleton;
      raw[key] = { ...origin, value: normalized[key] };
    }
  const fields = {},
    rejected = [];
  const reject = (key, reason) => rejected.push({ key, reason });
  for (const [key, definition] of Object.entries(profileDefinitions)) {
    const item = raw?.[key],
      source = sources.find((s) => s.id === item?.sourceId);
    if (!item) continue;
    if (!source) {
      reject(key, 'source');
      continue;
    }
    if (source.origin === 'model-knowledge') {
      if (!source.profileOnly || !source.modelOnly || source.profileEligible === false || item.basis !== 'model' || !validModelProfileValue(key, item.value) || JSON.stringify(source.claims?.[key]) !== JSON.stringify(item.value)) {
        reject(key, 'model-value');
        continue;
      }
      fields[key] = { value: item.value, sourceId: source.id, basis: 'model', verified: false, generated: true, language: 'pt-BR', model: source.model, license: source.license, url: '' };
      continue;
    }
    if (source.profileEligible === false || source.scope === 'general-work-only' || source.scope === 'edition-unconfirmed' || (source.profileOnly && source.profileSpecificEligible === false && (definition.type === 'integer' || key === 'edition'))) {
      reject(key, 'edition');
      continue;
    }
    const page = source.pages?.find((p) => p.page === item.page);
    const passages = page && passagesFor?.(page, source.id);
    let passage = passages?.find((p) => p.id === item.evidenceId);
    // Corrige somente uma referência mecânica: mesmo documento/página e trecho
    // literal sustentado por um único passage. Nunca procura outra página.
    if (!passage && passages && typeof item.excerpt === 'string' && item.excerpt.trim().length >= 8) {
      const matches = passages.filter((p) => p.text.includes(item.excerpt.trim()));
      if (matches.length === 1) passage = matches[0];
    }
    const quote = passagesFor && source.pages ? passage?.text : item.quote;
    const evidence = source.pages ? page?.text : JSON.stringify(source.facts || {});
    if (!quote || quote.length < 8 || quote.length > 1500 || !normalizeText(evidence).includes(normalizeText(quote))) {
      reject(key, 'evidence');
      continue;
    }
    const snippet = typeof item.excerpt === 'string' && item.excerpt.trim() ? item.excerpt.trim() : quote;
    if (!normalizeText(quote).includes(normalizeText(snippet))) {
      reject(key, 'excerpt');
      continue;
    }
    if (textQuality(snippet).corrupt || (typeof item.value === 'string' && textQuality(item.value).corrupt)) {
      reject(key, 'corrupt-text');
      continue;
    }
    let value = item.value;
    if (definition.type === 'integer') {
      const structured = source.pages ? undefined : (source.facts?.[key] ?? (/Duration/.test(key) ? source.facts?.durationMinutes : undefined));
      const parsed = structured !== undefined ? structured : extractMetadata(snippet)[key];
      if (!Number.isInteger(value) || value < 1 || value > definition.max || (parsed != null && parsed !== value) || (parsed == null && !new RegExp(`\\b${value}\\b`).test(snippet))) {
        reject(key, 'value');
        continue;
      }
      if (structured != null && !new RegExp(`\\b${value}\\b`).test(snippet)) {
        reject(key, 'evidence');
        continue;
      }
      const context = normalizeText(snippet);
      if (
        structured == null &&
        ((/Players$/.test(key) && !/jogador|player|joueur/.test(context)) ||
          (/Duration/.test(key) && !/minut|\bmin\b|hora|hour|heure/.test(context)) ||
          (key === 'recommendedAge' && !/idade|anos|years|age|\bans\b|\d\s*\+/.test(context + ' ' + quote)))
      ) {
        reject(key, 'context');
        continue;
      }
    } else if (definition.type === 'array') {
      if (!Array.isArray(value) || !value.length || value.length > definition.max || value.some((v) => typeof v !== 'string' || !v.trim() || v.length > 40 || textQuality(v).corrupt)) {
        reject(key, 'value');
        continue;
      }
      value = [...new Set(value.map((v) => v.trim()))];
    } else {
      if (typeof value !== 'string' || !value.trim() || value.length > definition.max) {
        reject(key, 'value');
        continue;
      }
      value = value.trim();
      if (['title', 'edition'].includes(key) && !normalizeText(quote).includes(normalizeText(value))) {
        reject(key, 'identity');
        continue;
      }
    }
    fields[key] = {
      value,
      sourceId: source.id,
      quote,
      excerpt: snippet,
      language: 'pt-BR',
      originalLanguage: source.language,
      generated: true,
      ...(page ? { page: page.page, evidenceId: passage?.id || item.evidenceId, documentId: source.documentId || 'main', sourceHash: source.sourceHash } : {}),
      license: source.license || '',
      url: source.url || '',
    };
  }
  for (const pair of [
    ['minPlayers', 'maxPlayers'],
    ['minDurationMinutes', 'maxDurationMinutes'],
  ]) {
    const [a, b] = pair.map((k) => fields[k]);
    if (!!a !== !!b || (a && (a.sourceId !== b.sourceId || a.value > b.value)))
      for (const key of pair)
        if (fields[key]) {
          delete fields[key];
          reject(key, 'range');
        }
  }
  return {
    fields,
    analysis: {
      version: 3,
      complete: !!received && typeof received === 'object' && !Array.isArray(received),
      returned: Object.keys(received || {}).filter((k) => k in profileDefinitions && received[k] != null).length,
      checkedFields: Object.keys(profileDefinitions).filter((k) => Object.hasOwn(received || {}, k)),
      coverageComplete: Object.keys(profileDefinitions).every((k) => Object.hasOwn(received || {}, k)),
      valid: Object.keys(fields).length,
      validFields: Object.keys(fields),
      rejected,
      missing: Object.keys(profileDefinitions).filter((k) => !raw?.[k]),
    },
  };
}
export const validateProfile = (raw, sources, passagesFor) => inspectProfile(raw, sources, passagesFor).fields;
export function profileCoverageComplete(knowledge) {
  if (knowledge?.profileAnalysis?.coverageComplete === true && Object.keys(profileDefinitions).every((k) => knowledge.profileAnalysis.checkedFields?.includes(k))) return true;
  // Uma ficha antiga com todos os fatos válidos não precisa consumir outra cota
  // apenas para ganhar o novo marcador de cobertura.
  if (!Object.keys(profileDefinitions).every((k) => knowledge?.profile?.[k])) return false;
  const valid = validateProfile(knowledge.profile, knowledge.sources || []);
  return Object.keys(profileDefinitions).every((k) => valid[k]);
}
export function combinedProfileComplete(knowledge, evidenceProtocol = 1) {
  if (!profileCoverageComplete(knowledge)) return false;
  const fields = validateProfile(knowledge?.profile, knowledge?.sources || []);
  const descriptions = [fields.description?.value, knowledge.fields?.description?.value].filter((value) => typeof value === 'string' && value.trim());
  // O contrato antigo podia tratar um rótulo como sinopse e bloquear o clique.
  // A leitura continua só reutilizando; uma tentativa nova recebe o marcador,
  // inclusive se não conseguir uma sinopse, e não entra em ciclo de geração.
  if (!(knowledge.profileAnalysis?.summaryProtocol >= 1) && descriptions.length && descriptions.every((value) => !synopsisText(value))) return false;
  const practical = Object.keys(profileDefinitions).filter((k) => !['title', 'edition'].includes(k));
  const missing = practical.some((k) => fields[k] == null && knowledge.fields?.[k] == null);
  const discovery = knowledge?.profileAnalysis?.discovery;
  // Uma tentativa concluída (inclusive sem evidência ou modelo indisponível)
  // não dispara chamadas em loop. Só um clique após retryAt pode tentar de novo.
  if (missing && (!discovery?.version || (discovery.retryAt && discovery.retryAt <= Date.now()))) return false;
  if (knowledge?.profileAnalysis?.publicEvidenceProtocol >= evidenceProtocol) return true;
  return Object.keys(profileDefinitions).every((key) => fields[key]);
}
export function profileSourceMatches(source, documents) {
  if (!source.profileOnly) return true;
  return Array.isArray(source.contextManualHashes) && JSON.stringify([...source.contextManualHashes].sort()) === JSON.stringify(documents.map((d) => d.manual?.sha256).sort());
}
