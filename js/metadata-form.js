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
    const current = getCurrent();
    if (current) for (const mirror of form.querySelectorAll('[data-metadata-title]')) mirror.value = current.title;
    if (!model || !current) return;
    for (const key of metadataKeys) {
      const input = key === 'title' ? form.querySelector('[data-metadata-title]') || form.elements.namedItem(key) : form.elements.namedItem(key),
        facts = model.alternatives[key];
      if (!input || !facts?.length) continue;
      const helper = text('details', '');
      helper.dataset.metadataField = key;
      helper.className = 'metadata-origin';
      const conflict = model.consistency[key] === 'conflict';
      helper.classList.toggle('metadata-conflict', conflict);
      const origin = model.fieldSources[key];
      const same = factSignature(current[key]) === factSignature(model.fields[key]);
      helper.append(
        text(
          'summary',
          conflict
            ? 'Valores diferentes · conferir'
            : dirty.has(key)
              ? 'Sua edição foi preservada · ver fontes'
              : model.consistency[key] === 'consistent'
                ? 'Fontes concordam'
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
        if (factSignature(current[key]) !== factSignature(fact.value)) {
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
            if (Object.keys(values).some((k) => latest[k] != null && latest[k] !== '' && display(latest[k]) !== display(values[k])) && !confirm('Substituir esses valores no formulário?')) return;
            for (const k of Object.keys(values)) dirty.add(k);
            apply(values, { ...model, fieldSources }, { automatic: false });
            render();
          };
          row.append(button);
        }
        helper.append(row);
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
    update(next) {
      model = next;
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
