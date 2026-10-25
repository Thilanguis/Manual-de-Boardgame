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
  })[status] || '';

// Conversa privada em memória da tela; o servidor controla o cache e o orçamento.
export function createRuleAssistantPanel({ repository, container, getGame, pageButton }) {
  const panel = el('section', '', 'rule-assistant');
  panel.hidden = true;
  panel.setAttribute('aria-label', 'Assistente contextual de regras');
  const heading = el('h3'),
    contextLabel = el('p', '', 'muted'),
    transcript = el('div', '', 'rule-conversation');
  const status = el('p');
  status.setAttribute('role', 'status');
  const usage = el('small', '', 'rule-assistant-usage');
  const form = el('form'),
    label = el('label', 'Sua pergunta sobre este assunto');
  const input = el('textarea');
  input.rows = 3;
  input.maxLength = limits.question;
  label.append(input);
  const send = el('button', 'Perguntar ao Gemini', 'button primary small');
  send.type = 'submit';
  const cancel = button('Cancelar pergunta', () => stop('Pergunta cancelada. Nenhuma repetição automática será feita.'));
  cancel.hidden = true;
  const actions = el('div', '', 'rule-assistant-actions');
  actions.append(send, cancel);
  form.append(label, actions);
  panel.append(
    heading,
    contextLabel,
    button('Fechar assistente', () => close()),
    transcript,
    status,
    usage,
    form,
    button('Nova conversa', () => reset()),
  );
  container.append(panel);
  let selected,
    conversationId,
    identity,
    uid,
    controller,
    revision = 0,
    origin;
  const permitted = () => repository.session.canRead && repository.session.canAskRules && !!repository.session.user?.uid;
  function stop(message = '') {
    revision++;
    controller?.abort();
    controller = null;
    send.disabled = false;
    cancel.hidden = true;
    status.textContent = message;
  }
  function reset() {
    stop();
    conversationId = crypto.randomUUID();
    transcript.replaceChildren();
    usage.textContent = '';
    input.value = '';
    input.focus();
  }
  function close() {
    stop();
    panel.hidden = true;
    transcript.replaceChildren();
    input.value = '';
    selected = null;
    origin?.focus({ preventScroll: true });
  }
  function displayUsage(value) {
    if (!value) return;
    usage.textContent = `Perguntas hoje (UTC): ${value.used}/${value.limit} nesta conta · ${value.applicationUsed}/${value.applicationLimit} no Acervo. Orçamento exclusivo do assistente; saldo do provedor não informado.`;
  }
  function answerCard(answer, cached) {
    const card = el('article', '', 'rule-assistant-answer');
    card.append(el('h4', cached ? 'Explicação reutilizada' : 'Explicação do Gemini'));
    if (answer.insufficient) card.append(el('p', 'As evidências não permitem responder completamente. Confira os documentos originais.', 'rule-notice'));
    for (const block of answer.blocks || []) {
      const part = el('div', '', `rule-answer-block rule-answer-${block.kind}`);
      const title = { exception: 'Exceção', example: 'Exemplo', conflict: 'Divergência entre fontes' }[block.kind];
      if (title) part.append(el('h4', title));
      renderRuleReading(part, block.text);
      for (const ref of block.citations || []) {
        const details = el('details', '', 'rule-citation');
        details.append(el('summary', ref.source === 'manual' ? `${ref.name} · página ${ref.page}` : `${ref.name} · fonte oficial externa`), el('blockquote', ref.quote));
        if (ref.source === 'manual') {
          const link = pageButton(ref.page, ref.sourceHash, ref.documentId);
          if (link) details.append(link);
        } else if (/^https:\/\//.test(ref.url || '')) {
          const link = el('a', 'Consultar fonte oficial ↗');
          link.href = ref.url;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          details.append(link, el('small', ref.license || ''));
        }
        part.append(details);
      }
      card.append(part);
    }
    card.append(el('p', externalMessage(answer.external), 'muted'));
    transcript.append(card);
  }
  form.onsubmit = async (event) => {
    event.preventDefault();
    if (controller || !selected || !input.value.trim()) return;
    if (!permitted()) return close();
    const game = getGame();
    if (!game || assistantIdentity(game) !== identity || repository.session.user?.uid !== uid) return close();
    if (!repository.askRules) {
      status.textContent = 'O assistente precisa de uma conexão com o servidor. A consulta local continua disponível.';
      return;
    }
    const question = input.value.trim(),
      token = ++revision;
    controller = new AbortController();
    const control = controller;
    const timeout = setTimeout(() => stop('A pergunta excedeu o tempo de espera. Nenhuma repetição automática foi feita.'), limits.timeoutMs + 5000);
    send.disabled = true;
    cancel.hidden = false;
    status.textContent = 'Conferindo trechos compatíveis e preparando a explicação…';
    try {
      const result = await repository.askRules(game, { question, context: selected, conversationId }, { signal: control.signal });
      if (token !== revision || control.signal.aborted || !permitted() || assistantIdentity(getGame()) !== identity || uid !== repository.session.user?.uid) return;
      if (result.status === 'ready' || result.status === 'insufficient') {
        transcript.append(el('p', question, 'rule-question'));
        answerCard({ ...result.answer, external: result.answer?.external || result.external }, result.cached);
        input.value = '';
        status.textContent = result.message || 'Confira a explicação e suas fontes. Você pode fazer uma pergunta de acompanhamento.';
      } else status.textContent = result.message || 'O assistente não pôde responder. A consulta tradicional continua disponível.';
      displayUsage(result.usage);
    } catch (error) {
      if (token !== revision || control.signal.aborted) return;
      status.textContent = error.message || 'O assistente não respondeu. Nenhuma repetição automática foi feita.';
      displayUsage(error.usage);
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
  function open(result, question = '', trigger) {
    if (!permitted() || !result.page || !pageButton(result.page, result.sourceHash, result.documentId)) return false;
    const game = getGame(),
      doc = findDocument(game, result.documentId || 'main');
    if (!game || (game.edition && doc?.edition && game.edition !== doc.edition)) return false;
    origin = trigger || document.activeElement;
    uid = repository.session.user.uid;
    identity = assistantIdentity(game);
    selected = { topic: String(result.title || 'Regras do jogo').slice(0, 160), documentId: result.documentId || 'main', sourceHash: result.sourceHash, page: result.page };
    heading.textContent = `Perguntar sobre: ${selected.topic}`;
    contextLabel.textContent = `${game.title}${game.edition ? ' · ' + game.edition : ''} · ${result.documentName || 'Manual'} · página ${result.page}. Até quatro perguntas por conversa; somente trechos selecionados são enviados.`;
    panel.hidden = false;
    reset();
    input.value = question;
    panel.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
    return true;
  }
  return {
    ask(question, result) {
      if (!question.trim() || !open(result, question)) return false;
      form.requestSubmit();
      return true;
    },
    action(result) {
      if (!permitted() || !result.page || !pageButton(result.page, result.sourceHash, result.documentId)) return null;
      const game = getGame(),
        doc = findDocument(game, result.documentId || 'main');
      if (game.edition && doc?.edition && game.edition !== doc.edition) return null;
      const action = button('Perguntar ao Gemini', () => {
        open(result, '', action);
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
