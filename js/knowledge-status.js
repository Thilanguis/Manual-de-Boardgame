// Somente os antigos bloqueios do Acervo foram removidos. Cotas do provedor
// e falhas reais continuam intactas; abrir a ficha nunca inicia uma geração.
export function currentKnowledgeStatus(record) {
  if (record?.status !== 'quota' || !['app-rate-limit', 'profile-rate-limit'].includes(record.reason)) return record;
  return {
    ...record,
    status: 'attention',
    reason: 'internal-limit-removed',
    quotaScope: '',
    retryAt: 0,
    message: 'O limite interno do Acervo foi removido. Solicite uma nova análise para completar as informações. O conhecimento salvo foi preservado.',
  };
}
