import { vocabularyTerm } from './game-vocabulary.js';
const el = (tag, text) => {
  const e = document.createElement(tag);
  if (text) e.textContent = text;
  return e;
};
export function createKnowledgePanel({ root, repository, onUseFields, onNotice }) {
  const edits = new Map();
  let game,
    record,
    sequence = 0,
    timer,
    dirty = false;
  const button = (text, action) => {
    const b = el('button', text);
    b.type = 'button';
    b.className = 'button secondary small';
    b.onclick = async () => {
      b.disabled = true;
      try {
        await action();
      } catch (error) {
        onNotice(error.message);
      } finally {
        b.disabled = false;
      }
    };
    return b;
  };
  async function load() {
    const token = sequence;
    const next = repository.getKnowledge ? await repository.getKnowledge(game) : { status: 'pending_configuration', message: 'A geração aguarda a conexão da IA.' };
    if (token !== sequence || !repository.session.canEdit || !repository.session.canRead) return;
    if (!dirty) {
      record = next;
      render();
    }
    if (next?.status === 'running') timer = setTimeout(() => void load().catch((e) => onNotice(e.message)), 2500);
  }
  function render() {
    root.replaceChildren();
    if (!game || !repository.session.canEdit) return;
    const label = el('p', record?.message || (record?.knowledge ? 'Conhecimento do jogo' : 'Ainda não há conhecimento gerado.'));
    label.className = 'knowledge-status';
    label.setAttribute('role', 'status');
    root.append(label);
    if (record?.status === 'pending_configuration') return;
    const actions = el('div');
    actions.className = 'knowledge-actions';
    const generate = button(record?.knowledge ? 'Atualizar conhecimento com IA' : 'Gerar conhecimento com IA', async () => {
      if (!repository.generateKnowledge) throw new Error('Conecte a IA para gerar o conhecimento.');
      if (dirty && !confirm('Descartar alterações não salvas nesta revisão?')) return;
      if (record?.knowledge && !confirm('Gerar novas sugestões? Os textos já revisados serão preservados.')) return;
      dirty = false;
      edits.clear();
      record = await repository.generateKnowledge(game, { force: true });
      render();
      clearTimeout(timer);
      if (record.status === 'running') timer = setTimeout(() => void load().catch((e) => onNotice(e.message)), 1000);
    });
    generate.disabled = ['running', 'pending_configuration'].includes(record?.status);
    if (record?.status === 'pending_configuration') generate.title = 'O proprietário precisa configurar a conexão da IA.';
    actions.append(generate);
    root.append(actions);
    if (record?.diagnostics?.length) {
      const details = el('details');
      details.append(el('summary', 'Detalhes da geração'));
      for (const result of record.diagnostics) details.append(el('p', `${result.source === 'wikidata' ? 'Wikidata' : 'Wikipédia'}: ${result.state === 'failed' ? 'indisponível' : `${result.count} correspondência(s)`}`));
      root.append(details);
    }
    if (!record?.knowledge) return;
    const knowledge = record.knowledge;
    root.append(el('p', 'Conteúdo gerado por IA. Confira as fontes antes de aceitar ou publicar.'));
    const fields = Object.entries(knowledge.fields || {});
    if (fields.length) {
      const suggestions = el('details');
      suggestions.append(el('summary', 'Sugestões para o cadastro'), el('p', 'Dados gerais da obra. Confirme a edição e os campos antes de salvar.'));
      const choices = [],
        labels = {
          description: 'Resumo',
          minPlayers: 'Jogadores mínimos',
          maxPlayers: 'Jogadores máximos',
          minDurationMinutes: 'Duração mínima (min)',
          maxDurationMinutes: 'Duração máxima (min)',
          recommendedAge: 'Idade',
          tags: 'Categorias',
          mechanics: 'Mecânicas',
          gameType: 'Tipo de jogo',
        };
      for (const [key, fact] of fields) {
        const label = el('label'),
          input = el('input');
        input.type = 'checkbox';
        input.dataset.knowledgeField = key;
        const value = Array.isArray(fact.value) ? fact.value.join(', ') : String(fact.value);
        label.append(input, document.createTextNode(`${labels[key] || key}: ${value.slice(0, 150)}${fact.generated ? ' · IA, conferir' : ''}`));
        suggestions.append(label);
        choices.push({ input, key, fact });
      }
      const all = el('label'),
        select = el('input');
      select.type = 'checkbox';
      select.onchange = () =>
        choices.forEach((c) => {
          c.input.checked = select.checked;
        });
      all.append(select, document.createTextNode('Selecionar todos'));
      suggestions.append(
        all,
        button('Usar campos selecionados', () => {
          const values = Object.fromEntries(
            choices.filter((c) => c.input.checked).map((c) => [c.key, c.key === 'tags' || c.key === 'mechanics' ? c.fact.value.map((v) => vocabularyTerm(v)) : c.key === 'gameType' ? vocabularyTerm(c.fact.value) : c.fact.value]),
          );
          if (!Object.keys(values).length) throw new Error('Selecione as informações que deseja usar.');
          if (confirm('Levar os campos selecionados para a edição? Eles substituirão os valores correspondentes no formulário, após sua confirmação.')) onUseFields(values, knowledge);
        }),
      );
      root.append(suggestions);
    }
    for (const section of knowledge.sections) {
      const row = el('details');
      row.className = 'knowledge-section';
      row.dataset.knowledgeSection = section.id;
      row.append(el('summary', section.title));
      const text = el('textarea');
      text.value = edits.get(section.id)?.text ?? section.text;
      text.maxLength = 6000;
      text.setAttribute('aria-label', `Texto: ${section.title}`);
      const review = el('select');
      review.setAttribute('aria-label', `Revisão: ${section.title}`);
      for (const [value, name] of Object.entries({ unreviewed: 'Não confirmado', accepted: 'Aceitar informação', manual: 'Texto corrigido', rejected: 'Rejeitar informação' })) {
        const o = el('option', name);
        o.value = value;
        o.selected = value === (edits.get(section.id)?.review ?? section.review);
        review.append(o);
      }
      text.oninput = review.onchange = () => {
        dirty = true;
        edits.set(section.id, { text: text.value, review: review.value });
      };
      row.append(
        text,
        review,
        button('Salvar revisão', async () => {
          record = await repository.reviewKnowledge(game, record.revision, [{ id: section.id, text: text.value, review: review.value }]);
          edits.delete(section.id);
          dirty = edits.size > 0;
          render();
        }),
      );
      const source = knowledge.sources.find((s) => s.id === section.sourceId);
      if (source) {
        const reference = el('a', `${source.name} · ${source.license} ↗`);
        reference.href = source.url;
        reference.target = '_blank';
        reference.rel = 'noopener noreferrer';
        row.append(reference, el('blockquote', section.quote));
      }
      root.append(row);
    }
    const sources = el('details');
    sources.append(el('summary', 'Fontes e informações não confirmadas'));
    for (const source of knowledge.sources) {
      const a = el('a', `${source.name} · ${source.language} · ${source.license} ↗`);
      a.href = source.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      const p = el('p');
      p.append(a);
      sources.append(p);
    }
    for (const missing of knowledge.unconfirmed) sources.append(el('p', missing));
    root.append(sources);
  }
  return {
    open(next) {
      if (game?.id === next.id && dirty) return;
      if (game?.id !== next.id) {
        edits.clear();
        dirty = false;
        record = null;
      }
      game = next;
      ++sequence;
      clearTimeout(timer);
      root.replaceChildren(el('p', 'Carregando conhecimento…'));
      void load().catch((error) => {
        root.replaceChildren(el('p', error.message));
      });
    },
    close() {
      edits.clear();
      ++sequence;
      clearTimeout(timer);
      game = record = null;
      dirty = false;
      root.replaceChildren();
    },
    isBusy: () => dirty,
  };
}
