// Mantém o vínculo entre o texto normalizado e os trechos selecionáveis do PDF.js.
export function pdfSearchText(items) {
  let text = '';
  const positions = [];
  items.forEach((item, index) => {
    for (let offset = 0; offset < item.str.length; ) {
      const char = String.fromCodePoint(item.str.codePointAt(offset));
      const normalized = char.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
      for (const part of normalized.split('')) {
        const value = /\s/u.test(part) ? ' ' : part;
        if (value === ' ' && text.endsWith(' ')) continue;
        text += value;
        positions.push({ item: index, offset, end: offset + char.length });
      }
      offset += char.length;
    }
    if (!text.endsWith(' ')) {
      text += ' ';
      positions.push(null);
    }
  });
  return { text, positions };
}
export function pdfSearchMatches(content, query) {
  const needle = query.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/gu, ' ').trim();
  if (!needle) return [];
  const matches = [];
  for (let start = content.text.indexOf(needle); start !== -1; start = content.text.indexOf(needle, start + needle.length)) {
    const first = content.positions[start],
      last = content.positions[start + needle.length - 1];
    if (first && last) matches.push({ first, last });
  }
  return matches;
}
