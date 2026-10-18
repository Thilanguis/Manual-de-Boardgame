import { normalizeText } from './model.js';
import { duplicatePassage, cleanRuleText } from './rule-passages.js';
const subjects = [
  ['preparacao', 'preparar', 'preparando', 'montagem', 'montar', 'setup', 'preparation', 'preparer', 'distribuir'],
  ['turno', 'turnos', 'rodada', 'rodadas', 'turn', 'turns', 'round', 'rounds', 'tour', 'tours', 'deroulement'],
  ['movimento', 'movimentacao', 'deslocamento', 'mover', 'movimentar', 'mova', 'mova-se', 'deslocar', 'movement', 'move', 'moving', 'deplacement', 'deplacer'],
  ['ataque', 'atacar', 'ataca', 'combate', 'batalha', 'attack', 'attacking', 'combat', 'attaquer', 'attaque'],
  ['pontuacao', 'pontos', 'pontuar', 'score', 'scoring', 'decompte'],
  ['vitoria', 'vencer', 'vence', 'ganhar', 'victory', 'winning', 'win', 'victoire', 'gagner'],
  ['componentes', 'componente', 'components', 'component', 'composants', 'materiel', 'conteudo'],
  ['cartas', 'carta', 'cards', 'card', 'cartes', 'carte'],
  ['custos', 'custo', 'custar', 'custa', 'pagar', 'pagamento', 'cost', 'costs', 'pay', 'cout', 'couts', 'payer'],
  ['sobrevivente', 'sobreviventes', 'survivor', 'survivors', 'survivant', 'survivants'],
  ['inimigo', 'inimigos', 'enemy', 'enemies', 'ennemi', 'ennemis'],
  ['objetivo', 'meta', 'objective', 'objectif'],
];
const stop = new Set(
  'a o as os um uma de do da dos das e em no na nos nas para por como qual quais quando posso pode eu se que jogo jogar funciona funcionam fazer faco devo preciso durante possivel permitido consigo acontece quanto quanta quantos quantas condicoes condicao vem sao esta este esse essa isso os the how what which when can could do does i a an of to in on is are and game rules le la les du de des un une au aux jeu partie comment quel quelle quels quelles est sont je puis il'.split(
    ' ',
  ),
);
function queryGroups(query) {
  const tokens = normalizeText(query)
      .split(' ')
      .filter((w) => w.length > 1),
    significant = tokens.filter((w) => !stop.has(w));
  const unique = new Map();
  for (const word of significant.length ? significant : tokens) {
    const group = subjects.find((g) => g.includes(word)) || [word];
    unique.set(group[0], group);
  }
  return [...unique.values()];
}
export const queryWords = (query) => queryGroups(query).flat();
export function ruleMatch(query, title, text, subject = '') {
  const q = normalizeText(query),
    t = normalizeText(title).replace(/\bfim (?:de |do |da )?(?:jogo|partida)\b|\bgame end\b|\bfin de partie\b/g, 'vitoria'),
    body = normalizeText(text),
    topic = normalizeText(subject);
  const groups = queryGroups(query);
  if (!groups.length) return { score: 0, matchType: 'related', coverage: 0 };
  const titleWords = new Set(t.split(' ')),
    bodyWords = new Set(body.split(' '));
  const titleSubjects = subjects.filter((group) => group.some((w) => titleWords.has(w)));
  const compatibleTopic = !titleSubjects.length || titleSubjects.some((group) => group.includes(topic));
  const hits = groups.map((group) => ({ title: group.some((w) => titleWords.has(w)), body: group.some((w) => bodyWords.has(w)), topic: compatibleTopic && group.some((w) => topic === w) && group.some((w) => bodyWords.has(w)) }));
  const count = hits.filter((h) => h.title || h.body || h.topic).length;
  if (!count) return { score: 0, matchType: 'related', coverage: 0 };
  const coverage = count / groups.length;
  const primary = groups.findIndex((g) => ['ataque', 'movimento', 'turno', 'custos', 'preparacao', 'vitoria'].includes(g[0]));
  const contents = (String(text).match(/[.…]{3,}/g) || []).length >= 2;
  const direct = !contents && coverage >= 0.75 && (primary >= 0 ? hits[primary].title || hits[primary].topic : hits.some((h) => h.title || h.topic));
  const topicTitle = t
    .split(' ')
    .filter((w) => !['a', 'de', 'do', 'da', 'the'].includes(w))
    .join(' ');
  const focused = primary >= 0 && groups[primary].includes(topicTitle) ? 22 : 0;
  const instruction = primary >= 0 && /^(?:como|how|comment)\b/.test(q) && /^(?:revele|mova|escolha|gaste|pague|coloque|para|the survivor|o sobrevivente)\b/.test(body) ? 10 : 0;
  const procedural = primary >= 0 && /\b(?:actions|acoes|sequencia|sequence|fase)\b/.test(t) ? 12 : 0;
  const aside = primary >= 0 && /\b(?:itens|vantagem|bonus|characteristics|caracteristicas)\b/.test(t) ? 12 : 0;
  return {
    score:
      focused +
      instruction +
      procedural -
      aside +
      Math.round(coverage * 35) +
      hits.reduce((sum, h, i) => sum + (h.title ? (['inimigo', 'sobrevivente'].includes(groups[i][0]) ? 6 : 24) : 0), 0) +
      (t === q ? 25 : t.includes(q) ? 12 : 0) +
      (direct ? 80 : 0) -
      (contents ? 30 : 0),
    matchType: direct ? 'direct' : 'related',
    coverage,
  };
}
export const relevance = (query, title, text) => ruleMatch(query, title, text).score;

