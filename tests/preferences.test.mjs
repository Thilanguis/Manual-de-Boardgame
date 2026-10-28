import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanPreferences, preferenceType, preservePreference } from '../js/preferences.js';
test('somente preferências identificadas por conta sobrevivem à limpeza', () => {
  const key = 'acervo:firebase:project:user-a:reading';
  assert.equal(preferenceType(key), 'reading');
  for (const other of ['acervo:firebase:project:device:reading', 'acervo-upload:project:user-a:ticket', 'acervo:firebase:project:user-a:index', 'acervo:reading', 'acervo:firebase:project:user-a:cache']) assert.equal(preferenceType(other), null);
  const data = new Map([[key, JSON.stringify({ 'game:manual': { page: 3, total: 20, lastRead: 123, text: 'conteúdo privado', token: 'secreto' }, bad: { page: -1, total: 20, lastRead: 123 } })]]);
  assert(preservePreference({ getItem: k => data.get(k), setItem: (k, v) => data.set(k, v) }, key));
  assert.deepEqual(JSON.parse(data.get(key)), { 'game:manual': { page: 3, total: 20, lastRead: 123 } });
});
test('favoritos e dispensas retêm somente IDs e valores permitidos', () => {
  assert.deepEqual(cleanPreferences('favorites', ['game-a', 'game-a', { text: 'PDF' }, 'https://private.test/file', 'game:manual']), ['game-a']);
  assert.deepEqual(cleanPreferences('reading-dismissed', { a: true, b: 'texto privado', c: false }), { a: true });
  assert.deepEqual(cleanPreferences('reading', { a: { page: 10, total: 2, lastRead: 0 } }), {});
  assert.deepEqual(cleanPreferences('reading', null), {});
  assert.deepEqual(cleanPreferences('favorites', null), []);
});
