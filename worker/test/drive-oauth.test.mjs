import test from 'node:test';
import assert from 'node:assert/strict';
import { createDriveTokenProvider, driveMetadata } from '../src/services.js';
import { driveResponseError } from '../src/drive-errors.js';
import { DRIVE_FOLDER_ID } from '../../js/permissions.js';
const env = { GOOGLE_CLIENT_ID: 'fixture-client', GOOGLE_CLIENT_SECRET: 'fixture-secret', GOOGLE_REFRESH_TOKEN: 'fixture-refresh', DRIVE_FOLDER_ID, DRIVE_OWNER_EMAIL: 'owner@example.test' };

for (const [status, provider, code] of [
  [400, 'invalid_grant', 'drive/oauth-expired'],
  [401, 'invalid_client', 'drive/oauth-client'],
  [400, 'invalid_scope', 'drive/oauth-client'],
  [400, 'admin_policy_enforced', 'drive/permission'],
  [503, 'backend_error', 'drive/unavailable'],
  [429, 'rate_limited', 'drive/rate-limit'],
]) {
  test(`OAuth ${provider}: diagnóstico seguro, uma tentativa e pausa compartilhada`, async () => {
    let calls = 0,
      clock = 1000;
    const token = createDriveTokenProvider({ now: () => clock });
    const fetcher = async () => {
      calls++;
      return Response.json({ error: provider, error_description: 'fixture-secret fixture-refresh private-detail' }, { status });
    };
    for (const result of await Promise.allSettled(Array.from({ length: 12 }, () => token(env, fetcher)))) {
      assert.equal(result.status, 'rejected');
      assert.equal(result.reason.code, code);
      assert.equal(result.reason.status, 503);
      assert.doesNotMatch(result.reason.message, /fixture-|private-detail/);
    }
    assert.equal(calls, 1);
    await assert.rejects(token(env, fetcher), { code });
    assert.equal(calls, 1);
    clock += 61000;
    assert.equal(
      await token(env, async () => {
        calls++;
        return Response.json({ access_token: 'fixture-access', expires_in: 3600 });
      }),
      'fixture-access',
    );
    assert.equal(calls, 2);
    assert.equal(await token(env, () => assert.fail('deve reutilizar token válido')), 'fixture-access');
  });
}
test('nova autorização remove falha em cache imediatamente; nunca reutiliza token de outro cliente', async () => {
  const token = createDriveTokenProvider();
  await assert.rejects(
    token(env, async () => Response.json({ error: 'invalid_grant' }, { status: 400 })),
    { code: 'drive/oauth-expired' },
  );
  const reconnected = { ...env, GOOGLE_REFRESH_TOKEN: 'fixture-new-refresh' };
  assert.equal(await token(reconnected, async () => Response.json({ access_token: 'new-access' })), 'new-access');
  assert.equal(await token({ ...reconnected, GOOGLE_CLIENT_ID: 'other-client' }, async () => Response.json({ access_token: 'other-access' })), 'other-access');
});
test('rede, timeout e resposta inválida são indisponibilidade, não expiração confirmada', async () => {
  for (const fetcher of [
    async () => {
      throw new TypeError('private-detail');
    },
    async () => new Response('invalid', { status: 200 }),
    async () => Response.json({}),
  ]) {
    await assert.rejects(createDriveTokenProvider()(env, fetcher), (e) => e.code === 'drive/unavailable' && !e.message.includes('private-detail'));
  }
});
test('configuração incompleta ou outra pasta é rejeitada antes da rede', async () => {
  for (const config of [
    { ...env, GOOGLE_REFRESH_TOKEN: '' },
    { ...env, DRIVE_FOLDER_ID: 'other-folder' },
  ])
    await assert.rejects(
      createDriveTokenProvider()(config, () => assert.fail('não consultar')),
      { code: 'drive/configuration' },
    );
});
test('Drive distingue permissão, quota, arquivo ausente e erro temporário sem vazar corpo', async () => {
  for (const [status, reason, code] of [
    [403, 'insufficientFilePermissions', 'drive/file-permission'],
    [403, 'rateLimitExceeded', 'drive/rate-limit'],
    [404, 'notFound', 'drive/file-missing'],
    [503, 'backendError', 'drive/unavailable'],
    [401, 'authError', 'drive/oauth-rejected'],
    [403, 'accessNotConfigured', 'drive/configuration'],
  ]) {
    const error = await driveResponseError(Response.json({ error: { message: 'fixture-secret', errors: [{ reason }] } }, { status }));
    assert.equal(error.code, code);
    assert.doesNotMatch(error.message, /fixture-secret/);
  }
});
