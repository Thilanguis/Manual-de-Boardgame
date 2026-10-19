// Não mede idioma, vocabulário ou alfabeto: mede defeitos da extração.
const invalidGlyph = /[\uFFFD\u25A1\u25AF\u25FB\uE000-\uF8FF\u{F0000}-\u{FFFFD}\u{100000}-\u{10FFFD}\u0000-\u0008\u000B\u000C\u000E-\u001F]/gu;
export function textQuality(value) {
  const text = String(value || ''),
    visible = [...text.replace(/\s/g, '')].length;
  const invalid = [...text.matchAll(invalidGlyph)].length + [...text.matchAll(/\(cid:\d+\)/g)].length * 3;
  const ratio = invalid / Math.max(1, visible);
  const corrupt = (invalid >= 3 && ratio >= 0.015) || (invalid > 0 && ratio >= 0.08) || /[\uFFFD\u25A1\u25AF\u25FB\uE000-\uF8FF]{6}/u.test(text);
  const letters = (text.match(/[\p{L}\p{N}]/gu) || []).length;
  return { version: 1, characters: text.trim().length, invalid, ratio, corrupt, readable: !corrupt && text.trim().length >= 40 && letters >= 12 };
}
export const readablePage = (page) => {
  const quality = textQuality(page?.text);
  if (quality.readable) return true;
  // Uma capa pode conter apenas estes rótulos; não exige 40 caracteres para
  // aceitar números acompanhados explicitamente de contexto verificável.
  return (
    !quality.corrupt &&
    quality.characters >= 8 &&
    quality.characters <= 160 &&
    String(page?.text)
      .trim()
      .split(/\n+/)
      .every((line) => /^(?:(?:idades?|ages?|âge)\s*:?\s*\d{1,2}\s*(?:\+|anos|years|ans)?|\d{1,2}\s*[-–aà]\s*\d{1,2}\s*(?:jogadores|players|joueurs))\s*$/i.test(line.trim()))
  );
};
