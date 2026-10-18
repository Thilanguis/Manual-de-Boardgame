export function setupPwa({ onNotice, isBusy = () => false, onInstallReady }) {
  // No computador de desenvolvimento, os arquivos devem vir do servidor atual.
  // Atualiza um worker antigo para que ele se retire, sem tocar nos dados da conta.
  if (['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) {
    onInstallReady(false);
    if ('serviceWorker' in navigator)
      navigator.serviceWorker.getRegistration(new URL('./', location.href).href).then((registration) => registration?.update()).catch(() => {});
    return async () => false;
  }
  let pendingPrompt = null,
    requested = false,
    reloading = false;
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    pendingPrompt = event;
    onInstallReady(true);
  });
  window.addEventListener('appinstalled', () => {
    pendingPrompt = null;
    onInstallReady(false);
    onNotice('Acervo instalado. Sua próxima partida está a um toque.', null);
  });
  if ('serviceWorker' in navigator && window.isSecureContext) {
    const register = async () => {
      try {
        const registration = await navigator.serviceWorker.register('./service-worker.js', { updateViaCache: 'none' });
        const offerUpdate = (worker, blocked = false) =>
          onNotice(
            blocked ? 'Salve ou cancele a edição em andamento antes de atualizar. Seus dados preenchidos foram preservados.' : 'Uma nova versão do Acervo está pronta.',
            async () => {
              if (isBusy()) {
                offerUpdate(worker, true);
                return;
              }
              requested = true;
              worker.postMessage('skipWaiting');
            },
            'Atualizar',
          );
        if (registration.waiting) offerUpdate(registration.waiting);
        registration.addEventListener('updatefound', () => {
          const worker = registration.installing;
          worker?.addEventListener('statechange', () => {
            if (worker.state === 'installed' && navigator.serviceWorker.controller) offerUpdate(worker);
          });
        });
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') registration.update().catch(() => {});
        });
      } catch {
        onNotice('Não foi possível preparar o modo offline. Reabra o aplicativo com conexão.', null);
      }
    };
    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (requested && !reloading) {
        reloading = true;
        location.reload();
      }
    });
  }
  return async () => {
    if (pendingPrompt) {
      await pendingPrompt.prompt();
      await pendingPrompt.userChoice;
      pendingPrompt = null;
      onInstallReady(false);
      return true;
    }
    return false;
  };
}
