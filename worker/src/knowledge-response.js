import { ApiError } from './auth.js';
import { KNOWLEDGE_OUTPUT_TOKENS } from './knowledge-limits.js';

export function providerRequestError(httpStatus, payload) {
  const status = typeof payload?.error?.status === 'string' && /^[A-Z_]{1,50}$/.test(payload.error.status) ? payload.error.status : 'UNKNOWN';
  const message = typeof payload?.error?.message === 'string' ? payload.error.message : '';
  const schema = httpStatus === 400 && /too many states|schema.*(?:complex|large|nested)|(?:complex|large).*schema/i.test(message);
  const reason =
    httpStatus === 429
      ? 'provider-rate-limit'
      : schema
        ? 'provider-schema-rejected'
        : httpStatus === 400
          ? 'provider-invalid-request'
          : [401, 403].includes(httpStatus)
            ? 'provider-not-authorized'
            : httpStatus === 404
              ? 'provider-model-unavailable'
              : 'provider-unavailable';
  const messages = {
    'provider-rate-limit': 'A cota gratuita da IA foi atingida. Tente novamente mais tarde.',
    'provider-schema-rejected': 'O Gemini recusou o formato da ficha enviado pelo servidor (HTTP 400). A análise não foi concluída; os dados anteriores foram preservados.',
    'provider-invalid-request': 'O Gemini recusou a configuração da análise enviada pelo servidor (HTTP 400). A análise não foi concluída; os dados anteriores foram preservados.',
    'provider-not-authorized': 'A IA não foi autorizada. Confira a chave e o acesso ao modelo.',
    'provider-model-unavailable': 'O modelo não está disponível para esta chave. Confira a configuração.',
    'provider-unavailable': `O serviço Gemini está indisponível (HTTP ${httpStatus}). Nenhuma repetição automática foi feita; os dados anteriores foram preservados.`,
  };
  return Object.assign(new ApiError(httpStatus === 429 ? 429 : 502, messages[reason]), { reason, provider: { httpStatus, status, category: reason } });
}

export function generationDiagnostic(payload) {
  const safeCode = (v) => (typeof v === 'string' && /^[A-Z_]{1,50}$/.test(v) ? v : 'UNKNOWN');
  const finishReason = payload.candidates?.[0]?.finishReason || payload.promptFeedback?.blockReason;
  return {
    finishReason: safeCode(finishReason),
    maxOutputTokens: KNOWLEDGE_OUTPUT_TOKENS,
    usage: Object.fromEntries(
      Object.entries({ inputTokens: 'promptTokenCount', outputTokens: 'candidatesTokenCount', thinkingTokens: 'thoughtsTokenCount', totalTokens: 'totalTokenCount' }).flatMap(([key, name]) => {
        const n = payload.usageMetadata?.[name];
        return Number.isSafeInteger(n) && n >= 0 ? [[key, n]] : [];
      }),
    ),
  };
}

export function readKnowledgeResponse(payload) {
  if (!payload || typeof payload !== 'object') payload = {};
  const generation = generationDiagnostic(payload);
  const fail = (reason, message) => {
    throw Object.assign(new ApiError(502, message), { reason, generation });
  };
  const candidate = payload.candidates?.[0];
  if (!candidate || candidate.finishReason !== 'STOP') {
    if (generation.finishReason === 'MAX_TOKENS' || generation.finishReason === 'CONTINUATION')
      fail('provider-output-limit', 'O Gemini atingiu o limite de saída antes de concluir a ficha e as regras. A resposta parcial não foi aplicada; os dados já encontrados foram preservados. Nenhuma repetição automática foi feita.');
    if (payload.promptFeedback?.blockReason || ['SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII'].includes(generation.finishReason))
      fail('provider-content-blocked', 'O Gemini bloqueou a resposta. Nenhum conteúdo parcial foi aplicado; os dados já encontrados foram preservados. Nenhuma repetição automática foi feita.');
    fail('provider-incomplete', 'O Gemini interrompeu a análise sem concluir uma resposta válida. Os dados já encontrados foram preservados. Nenhuma repetição automática foi feita.');
  }
  try {
    const raw = JSON.parse(
      (candidate.content?.parts || [])
        .filter((p) => !p.thought && typeof p.text === 'string')
        .map((p) => p.text)
        .join(''),
    );
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error();
    return { raw, generation };
  } catch {
    fail('provider-invalid-json', 'A resposta do Gemini não contém dados completos em formato válido. Os dados já encontrados foram preservados. Nenhuma repetição automática foi feita.');
  }
}