export function rankRuleResults(input, limit = 60) {
  const ordered = [...input].sort(
    (a, b) =>
      Number(b.matchType === 'direct') - Number(a.matchType === 'direct') ||
      (b.coverage || 0) - (a.coverage || 0) ||
      b.score + (b.corrected || b.sectionId ? 20 : b.generated ? 12 : 0) - (a.score + (a.corrected || a.sectionId ? 20 : a.generated ? 12 : 0)) ||
      (a.page || Infinity) - (b.page || Infinity),
  );
  const result = [];
  for (const item of ordered) {
    const duplicate = result.find((old) => duplicatePassage(old, item));
    if (duplicate) {
      duplicate.additionalReferences ||= [];
      const ref = { documentId: item.documentId, sourceHash: item.sourceHash, page: item.page, source: item.source };
      if (item.page && !duplicate.additionalReferences.some((r) => r.documentId === ref.documentId && r.page === ref.page && r.sourceHash === ref.sourceHash)) duplicate.additionalReferences.push(ref);
    } else result.push({ ...item });
    if (result.length >= limit) break;
  }
  return result;
}
export function searchKnowledge(knowledge, query) {
  return (knowledge?.sections || [])
    .filter((s) => s.review !== 'rejected')
    .map((s) => {
      const source = knowledge.sources.find((r) => r.id === s.sourceId);
      return {
        title: s.title,
        text: cleanRuleText(s.text),
        originalText: s.text,
        ...ruleMatch(query, s.title, s.text, s.topic),
        source: source?.pages ? (s.review === 'manual' ? 'Explicação corrigida' : s.review === 'accepted' ? 'Informação revisada' : 'Explicação por IA · confira no manual') : 'Informação geral · fontes públicas',
        subject: s.topic,
        sourceUrl: source?.url || '',
        sourceLicense: source?.license || '',
        sourceAuthors: source?.authorsUrl || '',
        sourceLicenseUrl: source?.licenseUrl || '',
        sourceLanguage: source?.language || '',
        generated: true,
        corrected: s.review === 'manual' || s.review === 'accepted',
        page: s.page || null,
        documentId: s.documentId || source?.documentId || 'main',
        sourceHash: s.sourceHash || source?.sourceHash || '',
        editionUnconfirmed: !source?.pages && source?.scope !== 'edition-confirmed',
      };
    })
    .filter((s) => s.score)
    .sort((a, b) => b.score - a.score)
    .slice(0, 60);
}
