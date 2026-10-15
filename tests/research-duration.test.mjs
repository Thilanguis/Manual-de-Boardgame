import test from 'node:test';
import assert from 'node:assert/strict';
import { selectedFields } from '../js/research-client.js';

const duration = (fields) =>
  Object.fromEntries(
    selectedFields({ fields }, {})
      .filter((field) => /DurationMinutes$/.test(field.key))
      .map((field) => [field.key, field.value]),
  );
test('duração fixa encontrada não some quando a resposta traz limites vazios', () => {
  assert.deepEqual(duration({ durationMinutes: 75, minDurationMinutes: null, maxDurationMinutes: null }), { minDurationMinutes: 75, maxDurationMinutes: 75 });
  assert.deepEqual(duration({ durationMinutes: 75, minDurationMinutes: 75, maxDurationMinutes: null }), { minDurationMinutes: 75, maxDurationMinutes: 75 });
  assert.deepEqual(duration({ durationMinutes: '60–150 min', minDurationMinutes: 60, maxDurationMinutes: null }), { minDurationMinutes: 60, maxDurationMinutes: 150 });
});
test('valores explícitos em minutos, horas e intervalos são convertidos para os dois inputs', () => {
  assert.deepEqual(duration({ durationMinutes: '45 min' }), { minDurationMinutes: 45, maxDurationMinutes: 45 });
  assert.deepEqual(duration({ durationMinutes: '60–150 minutos' }), { minDurationMinutes: 60, maxDurationMinutes: 150 });
  assert.deepEqual(duration({ durationMinutes: '1–2 horas' }), { minDurationMinutes: 60, maxDurationMinutes: 120 });
  assert.deepEqual(duration({ durationMinutes: '1 à 2 heures' }), { minDurationMinutes: 60, maxDurationMinutes: 120 });
  assert.deepEqual(duration({ durationMinutes: '45 até 60 minutos' }), { minDurationMinutes: 45, maxDurationMinutes: 60 });
  assert.deepEqual(duration({ durationMinutes: '1h30min' }), { minDurationMinutes: 90, maxDurationMinutes: 90 });
  assert.deepEqual(duration({ durationMinutes: '1,5 horas' }), { minDurationMinutes: 90, maxDurationMinutes: 90 });
});
test('limite isolado não vira duração fixa e intervalo explícito prevalece sobre legado', () => {
  assert.deepEqual(duration({ minDurationMinutes: 45, maxDurationMinutes: null }), { minDurationMinutes: 45 });
  assert.deepEqual(duration({ durationMinutes: 90, minDurationMinutes: 45, maxDurationMinutes: null }), { minDurationMinutes: 45 });
  assert.deepEqual(duration({ minDurationMinutes: 45, maxDurationMinutes: 60, durationMinutes: 90 }), { minDurationMinutes: 45, maxDurationMinutes: 60 });
  for (const value of [0, -1, 1441, '2 h 90 min', 'rápido', '45–30 min', '30 segundos']) assert.deepEqual(duration({ durationMinutes: value }), {});
});
