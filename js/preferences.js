// Preferências locais guardam somente referências e posições, nunca conteúdo.
const reference = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{1,160}(?::[A-Za-z0-9_-]{1,160})?$/.test(value) && !['__proto__', 'constructor', 'prototype'].includes(value);
export function preferenceType(key) {
  const match = /^acervo:(firebase|local):[^:]+:([^:]+):(favorites|reading|reading-dismissed)$/.exec(key);
  return match && (match[1] === 'local' || match[2] !== 'device') ? match[3] : null;
}
export function cleanPreferences(type, value) {
  if (type === 'favorites') return Array.isArray(value) ? [...new Set(value.filter((id) => reference(id) && !id.includes(':')))] : [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const entries = Object.entries(value).filter(([id]) => reference(id));
  if (type === 'reading-dismissed') return Object.fromEntries(entries.filter(([, dismissed]) => dismissed === true));
  if (type !== 'reading') return {};
  return Object.fromEntries(entries.filter(([, progress]) => progress && Number.isSafeInteger(progress.page) && Number.isSafeInteger(progress.total) && progress.page > 0 && progress.page <= progress.total && Number.isFinite(progress.lastRead) && progress.lastRead >= 0).map(([id, progress]) => [id, { page: progress.page, total: progress.total, lastRead: progress.lastRead }]));
}
export function preservePreference(storage, key) {
  const type = preferenceType(key);
  if (!type) return false;
  try {
    storage.setItem(key, JSON.stringify(cleanPreferences(type, JSON.parse(storage.getItem(key)))));
    return true;
  } catch {
    return false;
  }
}
