import { metadataKeys, metadataUpdates } from './metadata-consolidation.js';
import { sourceNames, fieldLabels } from './research-client.js';
import { factSignature } from './research-knowledge.js';

const text = (tag, value) => {
  const el = document.createElement(tag);
  el.textContent = value;
  return el;
};
const display = (value) => (Array.isArray(value) ? value.join(', ') : String(value ?? ''));

// A ficha existente é a revisão. Não há uma segunda lista de campos aprováveis.
export function createMetadataForm({ form, getCurrent, apply, onManualEdit = () => {} }) {
  let model = null,
    automatic = {},
    dirty = new Set();
  const protectedField = (key) => {
    const current = getCurrent(),
      field = ['minPlayers', 'maxPlayers'].includes(key) ? 'players' : ['minDurationMinutes', 'maxDurationMinutes'].includes(key) ? 'duration' : key;
    const origin = current?.sources?.[field];
    return dirty.has(key) || origin?.confirmedAt || /conferido|corrigido|ajustado por voc/i.test(origin?.source || '');
  };
  const unresolved = () => metadataKeys.filter((key) => model?.consistency[key] === 'conflict' && !protectedField(key));
  form.addEventListener('input', (event) => {
    if (event.target.matches('[data-metadata-title]')) {
      form.elements.namedItem('title').value = event.target.value;
      dirty.add('title');
      form.elements.namedItem('title').dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    if (!metadataKeys.includes(event.target.name)) return;
    dirty.add(event.target.name);
    onManualEdit(event.target.name, event.target.value);
    render();
  });
  function render() {
    form.querySelectorAll('[data-metadata-field]').forEach((el) => el.remove());
    form.querySelector('[data-metadata-review]')?.remove();
    const current = getCurrent();
    if (current) for (const mirror of form.querySelectorAll('[data-metadata-title]')) mirror.value = current.title;
    if (!model || !current) return;
    const needed = unresolved(),
      grouped = needed.filter((key) => !(key === 'maxPlayers' && needed.includes('minPlayers')) && !(key === 'maxDurationMinutes' && needed.includes('minDurationMinutes')));
    const review = text('section', '');
    review.dataset.metadataReview = '';
    review.className = 'metadata-review';
    const count = Object.keys(automatic).filter((key) => factSignature(current[key]) === factSignature(automatic[key])).length;
    if (count || grouped.length)
      review.append(
        text(
          'p',
          `${count} ${count === 1 ? 'informação preenchida' : 'informações preenchidas'} automaticamente.${grouped.length ? ` ${grouped.length} ${grouped.length === 1 ? 'divergência precisa' : 'divergências precisam'} de sua confirmação.` : ''}`,
        ),
      );
    const target = form.querySelector('[data-game-step="2"] h3') || form.querySelector('[data-game-step="2"]');
    if (target) target.after(review);
    for (const key of metadataKeys) {
      const input = key === 'title' ? form.querySelector('[data-metadata-title]') || form.elements.namedItem(key) : form.elements.namedItem(key),
        facts = model.alternatives[key];
      if (!input || !facts?.length) continue;
      const helper = text('details', '');
      helper.dataset.metadataField = key;
      helper.className = 'metadata-origin';
      const conflict = model.consistency[key] === 'conflict';
      const requiresDecision = needed.includes(key);
      if (requiresDecision && !grouped.includes(key)) continue;
      helper.classList.toggle('metadata-conflict', conflict);
      const origin = model.fieldSources[key];
      const same = factSignature(current[key]) === factSignature(model.fields[key]);
      helper.append(
        text(
          'summary',
          requiresDecision
            ? `${fieldLabels[key]} · escolha o valor`
            : dirty.has(key)
              ? 'Sua edição foi preservada · ver fontes'
              : ['consistent', 'consensus'].includes(model.consistency[key])
                ? 'Fontes concordam · ver alternativas'
                : model.consistency[key] === 'manual-preferred'
                  ? 'Manual desta edição · ver alternativas'
                  : !same
                    ? 'Sugestão disponível · ver origem'
                    : `Origem: ${origin.origins?.length > 1 ? 'fontes reunidas' : sourceNames[origin.source] || origin.source}`,
        ),
      );
      const unique = facts.filter((f, i) => facts.findIndex((other) => factSignature(f.value) === factSignature(other.value)) === i);
      for (const fact of unique) {
        const row = text('div', ''),
          origins = fact.origins || facts.filter((f) => factSignature(f.value) === factSignature(fact.value)),
          label = [...new Set(origins.map((f) => sourceNames[f.source] || f.source))].join(' · ');
        row.append(text('p', display(fact.value)), text('small', `${label}${fact.evidence?.page ? ` · página ${fact.evidence.page}` : ''}${fact.editionUnconfirmed ? ' · edição não confirmada pela fonte' : ''}`));
        if (fact.url && /^https:\/\//.test(fact.url)) {
          const link = text('a', 'Consultar fonte ↗');
          link.href = fact.url;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          row.append(link);
        }
        if (fact.license) row.append(text('small', fact.license));
        for (const [label, url] of [
          ['Licença', fact.licenseUrl],
          ['Autores e histórico', fact.authorsUrl],
        ]) {
          if (!String(url || '').startsWith('https://')) continue;
          const link = text('a', label + ' ↗');
          link.href = url;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          row.append(link);
        }
        if (requiresDecision || factSignature(current[key]) !== factSignature(fact.value)) {
          const button = text('button', 'Usar este valor');
          button.type = 'button';
          button.className = 'text-button';
          button.setAttribute('aria-label', `Usar ${fieldLabels[key]}: ${display(fact.value)}`);
          button.onclick = () => {
            const values = { [key]: fact.value },
              fieldSources = { ...model.fieldSources, [key]: fact };
            // Mínimo e máximo são uma escolha indivisível da mesma fonte.
            const pair = [
              ['minPlayers', 'maxPlayers'],
              ['minDurationMinutes', 'maxDurationMinutes'],
            ].find((p) => p.includes(key));
            for (const other of pair || []) {
              const match = model.alternatives[other]?.find((f) => f.source === fact.source && f.id === fact.id);
              if (match) {
                values[other] = match.value;
                fieldSources[other] = match;
              }
            }
            const latest = getCurrent();
            if (Object.keys(values).some((k) => protectedField(k) && display(latest[k]) !== display(values[k])) && !confirm('Substituir os valores que você já conferiu?')) return;
            for (const k of Object.keys(values)) dirty.add(k);
            apply(values, { ...model, fieldSources }, { automatic: false });
            render();
          };
          row.append(button);
        }
        helper.append(row);
      }
      if (requiresDecision) {
        helper.open = true;
        review.append(helper);
        continue;
      }
      // Não colocar controles interativos dentro de labels de inputs.
      const label = input.closest('label');
      let wrapper = label.parentElement;
      if (!wrapper.classList.contains('field-with-origin')) {
        wrapper = text('div', '');
        wrapper.className = 'field-with-origin';
        label.before(wrapper);
        wrapper.append(label);
      }
      wrapper.append(helper);
    }
  }
  return {
    unresolved,
    update(next) {
      model = next;
      const current = getCurrent();
      if (current) {
        const removed = {};
        for (const [key, value] of Object.entries(automatic)) {
          if (Object.hasOwn(next?.fields || {}, key) && next.consistency?.[key] !== 'conflict') continue;
          if (!protectedField(key) && factSignature(current[key]) === factSignature(value)) removed[key] = ['tags', 'mechanics'].includes(key) ? [] : ['title', 'description', 'edition', 'gameType'].includes(key) ? '' : null;
          delete automatic[key];
        }
        if (Object.keys(removed).length) apply(removed, next || { fields: {}, fieldSources: {}, alternatives: {}, consistency: {} }, { automatic: true, retract: true });
      }
      if (!next || !getCurrent()) {
        render();
        return;
      }
      const values = metadataUpdates(next, getCurrent(), dirty, automatic);
      if (Object.keys(values).length) {
        apply(values, next, { automatic: true });
        Object.assign(automatic, values);
      }
      render();
    },
    refresh: render,
    reset() {
      model = null;
      automatic = {};
      dirty = new Set();
      render();
    },
  };
}
