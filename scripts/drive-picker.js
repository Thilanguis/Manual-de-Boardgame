let setup = null,
  picker = null;
const status = document.getElementById('status'),
  choose = document.getElementById('choose');
const headers = { 'Content-Type': 'application/json', 'X-Setup-State': window.acervoSetupState };
async function initialize() {
  const response = await fetch('/local-config', { method: 'POST', headers });
  if (!response.ok) throw new Error('A sessão local não está disponível. Reinicie o assistente.');
  setup = await response.json();
  await new Promise((resolve, reject) => gapi.load('picker', { callback: resolve, onerror: reject }));
  choose.disabled = false;
  status.textContent = 'Clique para selecionar a pasta PDFs na sua conta proprietária.';
}
choose.onclick = () => {
  const view = new google.picker.DocsView(google.picker.ViewId.FOLDERS).setIncludeFolders(true).setSelectFolderEnabled(true).setOwnedByMe(true).setFileIds(setup.folderId);
  picker = new google.picker.PickerBuilder()
    .addView(view)
    .setOAuthToken(setup.accessToken)
    .setDeveloperKey(setup.apiKey)
    .setAppId(setup.appId)
    .setOrigin(location.origin)
    .setCallback(async (data) => {
      if (data.action !== google.picker.Action.PICKED) return;
      if (data.docs?.[0]?.id !== setup.folderId) {
        status.textContent = 'A pasta escolhida não corresponde ao ID indicado. Selecione a pasta PDFs correta.';
        return;
      }
      choose.disabled = true;
      status.textContent = 'Validando proprietário e gravando configuração no Worker…';
      try {
        const response = await fetch('/select-folder', { method: 'POST', headers, body: JSON.stringify({ folderId: setup.folderId }) });
        if (!response.ok) throw new Error('A conexão não foi concluída. Confira o terminal.');
        setup.accessToken = '';
        picker.setVisible(false);
        picker = null;
        location.replace('/complete');
      } catch (error) {
        status.textContent = error.message;
      }
    })
    .build();
  picker.setVisible(true);
};
initialize().catch((error) => (status.textContent = error.message));
