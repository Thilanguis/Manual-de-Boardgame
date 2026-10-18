import { validateGame, durationLabel, playersLabel } from './model.js';

export function createGameSteps({ form, dialog, getSession, getDocuments = () => [], isBusy = () => false }) {
  let current = 1,
    invalidControl;
  const $ = (id) => document.getElementById(id),
    steps = [...form.querySelectorAll('[data-game-step]')];
  function values() {
    return Object.fromEntries(new FormData(form).entries());
  }
  function validate(step) {
    if (step === 1 && getDocuments().some((document) => !document.manual)) {
      $('save-error').textContent = 'Há PDFs que não puderam ser preparados. Retire os arquivos indicados ou selecione cópias válidas antes de continuar.';
      $('save-error').hidden = false;
      return false;
    }
    const data = values();
    const section = steps[step - 1];
    const invalid = [...section.querySelectorAll('input,textarea,select')].find((c) => !c.checkValidity());
    if (invalid) {
      invalidControl = invalid;
      $('save-error').textContent = invalid.validationMessage;
      $('save-error').hidden = false;
      return false;
    }
    invalidControl = null;
    try {
      validateGame(step === 1 ? { title: data.title } : data);
      return true;
    } catch (error) {
      $('save-error').textContent = error.message;
      $('save-error').hidden = false;
      return false;
    }
  }
  function summary() {
    const game = validateGame(values());
    const documents = getDocuments();
    $('game-summary').replaceChildren();
    const languages = { 'pt-BR': 'Português', en: 'Inglês', fr: 'Francês', es: 'Espanhol' };
    for (const [label, value] of [
      ['Jogo', game.title],
      ...(documents.length ? [['PDFs', `${documents.length} ${documents.length === 1 ? 'arquivo' : 'arquivos'}: ${documents.map((document) => document.name || document.manual?.name).join(' · ')}`]] : []),
      ['Resumo', game.description || 'Não informado'],
      ['Jogadores', playersLabel(game)],
      ['Duração', durationLabel(game)],
      ['Idade', game.recommendedAge ? game.recommendedAge + '+ anos' : 'Não informada'],
      ['Tipo', game.gameType || 'Não informado'],
      ['Categorias', game.tags.join(', ') || 'Não informadas'],
      ['Mecânicas', game.mechanics.join(', ') || 'Não informadas'],
      ['Idioma', languages[game.language] || 'Não identificado'],
      ['Edição', game.edition || 'Não informada'],
    ]) {
      const row = document.createElement('div'),
        term = document.createElement('dt'),
        detail = document.createElement('dd');
      term.textContent = label;
      detail.textContent = value;
      row.append(term, detail);
      $('game-summary').append(row);
    }
    $('visibility-help').textContent =
      getSession().mode === 'local'
        ? 'Esta biblioteca fica neste navegador; a opção não publica arquivos na internet.'
        : getSession().publicRead
          ? 'Todas as contas aprovadas já têm acesso à biblioteca. Esta opção não libera visitantes.'
          : 'Desmarcado: somente a equipe administrativa poderá ler este manual.';
  }
  function go(next, check = true, focus = true) {
    if (check && isBusy()) return false;
    if (check) $('save-error').hidden = true;
    if (check && next > current)
      for (let step = current; step < next; step++)
        if (!validate(step)) {
          go(step, false, false);
          invalidControl?.reportValidity();
          return false;
        }
    current = Math.max(1, Math.min(3, next));
    dialog.dataset.step = current;
    steps.forEach((step, i) => (step.hidden = i + 1 !== current));
    $('game-step-nav')
      .querySelectorAll('[data-step-target]')
      .forEach((button) => {
        button.toggleAttribute('data-completed', Number(button.dataset.stepTarget) < current);
        if (Number(button.dataset.stepTarget) === current) button.setAttribute('aria-current', 'step');
        else button.removeAttribute('aria-current');
      });
    $('game-back').hidden = current === 1;
    $('game-next').hidden = current === 3;
    $('save-game').hidden = current !== 3;
    $('game-next').textContent = current === 1 ? 'Conferir informações →' : 'Revisar publicação →';
    $('step-caption').textContent = `Etapa ${current} de 3`;
    if (current === 3) summary();
    const scroller = form.querySelector('.review-grid');
    scroller.scrollTop = 0;
    if (focus) steps[current - 1].querySelector('h3')?.focus({ preventScroll: true });
    return true;
  }
  $('game-step-nav')
    .querySelectorAll('[data-step-target]')
    .forEach((button) => (button.onclick = () => go(Number(button.dataset.stepTarget))));
  $('game-back').onclick = () => go(current - 1);
  $('game-next').onclick = () => go(current + 1);
  return {
    get current() {
      return current;
    },
    next: () => go(current + 1),
    go,
    reset() {
      current = 1;
      go(1, false, false);
      $('game-step-nav').hidden = true;
      dialog.classList.remove('has-draft');
    },
    show() {
      $('game-step-nav').hidden = false;
      dialog.classList.add('has-draft');
      go(current, false, false);
    },
    refresh() {
      if (current === 3) summary();
    },
  };
}
