// Somente capacidades já recuperadas. Nunca consulta saúde/cota/provedor aqui.
export function profileUnavailable(health, { draft = false } = {}) {
  if (!health || health.error) return { reason: 'connection', message: 'Não foi possível conferir a conexão da IA. Os fatos do PDF continuam disponíveis.' };
  if (health.knowledgeConfigured === false) return { reason: 'configuration', message: 'A IA ainda não foi configurada no servidor. Somente fatos encontrados no PDF e nas fontes poderão ser preenchidos.' };
  if (health.manualAiEnabled === false) return { reason: 'authorization', message: 'A análise por IA está desativada pelo administrador. Somente fatos encontrados no PDF e nas fontes poderão ser preenchidos.' };
  if (draft && !(health.profileMetadataProtocol >= 1)) return { reason: 'server-update', message: 'O servidor precisa ser atualizado para analisar a ficha com IA. Nenhuma geração foi iniciada.' };
  if (health.knowledgeConfigured !== true || health.manualAiEnabled !== true) return { reason: 'connection', message: 'A disponibilidade da IA não foi confirmada. Nenhuma geração foi iniciada.' };
  return null;
}
