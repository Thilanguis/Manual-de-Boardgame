import { ApiError } from './auth.js';

// Limites locais e finitos. Não mudam projeto, modelo, plano ou cotas.
export const MANUAL_TEXT_LIMIT = 400000;
export const DRAFT_REQUEST_BYTES = 3000000;
export const KNOWLEDGE_REQUEST_BYTES = 1200000; // até 32 correções de 6.000 caracteres
export const KNOWLEDGE_OUTPUT_TOKENS = 16384;
// A ficha completa compartilha a geração com as regras. O prazo de 18 s do
// processamento antigo não comportava respostas válidas mais demoradas.
export const PROFILE_GENERATION_TIMEOUT_MS = 60000;
export const PROFILE_TASK_TIMEOUT_MS = 85000;
const SOURCE_BYTES = 1000000;
export const fitsKnowledgeRecord = (record) => new TextEncoder().encode(JSON.stringify(record)).byteLength <= 1800000;

export function checkManualText(characters) {
  if (characters <= MANUAL_TEXT_LIMIT) return;
  throw Object.assign(
    new ApiError(
      413,
      `Os manuais têm ${characters.toLocaleString('pt-BR')} caracteres e excedem o limite de ${MANUAL_TEXT_LIMIT.toLocaleString('pt-BR')} por análise. Nenhuma página foi omitida e nenhuma geração foi iniciada. Os fatos já encontrados continuam disponíveis.`,
    ),
    { reason: 'manual-text-limit' },
  );
}

export function checkKnowledgeSources(sources) {
  // Reserva espaço para explicações, ficha e correções no registro SQLite (2 MB).
  // Conta bytes reais, inclusive escapes JSON e alfabetos multibyte.
  if (new TextEncoder().encode(JSON.stringify(sources)).byteLength <= SOURCE_BYTES) return;
  throw Object.assign(new ApiError(413, 'As evidências excedem o limite de 1 MB por análise. Nenhuma página foi omitida. A geração da ficha e das regras não foi iniciada; os fatos já encontrados continuam disponíveis.'), {
    reason: 'knowledge-source-limit',
  });
}
