import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeGameDraft, validateGame } from '../js/model.js';

test('aplicação aceita um rascunho incompleto para conferência, mas publicação continua bloqueada', () => {
  const draft = normalizeGameDraft({
    title: 'Jogo',
    description: 'Resumo confirmado',
    minPlayers: '2',
    maxPlayers: '4',
    minDurationMinutes: '45',
    maxDurationMinutes: '',
    tags: 'Aventura, Estratégia',
    mechanics: ['Cooperação'],
    language: 'pt-BR',
    isPublic: 'on',
  });
  assert.equal(draft.description, 'Resumo confirmado');
  assert.equal(draft.minDurationMinutes, 45);
  assert.equal(draft.maxDurationMinutes, null);
  assert.equal(draft.durationMinutes, null);
  assert.deepEqual(draft.tags, ['Aventura', 'Estratégia']);
  assert.deepEqual(draft.mechanics, ['Cooperação']);
  assert.throws(() => validateGame(draft), /duração mínima e máxima/);
  assert.equal(validateGame({ ...draft, maxDurationMinutes: 60 }).maxDurationMinutes, 60);
});
