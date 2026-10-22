import { extractMetadata } from './recognition.js';
import { textQuality } from './text-quality.js';

// Projeção de leitura: não altera o idioma cadastrado, o índice ou o PDF.
// "Não identificado" não é um idioma estrangeiro. Usa o texto legível da
// própria página para recuperar índices antigos que ficaram com "other".
export function ruleTextLanguage(declared, text) {
  if (!['other', 'unknown', 'und'].includes(declared)) return declared || 'pt-BR';
  if (textQuality(text).corrupt) return 'other';
  return extractMetadata(text).language;
}
