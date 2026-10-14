// Configuração WEB pública do NOVO projeto. Nunca use conta de serviço ou token BGG aqui.
export const APP_CONFIG = {
  firebase: {
    apiKey: 'AIzaSyAldLivHy0rW_G0Y_j3CMbTeRRwgPCn_6s',
    authDomain: 'manual-de-boardgame.firebaseapp.com',
    projectId: 'manual-de-boardgame',
    storageBucket: 'manual-de-boardgame.firebasestorage.app',
    messagingSenderId: '548436978015',
    appId: '1:548436978015:web:c655b25caf71162154aeea',
    measurementId: 'G-DJHH1JRPV7',
  },
  // Exemplo: { apiKey: '...', authDomain: '...', projectId: '...', storageBucket: '...', messagingSenderId: '...', appId: '...' }
  // Somente endereço público da API. Nenhuma credencial OAuth aqui.
  fileStorage: { provider: 'drive', apiBase: '' },
  bggEndpoint: '',
  enableBgg: false,
  allowPasswordLogin: true,
  maxPdfBytes: 50 * 1024 * 1024,
};
