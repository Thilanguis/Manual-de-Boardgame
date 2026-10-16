// Executado antes de qualquer suíte npm. Testes não são um modo de integração real.
for (const name of ['GCLOUD_PROJECT', 'GOOGLE_CLOUD_PROJECT', 'FIREBASE_PROJECT_ID']) {
  if (process.env[name] && process.env[name] !== 'demo-acervo') throw new Error(`Teste bloqueado: ${name} deve ser demo-acervo.`);
}
for (const name of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST']) {
  if (process.env[name] && !/^(127\.0\.0\.1|localhost):\d+$/.test(process.env[name])) throw new Error(`Teste bloqueado: ${name} deve apontar para loopback.`);
}
for (const name of ['ACERVO_TEST_URL', 'ACERVO_TEST_API'])
  if (process.env[name]) {
    const url = new URL(process.env[name]);
    if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname)) throw new Error(`Teste bloqueado: ${name} externo.`);
  }
if (process.env.FIREBASE_CONFIG) {
  const config = JSON.parse(process.env.FIREBASE_CONFIG);
  if (config.projectId && config.projectId !== 'demo-acervo') throw new Error('Teste bloqueado: FIREBASE_CONFIG de produção.');
}
const nativeFetch = globalThis.fetch;
globalThis.fetch = (input, options) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new Error(`Teste bloqueado: requisição externa para ${url.origin}.`);
  return nativeFetch(input, options);
};
