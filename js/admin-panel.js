import { OWNER_UID, roleLabel, statusLabel, defaultSubadminPermissions } from './permissions.js';
export function createAdminPanel({ repository, config, onNotice, onError }) {
  const $ = (id) => document.getElementById(id),
    dialog = $('admin-dialog');
  let session = {},
    pending = [],
    people = [],
    events = [],
    stopPending = null,
    stopPeople = null,
    stopAudit = null,
    subscriptionKey = '',
    selected = null,
    busy = false;
  const label = {
    approve: 'Cadastro aprovado',
    reject: 'Cadastro recusado',
    promote: 'Promovido a subadministrador',
    demote: 'Rebaixado a usuário',
    permissions: 'Permissões alteradas',
    block: 'Conta bloqueada',
    unblock: 'Conta desbloqueada',
    librarySettings: 'Configuração de leitura alterada',
  };
  function el(tag, cls, text) {
    const element = document.createElement(tag);
    if (cls) element.className = cls;
    if (text !== undefined) element.textContent = text;
    return element;
  }
  const date = (value) => (value ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : 'Sincronizando…');
  function error(value) {
    $('admin-error').textContent = onError(value);
    $('admin-error').hidden = false;
  }
  function tab(name) {
    if (name === 'settings' && !session.canConfigure) return;
    document.querySelectorAll('[data-admin-section]').forEach((section) => (section.hidden = section.dataset.adminSection !== name));
    document.querySelectorAll('[data-admin-tab]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.adminTab === name)));
  }
  function button(text, run, danger = false) {
    const button = el('button', danger ? 'button secondary small danger' : 'button secondary small', text);
    button.type = 'button';
    button.onclick = run;
    return button;
  }
  async function change(person, action, permissions) {
    if (busy) return;
    busy = true;
    const controls = [...document.querySelectorAll('#admin-dialog button,#person-dialog button')];
    controls.forEach((button) => (button.disabled = true));
    $('admin-error').hidden = $('person-error').hidden = true;
    try {
      await repository.changeUser(person.uid, action, permissions);
      onNotice(label[action] + '.');
      if ($('person-dialog').open) $('person-dialog').close();
    } catch (value) {
      error(value);
      $('person-error').textContent = onError(value);
      $('person-error').hidden = false;
    } finally {
      busy = false;
      controls.forEach((button) => (button.disabled = false));
    }
  }
  function card(person, review = false) {
    const row = el('article', 'person-row'),
      info = el('div', 'person-info'),
      actions = el('div', 'person-actions');
    info.append(el('strong', null, person.name || 'Usuário'), el('span', 'muted-text', person.email), el('span', 'person-meta', `${roleLabel(person.role)} · ${statusLabel(person.status)} · ${date(person.createdAt)}`));
    if (person.role === 'subadmin')
      info.append(
        el(
          'span',
          'person-meta',
          Object.entries(person.permissions || {})
            .filter(([key, enabled]) => enabled && key !== 'deleteGames')
            .map(([key]) => ({ approveUsers: 'aprovar pessoas', addGames: 'adicionar jogos', editGames: 'editar jogos' })[key])
            .join(' · ') || 'Sem permissões administrativas concedidas',
        ),
      );
    if (review && session.canApproveUsers && person.status === 'pending' && person.uid !== session.user?.uid) {
      actions.append(
        button('Aprovar', () => change(person, 'approve')),
        button('Recusar', () => change(person, 'reject'), true),
      );
    }
    if (session.canManageUsers && person.uid !== OWNER_UID && person.uid !== session.user?.uid) actions.append(button('Gerenciar', () => edit(person)));
    if (person.uid === OWNER_UID) actions.append(el('span', 'person-meta', 'Proprietário protegido'));
    row.append(info, actions);
    return row;
  }
  function renderPending() {
    const count = pending.length;
    $('pending-count').textContent = count;
    $('pending-count').hidden = !count;
    $('panel-pending-count').textContent = count;
    $('manage-button').setAttribute('aria-label', `Gerenciar pessoas, ${count} solicitações pendentes`);
    $('pending-users').replaceChildren(...(count ? [...pending].sort((a, b) => b.createdAt - a.createdAt).map((person) => card(person, true)) : [el('p', 'muted-text', 'Nenhuma solicitação pendente.')]));
  }
  function renderPeople() {
    const query = $('people-search').value.toLocaleLowerCase('pt-BR');
    const filtered = people.filter((person) => `${person.name} ${person.email}`.toLocaleLowerCase('pt-BR').includes(query)).sort((a, b) => b.createdAt - a.createdAt);
    $('all-users').replaceChildren(...(filtered.length ? filtered.map((person) => card(person, person.status === 'pending')) : [el('p', 'muted-text', 'Nenhuma conta encontrada.')]));
  }
  function renderHistory() {
    const byUid = new Map(people.map((person) => [person.uid, person]));
    $('audit-list').replaceChildren(
      ...(events.length
        ? events.map((event) => {
            const row = el('article', 'person-row'),
              content = el('div', 'person-info');
            content.append(
              el('strong', null, label[event.action] || event.action),
              el('span', 'muted-text', `${event.targetType === 'settings' ? 'Biblioteca' : byUid.get(event.targetId)?.name || event.targetId} · por ${byUid.get(event.actorUid)?.name || event.actorUid}`),
              el('span', 'person-meta', date(event.createdAt)),
            );
            if (event.targetType === 'user') content.append(el('span', 'person-meta', `${roleLabel(event.before.role)} / ${statusLabel(event.before.status)} → ${roleLabel(event.after.role)} / ${statusLabel(event.after.status)}`));
            if (event.action === 'permissions' || event.action === 'promote')
              content.append(
                el(
                  'span',
                  'person-meta',
                  `Permissões: ${
                    Object.entries(event.after.permissions)
                      .filter(([, value]) => value)
                      .map(([key]) => ({ approveUsers: 'aprovar cadastros', addGames: 'adicionar jogos', editGames: 'editar jogos', deleteGames: 'excluir definitivamente' })[key] || key)
                      .join(', ') || 'nenhuma'
                  }`,
                ),
              );
            row.append(content);
            return row;
          })
        : [el('p', 'muted-text', 'Nenhuma alteração registrada.')]),
    );
  }
  function edit(person) {
    if (!session.canManageUsers || person.uid === OWNER_UID || person.uid === session.user.uid) return;
    selected = person;
    $('person-title').textContent = person.name;
    $('person-email').textContent = person.email;
    $('person-status').textContent = `${roleLabel(person.role)} · ${statusLabel(person.status)}`;
    $('person-permissions').hidden = person.status !== 'approved' && person.role !== 'subadmin';
    const permissions = person.role === 'subadmin' ? person.permissions : defaultSubadminPermissions();
    $('permission-approve').checked = permissions.approveUsers === true;
    $('permission-add').checked = permissions.addGames === true;
    $('permission-edit').checked = permissions.editGames === true;
    const readPermissions = () => ({ approveUsers: $('permission-approve').checked, addGames: $('permission-add').checked, editGames: $('permission-edit').checked, deleteGames: false });
    const actions = [];
    if (person.status === 'pending')
      actions.push(
        button('Aprovar', () => change(selected, 'approve')),
        button('Recusar', () => change(selected, 'reject'), true),
      );
    if (person.status === 'approved' && person.role === 'user') actions.push(button('Promover a subadministrador', () => change(selected, 'promote', readPermissions())));
    if (person.role === 'subadmin')
      actions.push(
        button('Salvar permissões', () => change(selected, 'permissions', readPermissions())),
        button('Rebaixar a usuário', () => change(selected, 'demote'), true),
      );
    actions.push(person.status === 'blocked' ? button('Desbloquear conta', () => change(selected, 'unblock')) : button('Bloquear conta', () => change(selected, 'block'), true));
    $('person-actions').replaceChildren(...actions);
    $('person-error').hidden = true;
    $('person-dialog').showModal();
  }
  function open() {
    if (!session.canApproveUsers && !session.canManageUsers) return;
    if (!dialog.open) dialog.showModal();
    document.body.classList.add('modal-open');
    $('admin-error').hidden = true;
    tab('requests');
    stopPeople?.();
    stopAudit?.();
    stopPeople = repository.subscribePeople((data) => {
      people = data;
      renderPeople();
      renderHistory();
    }, error);
    stopAudit = repository.subscribeAudit((data) => {
      events = data;
      renderHistory();
    }, error);
  }
  function closeSubscriptions() {
    stopPeople?.();
    stopAudit?.();
    stopPeople = stopAudit = null;
    people = [];
    events = [];
  }
  dialog.addEventListener('close', closeSubscriptions);
  document.querySelectorAll('[data-admin-tab]').forEach((button) => (button.onclick = () => tab(button.dataset.adminTab)));
  $('manage-button').onclick = open;
  $('people-search').oninput = renderPeople;
  $('save-library-settings').onclick = async () => {
    if (busy) return;
    busy = true;
    $('save-library-settings').disabled = true;
    try {
      await repository.setLibraryPublic($('library-public').checked);
      onNotice('Configuração da biblioteca atualizada.');
    } catch (value) {
      error(value);
    } finally {
      busy = false;
      $('save-library-settings').disabled = false;
    }
  };
  return {
    isBusy: () => busy,
    updateSession(next) {
      session = next;
      const enabled = next.mode === 'firebase' && (next.canApproveUsers || next.canManageUsers);
      $('manage-button').hidden = !enabled;
      $('admin-settings-tab').hidden = !next.canConfigure;
      $('library-public').checked = next.publicRead === true;
      $('admin-storage-status').textContent = config.fileStorage?.apiBase ? `API configurada: ${config.fileStorage.apiBase}. A autorização e o envio real precisam ser validados.` : 'Conexão Drive pendente. A API ainda não foi configurada.';
      const key = `${next.user?.uid || ''}:${enabled}`;
      if (key !== subscriptionKey) {
        subscriptionKey = key;
        stopPending?.();
        stopPending = null;
        pending = [];
        renderPending();
        if (!enabled) {
          if ($('person-dialog').open) $('person-dialog').close();
          if (dialog.open) dialog.close();
          closeSubscriptions();
        } else
          stopPending = repository.subscribePending((data, meta) => {
            pending = data;
            renderPending();
            if (!meta.initial && !meta.fromCache && meta.added.length) onNotice(`${meta.added.length} nova(s) solicitação(ões) de cadastro.`, open, 'Ver solicitações');
          }, error);
      }
    },
    close() {
      stopPending?.();
      closeSubscriptions();
    },
  };
}
