import { normalizeText } from './model.js';
import { documentName } from './documents.js';
import { searchRules, staleSection } from './guide-model.js';
import { searchKnowledge, rankRuleResults } from './rule-relevance.js';
import { translatedValue } from './translation.js';
import { textQuality } from './text-quality.js';

// Os assuntos são endereços de conteúdo existente, nunca categorias inventadas
// nem consultas pelo nome genérico do tópico atribuído à seção pela IA.
export function ruleTopics({ indexes = [], guide, knowledge, documents = [] }) {
  const topics = new Map();
  function add(title, target, source) {
    title = String(title || '')
      .trim()
      .replace(/^[•+*–—\s]+|[•+*–—\s]+$/g, '');
    if (target.kind === 'pdf') {
      title = title.replace(/\s*[—–]{2,}.*$/, '').trim();
      if ((title.includes('(') && !title.includes(')')) || (title.includes(')') && !title.includes('('))) return;
      // Small caps de alguns PDFs são extraídas como "MoViMentação".
      // Apenas o rótulo de navegação é regularizado; a evidência fica intacta.
      if (/\p{Ll}\p{Lu}/u.test(title)) title = title.charAt(0).toLocaleUpperCase('pt-BR') + title.slice(1).toLocaleLowerCase('pt-BR');
    }
    const key = normalizeText(title);
    if (!/\p{L}/u.test(title) || title.length > 160 || textQuality(title).corrupt || /^(?:pagina|page) \d+$/.test(key)) return;
    if (target.kind === 'pdf' && (/^\d|[,;]|[.!?]$/.test(title) || /livro de regras|rulebook/i.test(title) || title.split(/\s+/).length > 13)) return;
    if (!topics.has(key)) topics.set(key, { id: key, title, targets: [], sources: [] });
    const topic = topics.get(key);
    topic.targets.push({ ...target, displayTitle: title, source });
    if (!topic.sources.includes(source)) topic.sources.push(source);
  }
  for (const section of knowledge?.sections || []) {
    if (section.topic === 'visao-geral' || section.review === 'rejected' || !section.text?.trim()) continue;
    const source = knowledge.sources.find((s) => s.id === section.sourceId);
    if (!source || source.profileOnly) continue;
    const origin = source.pages ? (section.review === 'manual' || section.review === 'accepted' ? 'Explicação revisada' : 'Gemini · manual') : 'Fonte pública';
    add(section.title, { kind: 'knowledge', section }, origin + (section.page ? ` · p. ${section.page}` : ''));
  }
  for (const section of guide?.sections || []) {
    const game = { documents: Object.fromEntries(documents.map((d) => [d.id, d])) };
    if (!section.text?.trim() || staleSection(game, section, guide.sourceHash)) continue;
    add(section.title, { kind: 'guide', section }, 'Guia revisado' + (section.page ? ` · p. ${section.page}` : ''));
  }
  for (const { document, index } of indexes) {
    if (index.sourceHash !== document.manual.sha256) continue;
    const seen = new Set();
    const headings = [...(index.headings || []), ...index.pages.flatMap((p) => (p.searchLayout?.readingHeadings || []).map((title) => ({ title, page: p.page })))];
    for (const heading of headings) {
      const page = index.pages.find((p) => p.page === heading.page);
      if (heading.printedPage || !page?.text?.trim() || /sum.rio|contents|index|cr.ditos|credits/i.test(heading.title)) continue;
      const title = translatedValue(heading.translation, heading.title) || heading.title;
      const key = `${page.page}:${normalizeText(title)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      add(title, { kind: 'pdf', heading, document, index, page }, `PDF · p. ${page.page}`);
    }
  }
  // Um atalho só é oferecido quando seu destino pode ser aberto. Categorias,
  // rodapés ou cabeçalhos sem um trecho utilizável não viram botões vazios.
  const context = { indexes, guide, knowledge, documents };
  return [...topics.values()]
    .map((topic) => {
      const targets = topic.targets.filter((target) => targetResults(context, target).length);
      return { ...topic, targets, sources: [...new Set(targets.map((target) => target.source))] };
    })
    .filter((topic) => topic.targets.length);
}

function targetResults(context, target) {
  if (target.kind === 'knowledge') {
    return searchKnowledge({ ...context.knowledge, sections: [target.section] }, target.section.title);
  } else if (target.kind === 'guide') {
    return searchRules(null, { ...context.guide, sections: [target.section] }, target.section.title, { currentHash: target.section.sourceHash || context.guide.sourceHash }).map((result) => ({
      ...result,
      documentId: target.section.documentId || 'main',
      sourceHash: target.section.sourceHash || context.guide.sourceHash,
    }));
  } else {
    const { index, document, page } = target;
    const pageIndex = { ...index, language: document.language && document.language !== 'other' ? document.language : index.language, pages: [page] };
    const query = translatedValue(page.translation, page.text) ? translatedValue(target.heading.translation, target.heading.title) || target.heading.title : target.heading.title;
    const key = normalizeText(target.displayTitle);
    const results = searchRules(pageIndex, null, query, { currentHash: document.manual.sha256 })
      .filter((result) => ` ${normalizeText(result.searchTitle || result.title)} `.includes(` ${key} `))
      .map((result) => ({ ...result, title: target.displayTitle, documentId: document.id, documentName: documentName(document), sourceHash: index.sourceHash }));
    if (results.length < 2) return results;
    // O mesmo assunto pode ter sido dividido em passagens menores pelo índice.
    // Abre um cartão por assunto/página, mantendo a ordem e os textos completos.
    const ordered = rankRuleResults(results).sort((a, b) => a.passageStart - b.passageStart);
    const join = (field) => [...new Set(ordered.map((result) => result[field]).filter(Boolean))].join('\n\n');
    const withSubheadings = (field) =>
      ordered
        .map((result) => {
          const text = result[field];
          if (!text) return '';
          const subtitle = result.searchTitle?.split(' · ').at(-1);
          return subtitle && normalizeText(subtitle) !== key ? `${subtitle}\n\n${text}` : text;
        })
        .filter(Boolean)
        .join('\n\n');
    return [
      {
        ...ordered[0],
        text: withSubheadings('text'),
        readingText: withSubheadings('readingText'),
        searchText: join('searchText'),
        originalText: join('originalText'),
        readingHeadings: [...new Set(ordered.flatMap((result) => result.readingHeadings || []))],
        passageEnd: ordered.at(-1).passageEnd,
        score: Math.max(...ordered.map((result) => result.score)),
      },
    ];
  }
}

export function ruleTopicResults(context, id) {
  const topic = ruleTopics(context).find((topic) => topic.id === id);
  return topic ? rankRuleResults(topic.targets.flatMap((target) => targetResults(context, target))) : [];
}
