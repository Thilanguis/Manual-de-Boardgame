export function setupPwa({ onNotice, isBusy = () => false, onInstallReady }) {
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
        const offerUpdate = (worker) =>
          onNotice(
            'Uma nova versão do Acervo está pronta.',
            async () => {
              if (isBusy()) {
                onNotice('Conclua a importação antes de atualizar.', null);
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
