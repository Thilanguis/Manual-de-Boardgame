import { normalizeText } from './model.js';
const subjects = [
  ['preparacao', 'preparar', 'montagem', 'montar', 'setup', 'preparation', 'distribuir', 'inicio'],
  ['turno', 'turnos', 'rodada', 'rodadas', 'turn', 'round', 'tour'],
  ['movimento', 'mover', 'movimentar', 'deslocar', 'movement', 'move', 'deplacement'],
  ['ataque', 'atacar', 'combate', 'batalha', 'attack', 'combat'],
  ['pontuacao', 'pontos', 'pontuar', 'score', 'scoring', 'decompte'],
  ['vitoria', 'vencer', 'ganhar', 'termino', 'fim', 'victory', 'winning', 'victoire'],
  ['componentes', 'pecas', 'fichas', 'components', 'composants'],
  ['objetivo', 'meta', 'objective', 'objectif'],
];
const stop = new Set('a o as os um uma de do da dos das e em no na nos nas para por como qual quais quando posso pode eu se que jogo jogar'.split(' '));
export function relevance(query, title, text) {
  const q = normalizeText(query),
    t = normalizeText(title),
    body = normalizeText(text);
  const tokens = q.split(/\W+/).filter((w) => w.length > 1);
  const significant = tokens.filter((w) => !stop.has(w));
  const words = [...new Set(significant.length ? significant : tokens)];
  if (!words.length) return 0;
  const variants = words.map((w) => subjects.find((group) => group.includes(w)) || [w]);
  const hits = variants.map((group) => ({ title: group.some((w) => new RegExp(`\\b${w}\\b`).test(t)), body: group.some((w) => new RegExp(`\\b${w}\\b`).test(body)) }));
  const count = hits.filter((h) => h.title || h.body).length;
  if (!count || count < Math.ceil(words.length * 0.6)) return 0;
  return count * 10 + hits.filter((h) => h.title).length * 12 + (t.includes(q) ? 20 : 0) + (body.includes(q) ? 8 : 0);
}
export function searchKnowledge(knowledge, query) {
  return (knowledge?.sections || [])
    .filter((s) => s.review !== 'rejected')
    .map((s) => {
      const source = knowledge.sources.find((r) => r.id === s.sourceId);
      return {
        title: s.title,
        text: s.text,
        score: relevance(query, s.title, s.text),
        source: s.review === 'unreviewed' ? 'Conhecimento gerado por IA · não confirmado' : 'Conhecimento revisado',
        subject: s.topic,
        sourceUrl: source?.url || '',
        sourceLicense: source?.license || '',
        sourceAuthors: source?.authorsUrl || '',
        sourceLicenseUrl: source?.licenseUrl || '',
        sourceLanguage: source?.language || '',
        generated: true,
        editionUnconfirmed: source?.scope !== 'edition-confirmed',
      };
    })
    .filter((s) => s.score)
    .sort((a, b) => b.score - a.score)
    .slice(0, 60);
}
