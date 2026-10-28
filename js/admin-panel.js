import { OWNER_UID, roleLabel, statusLabel, subadminPermissions } from './permissions.js';
import { createHealthPanel } from './health-panel.js';
export function createAdminPanel({ repository, config, onNotice, onError }) {
  const ownerUid = config.ownerUid || OWNER_UID;
  const $ = (id) => document.getElementById(id),
    dialog = $('admin-dialog');
  const health = createHealthPanel({ root: $('admin-health'), repository });
  const diagnostics = $('admin-health-disclosure');
  diagnostics.addEventListener('toggle', () => diagnostics.open ? void health.check() : health.close());
  let session = {},
    pending = [],
    people = [],
    events = [],
    stopPending = null,
    stopPeople = null,
    stopAudit = null,
    subscriptionKey = '',
    selected = null,
    discardAction = null,
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
    if (['people', 'history'].includes(name) && !session.canManageUsers) return;
    if (name !== 'settings') health.close();
    else if (diagnostics.open) void health.check();
    document.querySelectorAll('[data-admin-section]').forEach((section) => (section.hidden = section.dataset.adminSection !== name));
    document.querySelectorAll('[data-admin-tab]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.adminTab === name)));
    const needsPeople = ['people', 'history'].includes(name);
    if (!needsPeople) {
      stopPeople?.();
      stopPeople = null;
    } else if (!stopPeople)
      stopPeople = repository.subscribePeople((data) => {
        people = data;
        renderPeople();
        renderHistory();
        if (selected && $('person-dialog').open && !busy) {
          const fresh = people.find((person) => person.uid === selected.uid);
          if (!fresh) $('person-dialog').close();
          else if ((!permissionsDirty() && fresh.version !== selected.version) || fresh.role !== selected.role || fresh.status !== selected.status) {
            selected = fresh;
            renderPerson(true);
          } else if (fresh.version !== selected.version) {
            $('person-error').textContent = 'O perfil foi alterado em outra sessão. Feche e reabra antes de salvar.';
            $('person-error').hidden = false;
          }
        }
      }, error);
    if (name !== 'history') {
      stopAudit?.();
      stopAudit = null;
    } else if (!stopAudit)
      stopAudit = repository.subscribeAudit((data) => {
        events = data;
        renderHistory();
      }, error);
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
    const controls = [...document.querySelectorAll('#admin-dialog button,#person-dialog button,#person-dialog input')].map((control) => [control, control.disabled]);
    controls.forEach(([control]) => (control.disabled = true));
    $('admin-error').hidden = $('person-error').hidden = true;
    try {
      const result = await repository.changeUser(person.uid, action, permissions, { expectedVersion: person.version });
      const saved = { ...person, ...result };
      people = people.map((value) => value.uid === person.uid ? saved : value);
      pending = pending.map((value) => value.uid === person.uid ? saved : value).filter((value) => value.status === 'pending');
      renderPeople();
      renderPending();
      if (!result?.unchanged) onNotice(action === 'permissions' ? 'Permissões salvas.' : label[action] + '.');
      if ($('person-dialog').open && selected?.uid === person.uid) {
        if (['permissions', 'promote'].includes(action)) {
          selected = saved;
          renderPerson(true);
          $('person-save-state').textContent = action === 'permissions' ? 'Permissões salvas e confirmadas.' : 'Promoção concluída. Nenhuma permissão foi concedida. Marque as opções e salve para conceder acesso.';
        } else $('person-dialog').close();
      }
    } catch (value) {
      if ($('person-dialog').open) {
        $('person-error').textContent = onError(value);
        $('person-error').hidden = false;
      } else error(value);
    } finally {
      busy = false;
      controls.forEach(([control, disabled]) => (control.disabled = disabled));
      updatePermissionState();
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
          Object.entries(subadminPermissions(person.permissions))
            .filter(([key, enabled]) => enabled && ['approveUsers', 'addGames', 'editGames'].includes(key))
            .map(([key]) => ({ approveUsers: 'aprovar cadastros', addGames: 'adicionar jogos', editGames: 'editar jogos' })[key])
            .join(' · ') || 'Sem permissões administrativas concedidas',
        ),
      );
    if (review && session.canApproveUsers && person.status === 'pending' && person.uid !== session.user?.uid) {
      actions.append(
        button('Aprovar', () => change(person, 'approve')),
        button('Recusar', () => change(person, 'reject'), true),
      );
    }
    if (session.canManageUsers && person.uid !== ownerUid && person.uid !== session.user?.uid) actions.append(button('Gerenciar', () => edit(person)));
    if (person.uid === ownerUid) actions.append(el('span', 'person-meta', 'Proprietário protegido'));
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
  const readPermissions = () => subadminPermissions({ approveUsers: $('permission-approve').checked, addGames: $('permission-add').checked, editGames: $('permission-edit').checked });
  const permissionsDirty = () => selected?.role === 'subadmin' && ['approveUsers', 'addGames', 'editGames'].some((key) => readPermissions()[key] !== (selected.permissions?.[key] === true));
  function updatePermissionState() {
    const dirty = permissionsDirty();
    $('save-person-permissions').disabled = busy || !dirty;
    $('person-permissions-state').textContent = busy ? 'Salvando… Aguarde a confirmação.' : dirty ? 'Alterações não salvas.' : 'As opções mostram as permissões registradas.';
    $('person-permissions-state').classList.toggle('unsaved-permissions', !!dirty);
  }
  function clearDiscard() {
    discardAction = null;
    $('person-discard').hidden = true;
  }
  function afterDiscard(run) {
    if (busy) return;
    if (!permissionsDirty()) return run();
    discardAction = run;
    $('person-discard').hidden = false;
    $('person-keep-editing').focus();
  }
  function requestClose() {
    afterDiscard(() => $('person-dialog').close());
  }
  function renderPerson(reset = false) {
    const person = selected;
    if (!person) return;
    clearDiscard();
    $('person-title').textContent = person.name;
    $('person-email').textContent = person.email;
    $('person-status').textContent = `${roleLabel(person.role)} · ${statusLabel(person.status)}`;
    $('person-permissions').hidden = person.role !== 'subadmin' || !session.canManageUsers;
    if (reset) {
      const permissions = person.role === 'subadmin' ? subadminPermissions(person.permissions) : subadminPermissions();
      $('permission-add').checked = permissions.addGames;
      $('permission-edit').checked = permissions.editGames;
      $('permission-approve').checked = permissions.approveUsers;
      $('person-save-state').textContent = '';
      $('person-error').hidden = true;
    }
    updatePermissionState();
    const actions = [];
    if (person.status === 'pending' && person.role === 'user')
      actions.push(
        button('Aprovar', () => change(selected, 'approve')),
        button('Recusar', () => change(selected, 'reject'), true),
      );
    if (person.status === 'approved' && person.role === 'user') actions.push(button('Promover a subadministrador', () => change(selected, 'promote')));
    if (person.role === 'subadmin')
      actions.push(button('Rebaixar a usuário', () => afterDiscard(() => change(selected, 'demote')), true));
    actions.push(person.status === 'blocked' ? button('Desbloquear conta', () => afterDiscard(() => change(selected, 'unblock'))) : button('Bloquear conta', () => afterDiscard(() => change(selected, 'block')), true));
    $('person-actions').replaceChildren(...actions);
  }
  function edit(person) {
    if (!session.canManageUsers || person.uid === ownerUid || person.uid === session.user.uid) return;
    selected = person;
    renderPerson(true);
    $('person-dialog').showModal();
  }
  function open() {
    if (!session.canApproveUsers && !session.canManageUsers) return;
    if (!dialog.open) dialog.showModal();
    document.body.classList.add('modal-open');
    $('admin-error').hidden = true;
    tab('requests');
  }
  function closeSubscriptions() {
    health.close();
    stopPeople?.();
    stopAudit?.();
    stopPeople = stopAudit = null;
    people = [];
    events = [];
  }
  dialog.addEventListener('close', closeSubscriptions);
  $('person-dialog').addEventListener('cancel', (event) => {
    event.preventDefault();
    if (discardAction) {
      clearDiscard();
      $('person-dialog').querySelector('[data-close]').focus();
    } else requestClose();
  });
  $('person-dialog').addEventListener('close', () => {
    selected = null;
    clearDiscard();
  });
  for (const id of ['permission-approve', 'permission-add', 'permission-edit']) $(id).addEventListener('change', () => {
    $('person-save-state').textContent = '';
    clearDiscard();
    updatePermissionState();
  });
  $('save-person-permissions').onclick = () => {
    if (permissionsDirty()) return change(selected, 'permissions', readPermissions());
  };
  $('person-keep-editing').onclick = () => {
    clearDiscard();
    $('save-person-permissions').focus();
  };
  $('person-discard-changes').onclick = () => {
    const run = discardAction;
    clearDiscard();
    if (run) {
      $('permission-add').checked = selected.permissions?.addGames === true;
      $('permission-edit').checked = selected.permissions?.editGames === true;
      $('permission-approve').checked = selected.permissions?.approveUsers === true;
      run();
    }
  };
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
    requestClose,
    updateSession(next) {
      session = next;
      health.updateSession(next);
      const enabled = next.mode === 'firebase' && (next.canApproveUsers || next.canManageUsers);
      $('manage-button').hidden = !enabled;
      $('admin-settings-tab').hidden = !next.canConfigure;
      for (const name of ['people', 'history']) document.querySelector(`[data-admin-tab="${name}"]`).hidden = !next.canManageUsers;
      $('admin-title').textContent = next.canManageUsers ? 'Pessoas e solicitações' : 'Solicitações de cadastro';
      $('library-public').checked = next.publicRead === true;
      $('admin-storage-status').textContent = config.development
        ? 'Ambiente local. Arquivos e IA são simulados; dados fictícios.'
        : config.fileStorage?.apiBase
          ? 'O endereço da API está configurado. Abra este painel para conferir a leitura autenticada do Drive; configuração não é prova de funcionamento.'
          : 'Conexão Drive pendente. A API ainda não foi configurada.';
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
