import test from 'node:test';
import assert from 'node:assert/strict';
import { fileErrorMessage } from '../js/file-errors.js';
test('leitura distingue sessão, acesso, ausência, conflito, backend antigo e rede', () => {
  for (const [status, expected] of [
    [401, /sessão expirou/],
    [403, /não tem acesso/],
    [404, /não encontrado/],
    [409, /documento mudou/],
    [426, /conexão dos documentos/],
  ])
    assert.match(fileErrorMessage({ status }), expected);
  assert.match(fileErrorMessage(new TypeError('Failed to fetch')), /conexão/);
});
