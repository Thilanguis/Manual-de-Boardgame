import { inspectProfile, profileCoverageComplete } from './profile-facts.js';
import { fieldLabels } from './research-client.js';
export const profileRejectionLabels = {
  source: 'fonte não reconhecida',
  edition: 'edição não confirmada',
  evidence: 'página ou passagem não verificável',
  excerpt: 'trecho não encontrado na evidência',
  'corrupt-text': 'texto ilegível',
  value: 'valor inválido ou sem sustentação',
  context: 'número sem contexto do campo',
  identity: 'nome ou edição não encontrado no trecho',
  range: 'faixa incompleta ou inconsistente',
  application: 'não aplicável à identificação atual ou sem conteúdo útil para o campo',
  'model-value': 'complemento do modelo com valor inválido',
  'model-range': 'complemento do modelo com faixa incompleta ou inconsistente',
};
export function profileDiagnostic(record, candidate) {
  const knowledge = record?.knowledge;
  const checked = inspectProfile(knowledge?.profile, knowledge?.sources || []);
  const analysis = knowledge?.profileAnalysis || checked.analysis;
  const legacy = !!knowledge && !profileCoverageComplete(knowledge);
  const valid = Object.keys(candidate?.fields || {}).filter((k) => ['gemini', 'gemini-public', 'gemini-model'].includes(candidate.fieldOrigins?.[k])).length;
  const origin = record?.analysisOrigin || (record?.reusedDraft ? 'server-cache' : 'stored');
  const originLabel = { 'local-cache': 'cache deste dispositivo', 'server-cache': 'cache do servidor', generation: 'nova análise', stored: 'análise salva', cache: 'cache' }[origin] || origin;
  const failed = ['attention', 'quota'].includes(record?.status);
  const rejected = [...(analysis.rejected || []), ...checked.analysis.rejected].filter((r, i, a) => a.findIndex((v) => v.key === r.key && v.reason === r.reason) === i);
  const discovery = analysis.discovery || record?.profileDiscovery;
  const discoveryLabels = {
    'not-needed': 'Os fatos disponíveis dispensaram a descoberta adicional de nomes.',
    confirmed: 'O Gemini sugeriu nomes alternativos confirmados pelos catálogos. Somente os fatos das fontes verificadas foram utilizados.',
    unconfirmed: 'Os nomes sugeridos pelo Gemini não tiveram confirmação independente; nenhum fato foi presumido.',
    'no-hints': 'O Gemini não forneceu nomes alternativos adicionais. Os fatos disponíveis continuam utilizáveis.',
    ambiguous: 'A identificação ficou ambígua; obras e edições diferentes não foram misturadas.',
    quota: 'A descoberta adicional de nomes atingiu seu limite. Os fatos já disponíveis continuam utilizáveis.',
    unavailable: 'O modelo de descoberta adicional de nomes não está disponível para este projeto. Os demais conectores continuam utilizáveis.',
    failed: 'A descoberta adicional de nomes não concluiu. Não houve repetição automática.',
  };
  for (const key of Object.keys(checked.fields)) if (!Object.hasOwn(candidate?.fields || {}, key) && !rejected.some((r) => r.key === key)) rejected.push({ key, reason: 'application' });
  return {
    status: record?.status || 'not_started',
    statusLabel: failed
      ? 'Última tentativa não concluída'
      : record?.status === 'running'
        ? 'Análise em andamento'
        : record?.status === 'ready'
          ? legacy
            ? 'Análise antiga; ficha ainda não examinada por completo'
            : 'Análise concluída'
          : 'Análise ainda não concluída',
    legacy,
    origin,
    originLabel,
    returned: failed ? null : (analysis.returned ?? null),
    valid: failed ? 0 : valid,
    preservedValid: failed ? valid : 0,
    provider: record?.provider || null,
    discovery,
    discoveryMessage: !failed && discovery ? discoveryLabels[discovery.status] || '' : '',
    rejected: failed ? [] : rejected,
    missing: failed ? [] : (analysis.missing || checked.analysis.missing).filter((key) => !Object.hasOwn(candidate?.fields || {}, key)),
    limitations: [
      ...(knowledge?.sources || []).filter((s) => s.incompletePages?.length).map((s) => `${failed ? 'Na análise anterior, ' : ''}${s.name || 'Manual'}: páginas ${s.incompletePages.join(', ')} sem leitura suficiente.`),
      ...(knowledge?.diagnostics || [])
        .filter((d) => d.state === 'failed' || d.state === 'ambiguous')
        .map((d) => (d.state === 'ambiguous' ? 'Há mais de um jogo com esse nome. As informações dessas obras não foram misturadas.' : 'Uma fonte pública não respondeu; algumas informações podem estar indisponíveis.')),
    ],
    message: record?.message || '',
    generation: record && Object.hasOwn(record, 'generation') ? record.generation : knowledge?.generation || null,
    modelCompletion: analysis.modelCompletion || null,
    summary:
      record?.status === 'ready'
        ? legacy
          ? `Gemini · análise antiga: ${valid} ${valid === 1 ? 'campo aproveitável' : 'campos aproveitáveis'}. Os demais campos ainda não foram examinados pelo contrato atual.`
          : `Gemini · ${originLabel}: ${valid ? `${valid} ${valid === 1 ? 'campo válido disponível' : 'campos válidos disponíveis'}.` : 'nenhum campo válido para preencher a ficha.'}`
        : record?.message || '',
  };
}
export const rejectionText = (item) => `${fieldLabels[item.key] || item.key}: ${profileRejectionLabels[item.reason] || item.reason}.`;
