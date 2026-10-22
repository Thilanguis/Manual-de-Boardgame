import { normalizeText } from './model.js';

const listStart = /^(?:[•●▪◦*–—-]\s+|\d{1,2}[.)]\s+|[A-Z][.)]\s+)/;
const headingKey = (value) => {
  const words = normalizeText(value).split(' ');
  // Alguns PDFs repetem o mesmo título em duas camadas gráficas.
  if (words.length % 2 === 0 && words.slice(0, words.length / 2).join(' ') === words.slice(words.length / 2).join(' ')) return words.slice(0, words.length / 2).join(' ');
  return words.join(' ');
};
export function passageHeading(line, known = []) {
  const raw = line.trim(),
    key = headingKey(raw);
  if (!key || key.replaceAll(' ', '').length < 4 || raw.length > 110 || key.split(' ').length > 13 || /^\d|[.…]{2,}|[,;]$/.test(raw) || !/[a-zà-ÿ]/i.test(raw)) return null;
  const match = known.find((h) => !h.printedPage && !/sum.rio/i.test(h.source || '') && headingKey(h.title) === key);
  const caps = raw === raw.toLocaleUpperCase() && /[A-ZÀ-Ý]/.test(raw) && key.split(' ').length <= 10;
  if (!caps && /^(?:atacar|mover|coletar|trocar|usar item)$/.test(key) && match && match.title === match.title.toLocaleUpperCase()) return null;
  if (!caps && (/[.,;]/.test(raw.replace(/^[A-Z]\.\s*/, '')) || /^[a-zà-ÿ]/.test(raw))) return null;
  if (!caps && /^(?:de|da|do|dos|das|para|que|e|ou|se|quando|apos|antes|com|um|uma|o|a|os|as|descarte|faca)\b/.test(key)) return null;
  const named =
    /^(?:[a-z] )?(?:visao geral|objetivo|prepara|preparando|componentes|detalhamento dos componentes|conteudo|turnos?|estrutura do turno|fim d|condicoes|existem.*condicoes|custos|custo|cartas|acoes|movimento|combate|ataque|vitoria|pontuacao|setup|preparation|mise en place|components|composants|materiel|turn sequence|game turn|actions|combat|scoring|victory|game end|fin de partie|conditions de victoire)(?:\b|$)/.test(
      key,
    );
  if (!caps && !(match && (key.split(' ').length <= 7 || named)) && !(named && key.split(' ').length <= 6 && !/[.!?]$/.test(raw))) return null;
  if (/[.!?]$/.test(raw) && !caps) return null;
  const top =
    /^(?:visao geral (?:e objetivo|do capitulo)|componentes|conteudo|preparacao|custos de cartas e pecas|efeitos de cartas e pecas|demanda do anel|aliancas dos povos|conquistando a terra media|fim da partida|turnos?|game turn|acoes|actions|movimentacao|movimento|movement|combate|combat|atacar|ataque|pontuacao|vitoria|each round begins with|game round|turn sequence|creditos|credits|setup|components|composants|overview)$/.test(
      key,
    );
  const label = match?.title || raw,
    words = label.trim().split(/\s+/);
  const displayTitle = headingKey(label).split(' ').length < normalizeText(label).split(' ').length ? words.slice(0, words.length / 2).join(' ') : label;
  return { title: displayTitle, key, top: top && (caps || ['componentes', 'preparacao', 'components', 'composants', 'setup'].includes(key)), category: match?.category || '' };
}

