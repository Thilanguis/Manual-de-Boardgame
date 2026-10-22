import { passageHeading, readingPunctuation } from './rule-passages.js';
import { textQuality } from './text-quality.js';
import { normalizeText } from './model.js';

// Projeção descartável de leitura: nunca substitui texto, citações ou índice.
export function readingBlocks(value, { headings = [] } = {}) {
  const source = String(value || '');
  if (textQuality(source).corrupt) return [{ type: 'notice', text: 'Este trecho contém caracteres ilegíveis. Confira a página original do PDF.' }];
  const lines = source
    .replace(/\r\n?/g, '\n')
    .replace(/\u00ad\s*\n\s*/g, '')
    .replace(/\u00ad/g, '')
    .split('\n');
  const blocks = [];
  const confirmedTitles = new Set(headings.map((h) => normalizeText(typeof h === 'string' ? h : h.title)));
  let pending = '',
    pendingType = 'paragraph',
    list = null;
  const flush = () => {
    if (pending) {
      const sentences = pending.split(/(?<=[.!?])\s+(?=[A-ZÀ-Ý])/u);
      let paragraph = '';
      for (const sentence of sentences) {
        if (paragraph.length > 550 && pendingType === 'paragraph') {
          blocks.push({ type: pendingType, text: paragraph.trim() });
          paragraph = '';
        }
        paragraph += (paragraph ? ' ' : '') + sentence;
      }
      if (paragraph.trim()) blocks.push({ type: pendingType, text: paragraph.trim() });
    }
    pending = '';
    pendingType = 'paragraph';
  };
  const numbered = (line) => /^\s*(\d{1,2})[.)]\s+(.+)$/.exec(line);
  for (let i = 0; i < lines.length; i++) {
    const line = readingPunctuation(lines[i].trim());
    if (!line) {
      flush();
      const next = lines.slice(i + 1).find((s) => s.trim()) || '';
      if (!(list && (list.ordered ? Number(numbered(next)?.[1]) === list.last + 1 : /^[•●▪◦*–—-]\s+/.test(next.trim())))) list = null;
      continue;
    }
    // Tabulações e separadores inequívocos são preservados como tabela literal.
    if (/\|.*\|/.test(line) || /\S\t+\S/.test(lines[i])) {
      flush();
      list = null;
      const rows = [];
      while (i < lines.length && (/\|.*\|/.test(lines[i]) || /\S\t+\S/.test(lines[i]))) rows.push(lines[i++]);
      i--;
      blocks.push({ type: 'table', text: rows.join('\n') });
      continue;
    }
    const markdown = /^(#{1,4})\s+(.+?)\s*#*$/.exec(line);
    const heading = passageHeading(line);
    const confirmedHeading = !/[.!?,;:]$/.test(line) && line.length <= 110 && confirmedTitles.has(normalizeText(line));
    if (markdown || heading || confirmedHeading) {
      flush();
      list = null;
      blocks.push({ type: 'heading', text: markdown ? markdown[2] : heading?.title || line });
      continue;
    }
    const number = numbered(line);
    if (number && passageHeading(number[2])) {
      flush();
      list = null;
      blocks.push({ type: 'heading', text: line });
      continue;
    }
    const next = lines.slice(i + 1, i + 5).find((s) => s.trim());
    const nextNumber = next && numbered(next);
    const ordered = number && !passageHeading(number[2]) && ((list?.ordered && Number(number[1]) === list.last + 1) || (nextNumber && Number(nextNumber[1]) === Number(number[1]) + 1));
    const bullet = /^[•●▪◦*–—-]\s+(.+)$/.exec(line);
    if (bullet || ordered) {
      flush();
      if (!list || list.ordered !== !!ordered) {
        list = { type: 'list', ordered: !!ordered, start: ordered ? Number(number[1]) : 1, last: 0, items: [] };
        blocks.push(list);
      }
      list.items.push(bullet ? bullet[1] : number[2]);
      if (ordered) list.last = Number(number[1]);
      continue;
    }
    const callout = /^(exce[cç][aã]o|aten[cç][aã]o|importante|aviso|nota|exception|attention|important|note|exemplo|example|exemple)\s*[:—–-]\s*/i.exec(line);
    if (callout) {
      flush();
      list = null;
      pendingType = /^exempl|^example/i.test(callout[1]) ? 'example' : 'notice';
      pending = line;
    } else if (list) {
      list.items[list.items.length - 1] += ' ' + line;
    } else pending += (pending ? ' ' : '') + line;
  }
  flush();
  return blocks;
}
const node = (tag, text) => {
  const element = document.createElement(tag);
  if (text != null) element.textContent = text;
  return element;
};
function inline(target, text) {
  for (const part of text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g)) {
    if (/^\*\*[^*]+\*\*$/.test(part)) target.append(node('strong', part.slice(2, -2)));
    else if (/^\*[^*]+\*$/.test(part)) target.append(node('em', part.slice(1, -1)));
    else target.append(document.createTextNode(part));
  }
}
export function renderRuleReading(target, text, options) {
  for (const block of readingBlocks(text, options)) {
    if (block.type === 'list') {
      const list = node(block.ordered ? 'ol' : 'ul');
      if (block.ordered) list.start = block.start;
      for (const item of block.items) {
        const li = node('li');
        inline(li, item);
        list.append(li);
      }
      target.append(list);
    } else if (block.type === 'table') {
      const figure = node('figure');
      figure.className = 'rule-table-fallback';
      figure.append(node('figcaption', 'Tabela ou disposição espacial: confira a página do PDF para interpretar corretamente.'), node('pre', block.text));
      target.append(figure);
    } else {
      const element = node(block.type === 'heading' ? 'h4' : ['notice', 'example'].includes(block.type) ? 'aside' : 'p');
      if (['notice', 'example'].includes(block.type)) element.className = `rule-${block.type}`;
      inline(element, block.text);
      target.append(element);
    }
  }
}
