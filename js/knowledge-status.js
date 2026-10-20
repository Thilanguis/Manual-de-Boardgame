// Somente os antigos bloqueios do Acervo foram removidos. Cotas do provedor
// e falhas reais continuam intactas; abrir a ficha nunca inicia uma geração.
export function currentKnowledgeStatus(record) {
  if (record?.status !== 'quota') return record;
  const tagged = ['app-rate-limit', 'profile-rate-limit'].includes(record.reason);
  // A primeira versão gravava o limite 5/dia ou 2/min apenas como mensagem,
  // sem reason. Reconhecer só essa frase histórica, sem liberar cotas Google
  // ou bloqueios de origem desconhecida pela palavra genérica "limite".
  const untagged = !record.reason && !record.provider && record.message?.trim() === 'O limite de geração foi atingido. Tente novamente mais tarde.';
  if (!tagged && !untagged) return record;
  return {
    ...record,
    status: 'attention',
    reason: 'internal-limit-removed',
    quotaScope: '',
    retryAt: 0,
    message: 'O limite interno do Acervo foi removido. Solicite uma nova análise para completar as informações. O conhecimento salvo foi preservado.',
  };
}
