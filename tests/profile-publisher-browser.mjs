import '../scripts/test-guard.mjs';

// Mesmo cadastro, editor, leitor e repositório do teste completo. Apenas as
// respostas externas mudam: sem Wikimedia e sem tokens BGG/Ludopedia; a ficha
// factual da editora completa a duração mesmo com metadata Gemini omitindo-a.
process.env.ACERVO_TEST_PUBLISHER = '1';
await import('./combined-profile-browser.mjs');
