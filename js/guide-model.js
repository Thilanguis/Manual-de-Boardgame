import { normalizeText } from './model.js';
export const GUIDE_LIMIT = 350000;
export const SECTION_TYPES = ['texto', 'lista', 'aviso', 'exemplo', 'pergunta'];
export function emptyGuide(game) {
  return { gameId: game.id, revision: 0, sourceHash: game.manual.sha256, sections: [], assets: {}, indexFileId: '', reviewed: false };
}
export function cleanGuide(input) {
  const sections = (Array.isArray(input.sections) ? input.sections : []).map((s) => {
    const text = String(s.text || '').trim(),
      title = String(s.title || '').trim();
    if (!title || title.length > 160 || text.length > 20000) throw new Error('Cada seção precisa de título (até 160 caracteres) e texto de até 20.000 caracteres.');
    const page = Number(s.page) || null;
    if (page !== null && (!Number.isInteger(page) || page < 1 || page > 20000)) throw new Error('Referência de página inválida.');
    return {
      id: /^[a-f0-9-]{36}$/i.test(s.id || '') ? s.id : crypto.randomUUID(),
      title,
      text,
      type: SECTION_TYPES.includes(s.type) ? s.type : 'texto',
      page,
      reviewed: s.reviewed === true,
      imageId: /^[A-Za-z0-9_-]{6,200}$/.test(s.imageId || '') ? s.imageId : '',
      caption: String(s.caption || '').slice(0, 500),
      source: String(s.source || '').slice(0, 160),
    };
  });
  if (sections.length > 100) throw new Error('Use até 100 seções por guia.');
  const content = JSON.stringify(sections);
  if (new TextEncoder().encode(content).length > GUIDE_LIMIT) throw new Error('O guia ultrapassa 350 KB de texto. Reduza o conteúdo antes de salvar.');
  const assets = Object.fromEntries(
    Object.entries(input.assets || {})
      .filter(([id, value]) => /^[A-Za-z0-9_-]{6,200}$/.test(id) && ['image/jpeg', 'application/gzip'].includes(value?.mimeType))
      .slice(0, 100),
  );
  for (const s of sections) if (s.imageId && assets[s.imageId]?.mimeType !== 'image/jpeg') throw new Error('Imagem não vinculada a este rascunho.');
  const indexFileId = assets[input.indexFileId]?.mimeType === 'application/gzip' ? input.indexFileId : '';
  return { ...input, sections, assets, indexFileId, reviewed: sections.length > 0 && sections.every((s) => s.reviewed) };
}
export function publishedAssets(guide) {
  const ids = new Set([guide.indexFileId, ...guide.sections.map((s) => s.imageId)].filter(Boolean));
  return Object.fromEntries(Object.entries(guide.assets).filter(([id]) => ids.has(id)));
}
export function parseGuide(record) {
  if (!record) return null;
  return cleanGuide({ ...record, sections: JSON.parse(record.content || '[]') });
}
export function searchRules(index, guide, query, { currentHash } = {}) {
  const phrase = normalizeText(query),
    words = phrase.split(' ').filter(Boolean);
  if (!phrase) return [];
  const candidates = [];
  for (const s of guide?.sections || []) candidates.push({ title: s.title, text: s.text, page: guide.sourceHash === currentHash ? s.page : null, sectionId: s.id, source: 'Guia revisado' });
  if (index?.sourceHash === currentHash)
    for (const p of index.pages || []) {
      const heading = (index.headings || []).filter((h) => h.page <= p.page).at(-1);
      for (const paragraph of p.text.split(/\n\s*\n|\n/)) if (paragraph.trim()) candidates.push({ title: heading?.title || `Página ${p.page}`, text: paragraph.trim(), page: p.page, source: 'Trecho do PDF' });
    }
  const seen = new Set();
  return candidates
    .map((c) => {
      const title = normalizeText(c.title),
        text = normalizeText(c.text),
        matches = words.filter((w) => text.includes(w) || title.includes(w));
      return { ...c, score: matches.length === words.length ? 10 + (text.includes(phrase) ? 8 : 0) + (title.includes(phrase) ? 20 : 0) + (c.sectionId ? 2 : 0) : 0 };
    })
    .filter((c) => c.score && !seen.has(`${c.page}:${c.text}`) && seen.add(`${c.page}:${c.text}`))
    .sort((a, b) => b.score - a.score || (a.page || Infinity) - (b.page || Infinity))
    .slice(0, 60);
}
export function ruleCategory(title) {
  const t = normalizeText(title);
  for (const [label, pattern] of [
    ['Objetivo', /objetivo|overview|object of/],
    ['Preparação', /preparacao|setup|preparation/],
    ['Componentes', /componentes|components|conteudo/],
    ['Turnos', /turno|turn|round|rodada/],
    ['Ações', /acoes|actions/],
    ['Combate', /combate|combat|attack|ataque/],
    ['Pontuação e vitória', /pontuacao|vitoria|derrota|scoring|victory|game end|fim de jogo/],
    ['Dúvidas frequentes', /perguntas|faq|questions/],
  ])
    if (pattern.test(t)) return label;
  return '';
}
