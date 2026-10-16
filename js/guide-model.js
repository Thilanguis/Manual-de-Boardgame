import { findDocument, gameDocuments } from './documents.js';
import { normalizeText } from './model.js';
import { isPortuguese, translatedValue } from './translation.js';
import { relevance } from './rule-relevance.js';
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
      documentId: /^(main|[a-f0-9-]{36})$/.test(s.documentId || '') ? s.documentId : 'main',
      sourceHash: /^[a-f0-9]{64}$/.test(s.sourceHash || '') ? s.sourceHash : page ? input.sourceHash : '',
      reviewed: s.reviewed === true,
      language: String(s.language || 'pt-BR').slice(0, 20),
      sourceLanguage: String(s.sourceLanguage || '').slice(0, 20),
      originalText: String(s.originalText || '').slice(0, 20000),
      originalTitle: String(s.originalTitle || '').slice(0, 160),
      translationPending: s.translationPending === true,
      translationMethod: String(s.translationMethod || '').slice(0, 80),
      imageId: /^[A-Za-z0-9_-]{6,200}$/.test(s.imageId || '') ? s.imageId : '',
      caption: String(s.caption || '').slice(0, 500),
      source: String(s.source || '').slice(0, 160),
      sourceLicense: String(s.sourceLicense || '').slice(0, 100),
      sourceUrl: /^https:\/\//.test(s.sourceUrl || '') ? String(s.sourceUrl).slice(0, 1000) : '',
      sourceAuthors: /^https:\/\//.test(s.sourceAuthors || '') ? String(s.sourceAuthors).slice(0, 1000) : '',
      sourceLicenseUrl: /^https:\/\//.test(s.sourceLicenseUrl || '') ? String(s.sourceLicenseUrl).slice(0, 1000) : '',
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
  return { ...input, sections, assets, indexFileId, reviewed: sections.length > 0 && sections.every((s) => s.reviewed && !s.translationPending && isPortuguese(s.language)) };
}
export function publishedAssets(guide) {
  const ids = new Set([guide.indexFileId, ...guide.sections.map((s) => s.imageId)].filter(Boolean));
  return Object.fromEntries(Object.entries(guide.assets).filter(([id]) => ids.has(id)));
}
export function checkGuidePages(game, guide) {
  for (const section of guide.sections)
    if (section.page) {
      const doc = findDocument(game, section.documentId || 'main');
      if (doc && (section.sourceHash || guide.sourceHash) === doc.manual.sha256 && section.page > doc.manual.pages) throw new Error('Uma referência ultrapassa o número de páginas do PDF atual. Corrija-a antes de salvar ou publicar.');
    }
  return guide;
}
export function staleSection(game, section, legacyHash) {
  if (!section.page && !section.sourceHash) return false;
  const doc = findDocument(game, section.documentId || 'main');
  return !doc || (section.sourceHash || legacyHash) !== doc.manual.sha256;
}
export function searchDocuments(indexes, guide, query, documents) {
  const result = [];
  for (const entry of indexes || [])
    result.push(...searchRules(entry.index, null, query, { currentHash: entry.document.manual.sha256 }).map((r) => ({ ...r, documentId: entry.document.id, documentName: entry.document.name, sourceHash: entry.index.sourceHash })));
  if (guide)
    for (const section of guide.sections) {
      const doc = documents.find((d) => d.id === (section.documentId || 'main'));
      const valid = doc && (section.sourceHash || guide.sourceHash) === doc.manual.sha256;
      result.push(
        ...searchRules(null, { ...guide, sections: [section] }, query, { currentHash: valid ? guide.sourceHash : '' }).map((r) => ({
          ...r,
          page: valid ? section.page : null,
          documentId: doc?.id,
          documentName: section.page ? doc?.name || 'Documento substituído' : '',
          sourceHash: section.sourceHash || guide.sourceHash,
        })),
      );
    }
  return result.sort((a, b) => b.score - a.score).slice(0, 60);
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
  for (const s of guide?.sections || []) {
    const foreign = !isPortuguese(s.language || 'pt-BR');
    candidates.push({
      title: foreign ? ruleCategory(s.title) || 'Seção do guia' : s.title,
      text: foreign ? '' : s.text,
      originalText: foreign ? s.text : s.originalText || '',
      needsTranslation: foreign,
      page: guide.sourceHash === currentHash ? s.page : null,
      sectionId: s.id,
      source: 'Guia revisado',
      sourceUrl: s.sourceUrl || '',
      sourceLicense: s.sourceLicense || '',
      sourceAuthors: s.sourceAuthors || '',
      sourceLicenseUrl: s.sourceLicenseUrl || '',
      language: s.language || 'pt-BR',
    });
  }
  if (index?.sourceHash === currentHash)
    for (const p of index.pages || []) {
      const headings = (index.headings || []).filter((h) => h.page === p.page),
        heading = headings[0];
      const translated = translatedValue(p.translation, p.text),
        foreign = !isPortuguese(index.language || 'pt-BR');
      candidates.push({
        title: heading ? translatedValue(heading.translation, heading.title) || (foreign ? heading.category : heading.title) || `Página ${p.page}` : `Página ${p.page}`,
        searchTitle: headings.map((h) => `${h.category || ''} ${h.title} ${translatedValue(h.translation, h.title)}`).join(' '),
        text: translated || (foreign ? '' : p.text),
        originalText: p.text,
        page: p.page,
        language: 'pt-BR',
        needsTranslation: foreign && !translated,
        translated: !!translated,
        source: p.method === 'ocr-local' ? 'PDF · OCR; confira a página' : 'Trecho do PDF',
      });
    }
  const seen = new Set();
  return candidates
    .map((c) => {
      const title = normalizeText(`${c.title} ${c.searchTitle || ''}`),
        text = normalizeText(`${c.text} ${c.originalText || ''}`),
        score = relevance(query, title, text);
      return { ...c, score: score ? score + (c.sectionId ? 2 : 0) : 0 };
    })
    .filter((c) => c.score && !seen.has(`${c.page}:${c.text}`) && seen.add(`${c.page}:${c.text}`))
    .sort((a, b) => b.score - a.score || (a.page || Infinity) - (b.page || Infinity))
    .slice(0, 60);
}
export function ruleCategory(title) {
  const t = normalizeText(title);
  for (const [label, pattern] of [
    ['Objetivo', /objetivo|overview|object of|but du jeu|objectif/],
    ['Preparação', /preparacao|preparando|montagem|montando|setup|preparation|mise en place/],
    ['Componentes', /componentes|components|conteudo|composants|materiel|materiais/],
    ['Turnos', /turno|turn|round|rodada|tour de jeu|deroulement/],
    ['Ações', /acoes|actions/],
    ['Regras especiais', /regra especial|regras especiais|special rules|regles speciales/],
    ['Habilidades', /habilidade|abilities|capacites|pouvoirs/],
    ['Combate', /combate|combat|attack|ataque|atacar|batalha|battle|bataille/],
    ['Pontuação e vitória', /pontuacao|vitoria|derrota|scoring|victory|game end|fim de jogo|victoire|defaite|fin de partie|decompte/],
    ['Dúvidas frequentes', /perguntas|faq|questions/],
  ])
    if (pattern.test(t)) return label;
  return '';
}
