import { extractMetadata } from './recognition.js';

// Capas ilustradas podem ter média baixa, mesmo com rótulos numéricos nítidos.
// Só recupera linhas completas nas quais TODAS as palavras têm confiança alta.
export function metadataOcrLines(tsv) {
  const lines = new Map();
  for (const row of String(tsv || '').split('\n')) {
    const cols = row.split('\t');
    if (cols[0] !== '5' || cols.length < 12) continue;
    const confidence = Number(cols[10]),
      text = cols.slice(11).join('\t').trim();
    if (!text) continue;
    const id = cols.slice(1, 5).join(':');
    const line = lines.get(id) || [];
    line.push({ text, confidence });
    lines.set(id, line);
  }
  return [...lines.values()].flatMap((words) => {
    if (words.some((w) => !Number.isFinite(w.confidence) || w.confidence < 85)) return [];
    const text = words.map((w) => w.text).join(' '),
      fields = extractMetadata(text);
    return ['minPlayers', 'maxPlayers', 'recommendedAge', 'minDurationMinutes', 'maxDurationMinutes'].some((k) => fields[k] != null) ? [{ text, confidence: Math.min(...words.map((w) => w.confidence)) }] : [];
  });
}
