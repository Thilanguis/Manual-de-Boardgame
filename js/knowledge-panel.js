import { knowledgeSummary, verifiedKnowledgeFields } from './knowledge-model.js';
import { observeKnowledge } from './knowledge-observer.js';
const el = (tag, text = '') => {
  const node = document.createElement(tag);
  node.textContent = text;
  return node;
};
export function createKnowledgePanel({ root, repository, onNotice, openManual }) {
  const edits = new Map();
  let game,
    record,
    sequence = 0,
    timer,
    dirty = false,
    active = false,
    observation;
  const button = (text, action) => {
    const node = el('button', text);
    node.type = 'button';
    node.className = 'button secondary small';
    node.onclick = async () => {
      const token = sequence;
      node.disabled = true;
      try {
        await action();
      } catch (error) {
        if (token === sequence) onNotice(error.message);
      } finally {
        node.disabled = false;
      }
    };
    return node;
  };
  async function load() {
    if (!active || !game) return;
    if (!observation) {
      const token = sequence;
      observation = observeKnowledge(repository, game, {
        onRecord(next) {
          if (token !== sequence || !active || !repository.session.canEdit || !repository.session.canRead) return;
          if (!dirty) {
            record = next;
            render();
          }
        },
        onError(error) {
          if (active && token === sequence) onNotice(error.message);
        },
      });
    }
    await observation.refresh();
  }
  function render() {
    root.replaceChildren();
    if (!game || !repository.session.canEdit || !repository.session.canRead) return;
    const summary = knowledgeSummary(record, game);
    const label = el('p', record?.message || (summary.sections.length ? 'Conhecimento disponível.' : 'Aguardando a análise dos manuais.'));
    label.className = 'knowledge-status';
    label.setAttribute('role', 'status');
    root.append(label);
    if (summary.sections.length) {
      const info = el('p', `${summary.sections.length} assuntos identificados · ${summary.documents.length} ${summary.documents.length === 1 ? 'documento analisado' : 'documentos analisados'}`);
      if (summary.analyzedAt) info.append(document.createTextNode(` · ${new Date(summary.analyzedAt).toLocaleString('pt-BR')}`));
      root.append(info);
    }
    if (!['pending_configuration', 'pending_authorization'].includes(record?.status)) {
      const update = button('Atualizar conhecimento com IA', async () => {
        if (!confirm('Analisar novamente os manuais? Isso utiliza a cota de IA. Suas correções serão preservadas.')) return;
        if (dirty && !confirm('Descartar alterações ainda não salvas?')) return;
        const token = sequence,
          target = game;
        clearTimeout(timer);
        edits.clear();
        dirty = false;
        try {
          const next = await repository.generateKnowledge(target, { force: true });
          if (token !== sequence) return;
          record = next;
        } catch (error) {
          if (token !== sequence) return;
          if (error.record?.status !== 'quota') throw error;
          record = error.record;
        }
        render();
        observation?.update(record);
      });
      const cooldown = record?.status === 'quota' && record.retryAt > Date.now();
      update.disabled = record?.status === 'running' || cooldown;
      root.append(update);
      if (cooldown) {
        root.append(el('p', `Nova tentativa disponível em ${new Date(record.retryAt).toLocaleString('pt-BR')}.`));
        clearTimeout(timer);
        timer = setTimeout(
          () => {
            if (game) render();
          },
          Math.min(record.retryAt - Date.now() + 50, 2147483647),
        );
      }
    }
    if (summary.limitations.length) {
      const limitations = el('details');
      limitations.append(el('summary', 'Limitações da análise'));
      for (const text of summary.limitations) limitations.append(el('p', text));
      root.append(limitations);
    }
    if (!record?.knowledge) return;
    const knowledge = { ...record.knowledge, fields: verifiedKnowledgeFields(record.knowledge, game) };
    const details = el('details');
    details.className = 'knowledge-details';
    details.append(el('summary', 'Ver assuntos e corrigir informações'), el('p', 'Explicações por IA, com referências ao manual. Não são uma reprodução oficial das regras.'));
    for (const section of summary.sections) {
      const row = el('details');
      row.className = 'knowledge-section';
      row.dataset.knowledgeSection = section.id;
      row.append(el('summary', section.title));
      const text = el('textarea');
      text.value = edits.get(section.id) ?? section.text;
      text.maxLength = 6000;
      text.setAttribute('aria-label', `Texto: ${section.title}`);
      text.oninput = () => {
        dirty = true;
        edits.set(section.id, text.value);
      };
      row.append(
        text,
        button('Salvar correção', async () => {
          if (!text.value.trim()) throw new Error('Escreva a informação corrigida.');
          const token = sequence;
          const next = await repository.reviewKnowledge(game, record.revision, [{ id: section.id, text: text.value, review: 'manual' }]);
          if (token !== sequence || !repository.session.canRead || !repository.session.canEdit) return;
          record = next;
          edits.delete(section.id);
          dirty = edits.size > 0;
          render();
        }),
      );
      const source = knowledge.sources.find((source) => source.id === section.sourceId);
      if (section.review === 'manual') row.append(el('small', 'Correção manual preservada'));
      if (source?.pages) {
        row.append(el('small', `${source.name} · página ${section.page}`), el('blockquote', section.quote));
        if (openManual) row.append(button('Abrir página do manual', () => openManual(game, { page: section.page, documentId: section.documentId, sourceHash: section.sourceHash })));
      } else if (/^https:\/\//.test(source?.url || '')) {
        const link = el('a', `${source.name} · ${source.license} ↗`);
        link.href = source.url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        row.append(link, el('blockquote', section.quote));
      }
      details.append(row);
    }
    root.append(details);
  }
  return {
    async refresh() {
      if (!active || !game || dirty || !repository.session.canRead || !repository.session.canEdit) return;
      clearTimeout(timer);
      try {
        await load();
      } catch (error) {
        onNotice(error.message);
      }
    },
    open(next) {
      if (active && game?.id === next.id && dirty) return;
      observation?.close();
      observation = null;
      active = true;
      if (game?.id !== next.id) {
        edits.clear();
        dirty = false;
        record = null;
      }
      game = next;
      ++sequence;
      clearTimeout(timer);
      if (!dirty) root.replaceChildren(el('p', 'Carregando conhecimento…'));
      const token = sequence;
      void load().catch((error) => {
        if (token === sequence) root.replaceChildren(el('p', error.message));
      });
    },
    suspend() {
      active = false;
      ++sequence;
      clearTimeout(timer);
      observation?.close();
      observation = null;
    },
    close() {
      this.suspend();
      game = record = null;
      edits.clear();
      dirty = false;
      root.replaceChildren();
    },
    isBusy: () => dirty,
  };
}
