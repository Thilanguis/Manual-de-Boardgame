import { assistantIdentity, RULE_ASSISTANT_LIMITS as limits } from './rule-assistant-contract.js';
import { findDocument } from './documents.js';
import { renderRuleReading } from './rule-reading.js';

const el = (tag, text = '', className = '') => {
  const node = document.createElement(tag);
  node.textContent = text;
  node.className = className;
  return node;
};
const button = (text, action) => {
  const node = el('button', text, 'button secondary small');
  node.type = 'button';
  node.onclick = action;
  return node;
};
const externalMessage = (status) =>
  ({
    unavailable: 'Pesquisa externa oficial indisponível para este jogo. O Gemini recebeu somente os trechos disponíveis dos PDFs.',
    partial: 'Uma fonte oficial não respondeu. Confira as referências utilizadas.',
    'no-match': 'As fontes oficiais consultadas não trouxeram trechos relevantes.',
    searched: 'Também foram consultadas fontes oficiais autorizadas.',
    'not-needed': 'Resposta baseada nos documentos do Acervo.',
    'web-searched': 'A pesquisa na internet foi realizada. Confira as fontes externas indicadas em cada explicação; elas podem incluir esclarecimentos e discussões, além de regras oficiais.',
    'web-no-match': 'A pesquisa na internet não trouxe evidência verificável suficiente. As lacunas continuam indicadas.',
    'web-rate-limit': 'O Google limitou a pesquisa na internet. Os trechos dos PDFs continuam disponíveis; não houve repetição automática.',
    'web-not-authorized': 'A pesquisa na internet não foi autorizada pelo Google para esta chave. Os trechos dos PDFs continuam disponíveis.',
    'web-unavailable': 'A pesquisa na internet ficou indisponível. A parte sustentada pelos PDFs foi preservada.',
    'web-answer-unavailable': 'A pesquisa encontrou fontes, mas o Gemini não concluiu a explicação complementar. A resposta parcial dos PDFs foi preservada.',
  })[status] || '';

