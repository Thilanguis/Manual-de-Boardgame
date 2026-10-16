import { roleLabel, statusLabel, OWNER_UID } from './permissions.js';

export function createAccountPanel({ root, getRepository, getSession, openDialog, closeDialog, onNotice, onError, googleEnabled = true }) {
  const $ = (id) => root.querySelector('#' + id);
  let busy = false,
    view = 'login';
  function setView(next = 'login', focus = true) {
    view = next;
    const signedIn = !!getSession().user;
    const fromEmail = $('login-form').elements.email.value;
    for (const name of ['login', 'register', 'recovery']) $(`${name}-form`).hidden = signedIn || name !== next;
    $('google-login').hidden = signedIn || next !== 'login' || !googleEnabled;
    $('session-info').hidden = !signedIn;
    $('login-title').textContent = signedIn ? 'Minha conta' : { login: 'Entre no Acervo', register: 'Crie sua conta grátis', recovery: 'Recupere sua senha' }[next];
    $('login-eyebrow').textContent = signedIn ? 'SEU PERFIL' : 'SUA PRÓXIMA PARTIDA COMEÇA AQUI';
    if (next === 'recovery' && !$('recovery-form').elements.email.value) $('recovery-form').elements.email.value = fromEmail;
    if (focus && !signedIn) $(`${next}-form`).querySelector('input')?.focus();
  }
  function render() {
    setView(view, false);
    if (!busy) for (const control of root.querySelectorAll('button,input')) if (!control.hasAttribute('data-close')) control.disabled = !getRepository();
    const { user, profile } = getSession();
    if (!user) return;
    const name = [profile?.name, user.displayName, user.email?.split('@')[0]].find((value) => value && value !== user.uid) || 'Minha conta';
    $('session-message').textContent = name;
    $('profile-avatar').textContent = name.slice(0, 1).toUpperCase();
    $('profile-email').textContent = user.email || 'E-mail não informado';
    $('profile-role').textContent = profile ? roleLabel(profile.role) : 'Verificando acesso…';
    $('profile-status').textContent = profile ? statusLabel(profile.status) : 'Verificando acesso';
    $('profile-status').dataset.status = profile?.status || 'loading';
    $('session-uid').value = user.uid;
    const providers = user.providerData || [];
    $('profile-providers').textContent = [...new Set(providers.map((p) => ({ password: 'E-mail e senha', 'google.com': 'Google' })[p.providerId] || p.providerId))].join(' · ') || 'Método não informado';
    $('session-status').textContent =
      {
        pending: 'Sua conta está aguardando aprovação.',
        approved: 'Sua conta está aprovada.',
        rejected: 'Sua solicitação foi recusada.',
        blocked: 'Sua conta está bloqueada.',
      }[profile?.status] || (user.uid === OWNER_UID ? 'O perfil do proprietário ainda precisa ser preparado pelo procedimento seguro do projeto.' : 'Conclua sua solicitação para entrar na fila de aprovação.');
    if (profile?.status === 'approved' && !getSession().canRead) $('session-status').textContent = navigator.onLine ? 'Verificando seu acesso…' : 'Conecte-se à internet para confirmar seu acesso.';
    if (!navigator.onLine) $('session-status').textContent = 'Conecte-se à internet para confirmar seu acesso.';
    $('retry-profile-button').hidden = !!profile || user.uid === OWNER_UID;
    $('google-link-section').hidden = !googleEnabled || providers.some((p) => p.providerId === 'google.com');
  }
  async function run(button, label, errorId, action) {
    if (busy) return;
    busy = true;
    const original = button.textContent,
      controls = [...root.querySelectorAll('button,input')].filter((c) => !c.hasAttribute('data-close'));
    const disabled = controls.map((c) => c.disabled);
    controls.forEach((c) => (c.disabled = true));
    button.textContent = label;
    button.setAttribute('aria-busy', 'true');
    const error = errorId && $(errorId);
    if (error) error.hidden = true;
    try {
      if (!getRepository()) throw new Error('A conexão ainda está sendo preparada. Tente novamente em instantes.');
      await action();
    } catch (cause) {
      if (error) {
        error.textContent = onError(cause);
        error.hidden = false;
      } else onNotice(onError(cause));
    } finally {
      busy = false;
      button.textContent = original;
      button.removeAttribute('aria-busy');
      controls.forEach((c, i) => (c.disabled = disabled[i]));
      render();
    }
  }
  root.querySelectorAll('[data-auth-view]').forEach(
    (button) =>
      (button.onclick = () => {
        if (!busy) setView(button.dataset.authView);
      }),
  );
  $('login-form').onsubmit = (event) => {
    event.preventDefault();
    const data = new FormData(event.target);
    void run($('login-submit'), 'Entrando…', 'login-error', async () => {
      await getRepository().login(data.get('email').trim(), data.get('password'));
      event.target.reset();
      closeDialog(root.id);
      onNotice('Conta conectada. Verificando seu acesso…');
    });
  };
  $('register-form').onsubmit = (event) => {
    event.preventDefault();
    const data = new FormData(event.target);
    void run($('register-submit'), 'Criando sua conta…', 'register-error', async () => {
      if (data.get('password') !== data.get('confirmation')) throw new Error('As senhas não coincidem. Confira os dois campos.');
      await getRepository().register(data.get('name'), data.get('email'), data.get('password'));
      event.target.reset();
      closeDialog(root.id);
      onNotice('Conta criada! Aguarde a aprovação do proprietário.');
    });
  };
  $('recovery-form').onsubmit = (event) => {
    event.preventDefault();
    const email = new FormData(event.target).get('email');
    void run($('recovery-submit'), 'Enviando instruções…', 'recovery-message', async () => {
      try {
        await getRepository().resetPassword(email);
      } catch (error) {
        if (error.code !== 'auth/user-not-found') throw error;
      }
      $('recovery-message').textContent = 'Se houver uma conta com este e-mail, você receberá as instruções para recuperar a senha. Confira também o spam.';
      $('recovery-message').hidden = false;
    });
  };
  $('google-login-button').onclick = () =>
    void run($('google-login-button'), 'Conectando ao Google…', 'google-login-error', async () => {
      await getRepository().loginGoogle();
      closeDialog(root.id);
      onNotice('Conta conectada. Verificando seu acesso…');
    });
  $('link-google-button').onclick = () =>
    void run($('link-google-button'), 'Vinculando…', null, async () => {
      await getRepository().linkGoogle();
      onNotice('Google vinculado à sua conta existente. Seu acesso foi preservado.');
    });
  $('retry-profile-button').onclick = () =>
    void run($('retry-profile-button'), 'Registrando solicitação…', null, async () => {
      await getRepository().retryProfile();
      onNotice('Solicitação registrada. Aguarde a aprovação do proprietário.');
    });
  $('logout-button').onclick = () =>
    void run($('logout-button'), 'Saindo…', null, async () => {
      await getRepository().logout();
      closeDialog(root.id);
      onNotice('Você saiu da conta.');
    });
  $('copy-uid').onclick = async () => {
    try {
      await navigator.clipboard.writeText(getSession().user.uid);
      onNotice('Identificador copiado para suporte.');
    } catch {
      $('session-uid').focus();
      $('session-uid').select();
      onNotice('Selecione o identificador e use a opção Copiar do seu dispositivo.');
    }
  };
  return {
    render,
    isBusy: () => busy,
    open() {
      view = 'login';
      for (const id of ['login-error', 'register-error', 'recovery-message', 'google-login-error']) $(id).hidden = true;
      render();
      openDialog(root.id);
      if (!getSession().user) $('login-form').elements.email.focus();
    },
  };
}
