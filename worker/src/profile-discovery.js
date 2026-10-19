import { normalizeText } from '../../js/model.js';
import { profileDefinitions } from '../../js/profile-facts.js';

export const PROFILE_DISCOVERY_MODEL = 'gemini-2.5-flash-lite';
export const PROFILE_DISCOVERY_PROTOCOL = 1;
const practicalFields = Object.keys(profileDefinitions).filter((k) => !['title', 'edition'].includes(k));
const present = (value) => value != null && value !== '' && (!Array.isArray(value) || value.length);
export const missingProfileFacts = (fields) => practicalFields.filter((k) => !present(fields?.[k]?.value ?? fields?.[k]));

async function boundedJSON(response) {
  if (!response.body) throw new Error('empty');
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  let size = 0,
    text = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 30000) throw new Error('too-large');
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

// Só propõe nomes. Nenhum número, texto promocional, URL ou regra da memória
// do modelo entra na ficha. Os conectores devem confirmar a identidade depois.
export async function discoverProfileNames(game, fields, env, fetcher, reserve) {
  const result = { version: PROFILE_DISCOVERY_PROTOCOL, model: PROFILE_DISCOVERY_MODEL, status: 'not-needed', missing: missingProfileFacts(fields), attemptedAt: Date.now(), hints: [] };
  if (!result.missing.length) return result;
  const budget = await reserve();
  if (!budget.allowed) return { ...result, status: 'quota', reason: budget.reason, retryAt: budget.retryAt || Date.now() + 60000 };
  const body = {
    systemInstruction: {
      parts: [
        {
          text: 'Ajude a identificar o jogo de tabuleiro informado pelo administrador para consultar catálogos autorizados. Sugira até três nomes da MESMA obra em português brasileiro, inglês e francês, com a grafia oficial que você conhece. O título corrigido pelo usuário e a edição são o contexto obrigatório. Não sugira expansões, franquias, outro jogo da série ou outra edição como equivalentes. Se houver dúvida, retorne ambiguous=true e nenhuma sugestão. Se não souber um nome, omita-o; nunca invente traduções. Você não dispõe de busca web nesta chamada: não afirme ter pesquisado. As sugestões serão tratadas somente como pistas e dependerão de confirmação independente nos catálogos. Não forneça metadados, regras, URLs, identificadores de catálogo nem valores presumidos.',
        },
      ],
    },
    contents: [{ role: 'user', parts: [{ text: JSON.stringify({ title: game.title, edition: game.edition || '', productKind: game.research?.kind || 'unknown', missingFields: result.missing }) }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.1,
      maxOutputTokens: 600,
      thinkingConfig: { thinkingBudget: 0 },
      responseSchema: {
        type: 'object',
        required: ['names', 'ambiguous'],
        properties: { ambiguous: { type: 'boolean' }, names: { type: 'array', items: { type: 'object', properties: { value: { type: 'string' }, language: { type: 'string', enum: ['pt-BR', 'en', 'fr'] } }, required: ['value', 'language'] } } },
      },
    },
  };
  try {
    const response = await fetcher(`https://generativelanguage.googleapis.com/v1beta/models/${PROFILE_DISCOVERY_MODEL}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(7000),
    });
    if (!response.ok)
      return {
        ...result,
        status: response.status === 429 ? 'quota' : [401, 403, 404].includes(response.status) ? 'unavailable' : 'failed',
        reason: 'provider-' + response.status,
        ...([429, 500, 502, 503, 504].includes(response.status) ? { retryAt: Date.now() + 60000 } : {}),
      };
    const answer = (await boundedJSON(response)).candidates?.[0];
    if (answer?.finishReason !== 'STOP') throw new Error('incomplete');
    const raw = JSON.parse(
      answer.content.parts
        .filter((p) => typeof p.text === 'string' && !p.thought)
        .map((p) => p.text)
        .join(''),
    );
    if (!Array.isArray(raw.names) || typeof raw.ambiguous !== 'boolean') throw new Error('invalid');
    if (raw.ambiguous) return { ...result, status: 'ambiguous' };
    const hints = raw.names
      .filter((n) => typeof n?.value === 'string' && n.value.trim().length >= 2 && n.value.length <= 160 && !/[\u0000-\u001f<>]|https?:|www\./i.test(n.value) && ['pt-BR', 'en', 'fr'].includes(n.language))
      .map((n) => ({ value: n.value.trim(), language: n.language, origin: 'gemini-hint' }))
      .filter((n, i, all) => normalizeText(n.value) !== normalizeText(game.title) && all.findIndex((other) => normalizeText(other.value) === normalizeText(n.value)) === i)
      .slice(0, 3);
    return { ...result, status: hints.length ? 'suggested' : 'no-hints', hints };
  } catch {
    return { ...result, status: 'failed', reason: 'incomplete-response', retryAt: Date.now() + 60000 };
  }
}
