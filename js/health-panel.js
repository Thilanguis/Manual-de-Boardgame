const labels = { operational: 'Operacional', configured: 'Configurado · não testado', disabled: 'Desativado', configuration: 'Configuração pendente', oauth: 'Autorização recusada', permission: 'Acesso recusado', missing: 'Pasta indisponível', unavailable: 'Indisponível', limited: 'Limite do Google', unknown: 'Não verificado', checking: 'Verificando…' };
export function createHealthPanel({ root, repository }) {
  let session = {}, controller, sequence = 0;
  const create = (tag, text, cls = '') => {
    const node = document.createElement(tag);
    node.textContent = text;
    node.className = cls;
    return node;
  };
  root.classList.add('health-panel');
  root.hidden = true;
  root.append(create('h3', 'Saúde do Acervo'));
  const rows = {};
  for (const [key, name] of [['firebase', 'Firebase'], ['drive', 'Google Drive'], ['gemini', 'Gemini']]) {
    const row = create('div', '', 'health-row'), state = create('strong', labels.unknown), detail = create('p', '', 'muted-text');
    state.setAttribute('role', 'status');
    row.append(create('span', name), state, detail);
    root.append(row);
    rows[key] = { state, detail };
  }
  const footer = create('div', '', 'health-footer'), stamp = create('p', 'Última verificação: ainda não realizada.', 'muted-text'), button = create('button', 'Verificar agora', 'button secondary small'), error = create('p', '', 'inline-error');
  button.type = 'button';
  error.setAttribute('role', 'status');
  error.hidden = true;
  footer.append(stamp, button);
  root.append(footer, error);
  const allowed = () => session.canRead && session.isOwner && !!session.user?.uid;
  function display(key, value = { state: 'unknown' }) {
    // Somente o teste autenticado da pasta pode produzir o verde do Drive.
    const state = key === 'drive' && value.state === 'operational' && value.verified !== true ? 'unknown' : key === 'gemini' && value.state === 'operational' ? 'configured' : value.state;
    rows[key].state.textContent = labels[state] || labels.unknown;
    rows[key].state.dataset.healthState = state;
    rows[key].detail.textContent = value.message || '';
  }
  function cancel(clear = false) {
    ++sequence;
    controller?.abort();
    controller = null;
    button.disabled = false;
    if (clear) {
      Object.keys(rows).forEach(key => display(key));
      stamp.textContent = 'Última verificação: ainda não realizada.';
      error.hidden = true;
    }
  }
  async function check() {
    if (!allowed() || controller) return;
    const token = ++sequence, uid = session.user.uid;
    controller = new AbortController();
    button.disabled = true;
    error.hidden = true;
    Object.keys(rows).forEach(key => display(key, { state: 'checking' }));
    try {
      if (!repository.diagnoseHealth) throw new Error('O diagnóstico autenticado não está disponível neste ambiente.');
      const data = await repository.diagnoseHealth({ signal: controller.signal });
      if (token !== sequence || !allowed() || session.user.uid !== uid) return;
      for (const key of Object.keys(rows)) display(key, data[key]);
      stamp.textContent = `Última verificação: ${new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'medium' }).format(new Date(data.checkedAt))}`;
    } catch (value) {
      if (token !== sequence) return;
      Object.keys(rows).forEach(key => display(key));
      error.textContent = value.message || 'Não foi possível verificar a API agora. Nenhum serviço foi considerado operacional.';
      error.hidden = false;
    } finally {
      if (token === sequence) {
        controller = null;
        button.disabled = false;
      }
    }
  }
  button.onclick = check;
  return {
    check,
    close: () => cancel(true),
    updateSession(next) {
      if (!next.isOwner || !next.canRead || next.user?.uid !== session.user?.uid) cancel(true);
      session = next;
      root.hidden = !allowed();
    },
  };
}