// Projeção de apresentação. O texto do índice e as citações nunca são alterados.
export const readingPunctuation = (text) => text.replace(/[\t ]+([,.;:!?\)\]\}])/g, '$1').replace(/([\(\[\{])[\t ]+/g, '$1');
export function cleanRuleText(value) {
  const lines = String(value || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/\u00ad\s*\n\s*/g, '')
    .replace(/\u00ad/g, '')
    .split('\n');
  const blocks = [];
  let paragraph = '';
  const flush = () => {
    if (paragraph) blocks.push(paragraph);
    paragraph = '';
  };
  for (const raw of lines) {
    const line = readingPunctuation(raw.trim().replace(/[\t ]+/g, ' '));
    if (!line) {
      flush();
      continue;
    }
    if (listStart.test(line) || /^\d{1,2}$/.test(line) || /[×]\s*\d/.test(line)) {
      flush();
      blocks.push(line);
      continue;
    }
    if (paragraph && (/[.!?:]$/.test(paragraph) || passageHeading(line))) flush();
    paragraph += paragraph ? (/-$/.test(paragraph) ? '' : ' ') + line : line;
  }
  flush();
  return blocks.join('\n\n');
}

export function splitPassages(text, headings = [], page = 0) {
  const raw = String(text || ''),
    lines = raw.split('\n');
  const sections = [];
  let offset = 0,
    start = 0,
    title = '',
    parent = '';
  function push(end) {
    let original = raw.slice(start, end).trim();
    // Somente o número físico isolado no rodapé; quantidades do corpo permanecem.
    original = original.replace(new RegExp(`\\n\\s*${page}\\s*$`), '').trim();
    if (!original || !/[a-zà-ÿ]/i.test(original)) return;
    const boundaries = [0];
    if (original.length > 1500) {
      // Agrupa parágrafos/frases, nunca uma janela fixa de caracteres.
      for (const match of original.matchAll(/(?:[.!?](?:[”"')]+)?(?=\s+[A-ZÀ-Ý])|\n\s*\n)/g)) {
        const at = match.index + match[0].length;
        if (at - boundaries.at(-1) >= 650) boundaries.push(at);
      }
    }
    boundaries.push(original.length);
    for (let i = 0; i < boundaries.length - 1; i++) {
      const part = original.slice(boundaries[i], boundaries[i + 1]).trim();
      if (!/[a-zà-ÿ]/i.test(part)) continue;
      sections.push({ title: title || `Página ${page}`, searchTitle: [...new Set([parent, title].filter(Boolean))].join(' · '), text: cleanRuleText(part), originalText: part, page, start: start + boundaries[i], end: start + boundaries[i + 1] });
    }
  }
  const events = [];
  for (const line of lines) {
    const heading = passageHeading(line, headings);
    if (heading) {
      events.push({ at: offset, after: offset + line.length + 1, heading });
    } else {
      // Índices antigos podem misturar colunas na mesma linha. Recupera apenas
      // cabeçalhos tipográficos inequívocos; não reorganiza nem reescreve regras.
      for (const match of line.matchAll(/[A-ZÀ-Ý][A-ZÀ-Ý \t/–-]{3,}/g)) {
        let label = match[0].trimEnd();
        if (/[a-zà-ÿ]/.test(line[match.index + match[0].length] || '')) label = label.replace(/(?:[ \t-]+)[A-ZÀ-Ý]$/, '').trimEnd();
        label = label.replace(/[ \t–-]+$/, '');
        const key = headingKey(label);
        if (!/^(?:turno|turnos|movimenta|mover|atacar|ataque|combat|preparacao|preparando|componentes|custos|condicoes|player phase|game overview|setup|move|movement|combat actions|winning|fim da partida)/.test(key)) continue;
        const inline = passageHeading(label, headings);
        if (inline) events.push({ at: offset + match.index, after: offset + match.index + label.length, heading: inline });
      }
    }
    offset += line.length + 1;
  }
  const primaryEvents = events.filter((e) => e.heading.top).sort((a, b) => a.at - b.at);
  for (let i = 0; i < primaryEvents.length; i++) {
    const event = primaryEvents[i];
    if (!/^(?:componentes|components|composants)$/.test(event.heading.key)) continue;
    const section = raw.slice(event.after, primaryEvents[i + 1]?.at || raw.length);
    const inventory = section.match(/^\d+(?:x)?\s+(?:Tabuleiros?|Cartas?|Miniaturas?|Peças?|Fichas?|Marcador|Dados|Aros|Tokens?|Cards?|Tiles?|Boards?)\b/im);
    if (inventory && inventory.index > 150) {
      const at = event.after + inventory.index;
      events.push({ at, after: at, heading: { title: 'Lista de componentes', key: 'componentes', top: false } });
    }
  }
  for (const event of events.sort((a, b) => a.at - b.at)) {
    push(event.at);
    if (event.heading.top) parent = event.heading.title;
    title = event.heading.title;
    start = event.after;
  }
  push(raw.length);
  return sections;
}

// Prévia por frases/parágrafos completos, sem slice no meio de uma palavra.
// Em seções extensas, a janela começa na passagem que responde à consulta.
export function contextualExcerpt(value, query = '', limit = 480) {
  const text = cleanRuleText(value);
  const units = text.split(/\n\s*\n/).flatMap((paragraph) => {
    const protectedText = paragraph.replace(/\b(pág|pag|p|ex|fig|sr|dr)\.(?=\s)/gi, '$1').replace(/^(\d{1,2}|[A-Z])\.(?=\s)/, '$1');
    return protectedText
      .split(/(?<=[.!?])\s+(?=[A-ZÀ-Ý])/)
      .map((s) => s.replaceAll('', '.').trim())
      .filter(Boolean);
  });
  const words = Array.isArray(query)
    ? query
    : normalizeText(query)
        .split(' ')
        .filter((w) => w.length > 2);
  let at = units.findIndex((unit) => words.some((w) => normalizeText(unit).split(' ').includes(w)));
  if (at === 1 && /^[A-ZÀ-Ý]/.test(units[0]) && units[0].length < 300 && /[.!?]$/.test(units[0])) at = 0;
  if (at < 0) at = units.findIndex((unit) => /[a-zà-ÿ]{3}/i.test(unit) && unit.length > 25);
  if (at < 0) at = 0;
  if (/^\d+(?:\s+\d+)*\s*(?:\n|$)/.test(text)) {
    const instructionPattern = /\b(?:Escolha|Coloque|Separe|Monte|Distribua|Embaralhe|Choose|Place|Shuffle|Choisissez|Placez)\b/;
    const instructionAt = units.findIndex((unit, i) => i < 12 && instructionPattern.test(unit));
    if (instructionAt >= 0) {
      at = instructionAt;
      units[at] = units[at].slice(units[at].search(instructionPattern));
    }
  }
  let excerpt = '';
  for (let i = at; i < units.length; i++) {
    const next = units[i];
    if (/^\d+(?:\s+\d+)*$/.test(next)) continue;
    if (excerpt && excerpt.length + next.length > limit) break;
    // Uma frase enorme não é cortada: fica na expansão com aviso explícito.
    if (next.length > limit * 2) break;
    excerpt += (excerpt ? '\n\n' : '') + next;
    if (excerpt.length >= limit) break;
  }
  return { preview: excerpt || 'Consulte o trecho completo e a página do manual.', hasMore: excerpt !== text, text };
}

const tokens = (text) =>
  new Set(
    normalizeText(text)
      .split(' ')
      .filter((w) => w.length > 2),
  );
export function duplicatePassage(a, b) {
  if (a.sourceHash && b.sourceHash && a.sourceHash !== b.sourceHash) return false;
  const x = normalizeText(a.text || a.searchText || a.originalText),
    y = normalizeText(b.text || b.searchText || b.originalText);
  if (x === y && x) return true;
  // Não confundir alteração de quantidade, custo, negação ou condição com cópia.
  const qualifiers = (s) => (s.match(/\b(?:\d+|nao|nunca|exceto|apenas|somente|not|never|only|unless|ne|pas|sauf)\b/g) || []).sort().join('|');
  if (qualifiers(x) !== qualifiers(y) || Math.min(x.length, y.length) < 90) return false;
  const left = tokens(x),
    right = tokens(y);
  const intersection = [...left].filter((w) => right.has(w)).length;
  const shingles = (s) => {
    const words = s.split(' ');
    return new Set(words.slice(0, -2).map((_, i) => words.slice(i, i + 3).join(' ')));
  };
  const ax = shingles(x),
    bx = shingles(y),
    overlap = [...ax].filter((s) => bx.has(s)).length;
  return intersection / new Set([...left, ...right]).size > 0.9 && overlap / Math.min(ax.size, bx.size) > 0.85;
}
