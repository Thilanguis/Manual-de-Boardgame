// Configuração fictícia. Nenhuma credencial ou endpoint de produção.
export const DEV_OWNER = 'dev-acervo-owner';
export const DEV_CONFIG = {
  development: true,
  ownerUid: DEV_OWNER,
  firebase: { apiKey: 'demo-key', projectId: 'demo-acervo', authDomain: 'demo-acervo.firebaseapp.com', appId: '1:000:web:development' },
  emulators: { auth: 'http://127.0.0.1:9099', host: '127.0.0.1', port: 8080 },
  fileStorage: { provider: 'drive', apiBase: 'http://127.0.0.1:8787' },
  sdkBase: '/__dev/sdk',
  enableGoogleLogin: false,
  enableBgg: false,
  allowPasswordLogin: true,
  maxPdfBytes: 52428800,
};
export const loopback = (hostname) => ['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname);
export function assertIsolatedConfiguration(config, hostname) {
  if (!loopback(hostname)) {
    if (config.emulators || config.development) throw new Error('O ambiente de desenvolvimento só funciona neste computador.');
    return;
  }
  const local = (value) => {
    try {
      const url = new URL(value);
      return url.protocol === 'http:' && loopback(url.hostname);
    } catch {
      return false;
    }
  };
  if (config.firebase?.projectId !== 'demo-acervo' || !local(config.emulators?.auth) || !loopback(config.emulators?.host) || !Number.isInteger(config.emulators?.port) || !local(config.fileStorage?.apiBase))
    throw new Error('Conexão externa bloqueada. Inicie o ambiente isolado com npm run dev.');
}
export async function checkDevelopmentServices(config) {
  if (!config.development) return;
  try {
    await Promise.all(
      [config.emulators.auth, `http://${config.emulators.host}:${config.emulators.port}`, `${config.fileStorage.apiBase}/health`].map(async (url) => {
        const response = await fetch(url, { signal: AbortSignal.timeout(2500), cache: 'no-store' });
        if (url.endsWith('/health')) {
          const health = await response.json();
          if (!response.ok || health.firebaseProject !== 'demo-acervo') throw new Error('Worker local inválido');
        }
      }),
    );
  } catch {
    throw new Error('Ambiente local desconectado. Inicie os serviços com npm run dev e recarregue esta página.');
  }
}