// Conversa privada em memória da tela; o servidor controla o cache e a autorização.
export function createRuleAssistantPanel({ repository, container, getGame, pageButton, getQuestion = () => '', onOpen = () => {}, onClose = () => {} }) {
  const panel = el('section', '', 'rule-assistant');
  panel.hidden = true;
  panel.setAttribute('aria-label', 'Assistente contextual de regras');
  const heading = el('h3'),
    contextLabel = el('p', '', 'muted'),
    transcript = el('div', '', 'rule-conversation');
  const header = el('div', '', 'rule-chat-header');
  header.append(
    heading,
    button('Nova conversa', () => reset()),
  );
  const intro = el('p', 'Faça uma pergunta. Primeiro consulto os PDFs do jogo; se faltar informação, busco complemento na internet.', 'muted');
  const past = el('details', '', 'rule-conversation-history'),
    pastLabel = el('summary'),
    history = el('div'),
    latest = el('div', '', 'rule-latest');
  past.append(pastLabel, history);
  past.hidden = true;
  transcript.append(past, latest);
  const status = el('p', '', 'rule-assistant-status');
  status.setAttribute('role', 'status');
  status.hidden = true;
  const form = el('form'),
    label = el('label', 'Sua pergunta');
  const input = el('textarea');
  input.rows = 3;
  input.maxLength = limits.question;
  label.append(input);
  const send = el('button', 'Enviar pergunta', 'button primary small');
  send.type = 'submit';
  const cancel = button('Cancelar pergunta', () => stop('Pergunta cancelada. Nenhuma repetição automática será feita.'));
  cancel.hidden = true;
  const actions = el('div', '', 'rule-assistant-actions');
  actions.append(send, cancel);
  form.append(label, actions);
  panel.append(header, contextLabel, intro, transcript, status, form);
  container.append(panel);
  let selected,
    conversationId,
    identity,
    uid,
    controller,
    revision = 0,
    origin;
  const permitted = () => repository.session.canRead && repository.session.canAskRules && !!repository.session.user?.uid;
  function notice(message = '', state = '') {
    status.textContent = message;
    status.hidden = !message;
    panel.dataset.state = state;
  }
  function stop(message = '') {
    revision++;
    controller?.abort();
    controller = null;
    send.disabled = false;
    cancel.hidden = true;
    notice(message, message ? 'error' : '');
    if (message && latest.firstElementChild) latest.firstElementChild.dataset.failed = 'true';
  }
  function reset() {
    stop();
    conversationId = crypto.randomUUID();
    history.replaceChildren();
    latest.replaceChildren();
    past.hidden = true;
    past.open = false;
    intro.hidden = false;
    input.value = '';
    label.firstChild.textContent = 'Sua pergunta';
    input.focus();
  }
  function close() {
    stop();
    panel.hidden = true;
    history.replaceChildren();
    latest.replaceChildren();
    past.hidden = true;
    input.value = '';
    selected = null;
    onClose();
    origin?.focus({ preventScroll: true });
  }
  function startTurn(question) {
    const previous = latest.firstElementChild;
    if (previous && !(previous.dataset.failed === 'true' && previous.dataset.question === question)) history.append(previous);
    past.hidden = !history.childElementCount;
    past.open = false;
    pastLabel.textContent = `Mensagens anteriores (${history.childElementCount})`;
    const turn = el('section', '', 'rule-turn');
    turn.dataset.question = question;
    turn.append(el('p', question, 'rule-question'));
    latest.replaceChildren(turn);
    intro.hidden = true;
    return turn;
  }
  function answerCard(answer, cached) {
    const card = el('article', '', 'rule-assistant-answer');
    card.append(el('h4', 'Resposta do Gemini'));
    const references = (answer.blocks || []).flatMap((b) => b.citations || []);
    const manual = references.some((r) => r.source === 'manual'),
      online = references.some((r) => r.source !== 'manual');
    card.append(el('p', `Interpretação da IA · Base: ${manual && online ? 'PDFs e internet' : manual ? 'PDFs do jogo' : online ? 'Internet' : 'evidência insuficiente'}${cached ? ' · resposta reutilizada' : ''}.`, 'rule-answer-basis'));
    const searched = ['web-searched', 'searched', 'partial', 'no-match', 'web-no-match', 'web-answer-unavailable'].includes(answer.external);
    card.append(
      el(
        'p',
        searched ? 'Internet: consultada nesta pergunta.' : ['web-rate-limit', 'web-not-authorized', 'web-unavailable'].includes(answer.external) ? 'Internet: tentativa não concluída.' : 'Internet: não consultada nesta pergunta.',
        'rule-answer-internet',
      ),
    );
    if (answer.insufficient) card.append(el('p', 'As evidências não permitem responder completamente. Confira os documentos originais.', 'rule-notice'));
    const sources = el('details', '', 'rule-answer-sources'),
      sourcesLabel = el('summary');
    sources.append(sourcesLabel);
    const entries = new Map();
    for (const block of answer.blocks || []) {
      const part = el('div', '', `rule-answer-block rule-answer-${block.kind}`);
      const title = { exception: 'Exceção', example: 'Exemplo', conflict: 'Divergência entre fontes' }[block.kind];
      if (title) part.append(el('h4', title));
      renderRuleReading(part, block.text);
      for (const ref of block.citations || []) {
        const key = JSON.stringify([ref.id, ref.documentId, ref.page, ref.url, ref.quote]);
        let entry = entries.get(key);
        if (!entry) {
          const details = el('details', '', 'rule-citation');
          details.append(el('summary', ref.source === 'manual' ? `${ref.name} · página ${ref.page}` : `${ref.name} · ${ref.source === 'web' ? 'fonte da internet' : 'fonte oficial externa'}`));
          if (ref.quoteKind === 'search-summary') details.append(el('small', 'Resumo da pesquisa vinculado à fonte pelo Google; não é transcrição literal da página.'));
          details.append(el(ref.quoteKind === 'search-summary' ? 'p' : 'blockquote', ref.quote));
          if (ref.source === 'manual') {
            const link = pageButton(ref.page, ref.sourceHash, ref.documentId);
            if (link) details.append(link);
          } else if (/^https:\/\//.test(ref.url || '')) {
            const link = el('a', ref.source === 'web' ? 'Consultar fonte na internet ↗' : 'Consultar fonte oficial ↗');
            link.href = ref.url;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            details.append(link, el('small', ref.license || ''));
          }
          sources.append(details);
          entry = { details, number: entries.size + 1 };
          entries.set(key, entry);
        }
        const citation = el('a', `[${entry.number}]`, 'rule-source-ref');
        citation.href = '#';
        citation.setAttribute('aria-label', `Ver fonte ${entry.number}: ${ref.name}${ref.page ? ', página ' + ref.page : ''}`);
        citation.onclick = (event) => {
          event.preventDefault();
          sources.open = true;
          entry.details.open = true;
          entry.details.scrollIntoView({ block: 'nearest' });
          entry.details.querySelector('summary').focus({ preventScroll: true });
        };
        (part.querySelector('p:last-child') || part).append(el('span', ' '), citation);
      }
      card.append(part);
    }
    sourcesLabel.textContent = `Fontes e trechos utilizados (${entries.size})`;
    if (entries.size) card.append(sources);
    if (answer.insufficient || ['partial', 'web-rate-limit', 'web-not-authorized', 'web-unavailable', 'web-answer-unavailable', 'web-no-match'].includes(answer.external)) card.append(el('p', externalMessage(answer.external), 'muted'));
    if (typeof answer.searchSuggestions === 'string' && answer.searchSuggestions.length <= 24000) {
      const suggestions = el('iframe');
      suggestions.title = 'Sugestões do Google Search';
      suggestions.setAttribute('sandbox', 'allow-popups allow-popups-to-escape-sandbox');
      suggestions.referrerPolicy = 'no-referrer';
      suggestions.style.cssText = 'width:100%;height:150px;border:0;margin-top:12px;background:white';
      suggestions.srcdoc =
        "<!doctype html><meta charset=\"utf-8\"><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; style-src 'unsafe-inline'; img-src https://www.google.com https://www.gstatic.com data:; base-uri 'none'; form-action 'none'\">" +
        answer.searchSuggestions;
      card.append(suggestions);
    }
    return card;
  }
  form.onsubmit = async (event) => {
    event.preventDefault();
    if (controller || !selected || !input.value.trim()) return;
    if (!permitted()) return close();
    const game = getGame();
    if (!game || assistantIdentity(game) !== identity || repository.session.user?.uid !== uid) return close();
    if (!repository.askRules) {
      notice('O assistente precisa de uma conexão com o servidor. A consulta local continua disponível.', 'error');
      return;
    }
    const question = input.value.trim(),
      token = ++revision;
    const turn = startTurn(question);
    controller = new AbortController();
    const control = controller;
    const timeout = setTimeout(() => stop('A pergunta excedeu o tempo de espera. Nenhuma repetição automática foi feita.'), limits.timeoutMs + 5000);
    send.disabled = true;
    cancel.hidden = false;
    notice('Consultando os PDFs. Se faltar informação, pesquisarei na internet…', 'pending');
    turn.scrollIntoView({ block: 'nearest' });
    try {
      const result = await repository.askRules(game, { question, context: selected, conversationId }, { signal: control.signal });
      if (token !== revision || control.signal.aborted || !permitted() || assistantIdentity(getGame()) !== identity || uid !== repository.session.user?.uid) return;
      if (result.status === 'ready' || result.status === 'insufficient') {
        turn.append(answerCard({ ...result.answer, external: result.answer?.external || result.external }, result.cached));
        input.value = '';
        label.firstChild.textContent = 'Pergunta de acompanhamento';
        notice(result.message || '', 'ready');
      } else {
        turn.dataset.failed = 'true';
        notice(result.message || 'Não consegui responder a esta pergunta. A consulta dos PDFs continua disponível.', 'error');
      }
    } catch (error) {
      if (token !== revision || control.signal.aborted) return;
      turn.dataset.failed = 'true';
      notice(`Não consegui responder a esta pergunta. ${error.message || 'O assistente não respondeu. Nenhuma repetição automática foi feita.'}`, 'error');
      if ([401, 403].includes(error.status)) close();
    } finally {
      clearTimeout(timeout);
      if (token === revision) {
        controller = null;
        send.disabled = false;
        cancel.hidden = true;
      }
    }
  };
  function open(result, question = '', trigger, general = false) {
    if (!permitted() || !result.page || !pageButton(result.page, result.sourceHash, result.documentId)) return false;
    const game = getGame(),
      doc = findDocument(game, result.documentId || 'main');
    if (!game || (game.edition && doc?.edition && game.edition !== doc.edition)) return false;
    origin = trigger || document.activeElement;
    uid = repository.session.user.uid;
    identity = assistantIdentity(game);
    selected = { topic: general ? 'Regras do jogo' : String(result.title || 'Regras do jogo').slice(0, 160), documentId: result.documentId || 'main', sourceHash: result.sourceHash, page: result.page };
    heading.textContent = general ? 'Pergunta sobre o jogo' : `Perguntar sobre: ${selected.topic}`;
    contextLabel.textContent = general ? 'Consulta aos documentos compatíveis do jogo.' : `Assunto selecionado no PDF · página ${result.page}.`;
    panel.hidden = false;
    reset();
    input.value = question;
    onOpen();
    input.focus({ preventScroll: true });
    return true;
  }
  return {
    hide() {
      stop(controller ? 'Pergunta cancelada ao voltar para os PDFs.' : '');
      panel.hidden = true;
      onClose();
    },
    ask(question, result) {
      if (!question.trim() || !open(result, question, undefined, true)) return false;
      form.requestSubmit();
      return true;
    },
    action(result) {
      if (!permitted() || !result.page || !pageButton(result.page, result.sourceHash, result.documentId)) return null;
      const game = getGame(),
        doc = findDocument(game, result.documentId || 'main');
      if (game.edition && doc?.edition && game.edition !== doc.edition) return null;
      const action = button('Perguntar ao Gemini', () => {
        const question = getQuestion();
        if (open(result, question, action) && question.trim()) form.requestSubmit();
      });
      action.classList.add('rule-ask');
      return action;
    },
    close,
    updateSession() {
      if (!permitted() || (uid && uid !== repository.session.user?.uid)) close();
    },
    invalidate() {
      close();
    },
  };
}
