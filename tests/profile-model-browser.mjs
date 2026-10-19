import '../scripts/test-guard.mjs';
process.env.ACERVO_TEST_MODEL_PROFILE = '1';
await import('./combined-profile-browser.mjs');
