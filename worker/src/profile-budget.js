// Uma identificação complementar por análise, protegida pelo lease do trabalho.
// Não há contador diário ou por minuto do Acervo; valem as cotas do provedor.
export const PROFILE_BUDGET = Object.freeze({ perAnalysis: 1, perMinute: null, perDay: null });

export async function reserveProfileBudget(storage, record, input, now = Date.now()) {
  if (!record || record.status !== 'running' || record.lease !== input.lease || record.expires <= now) return { allowed: false, reason: 'inactive-analysis' };
  if (record.profileBudgetReserved) return { allowed: false, reason: 'already-attempted' };
  record.profileBudgetReserved = true;
  await storage.put('job:' + input.key, record);
  return { allowed: true };
}
