import { metadataKeys, metadataUpdates } from './metadata-consolidation.js';
import { sourceNames, fieldLabels } from './research-client.js';
import { factSignature } from './research-knowledge.js';

const text = (tag, value) => {
  const el = document.createElement(tag);
  el.textContent = value;
  return el;
};
const display = (value) => (Array.isArray(value) ? value.join(', ') : String(value ?? ''));
const originsFor = (fact) => (fact.origins?.length ? fact.origins.flatMap(originsFor) : [fact]);
const originLabel = (origins) => [...new Set(origins.map((fact) => sourceNames[fact.source] || fact.source))].join(' · ');
function attachOrigin(input, helper) {
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

// A ficha existente é a revisão. Não há uma segunda lista de campos aprováveis.
export function createMetadataForm({ form, getCurrent, apply, onManualEdit = () => {} }) {
  let model = null,
    automatic = {},
    dirty = new Set(),
    cancelConfirmation = null;
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
    if (!metadataKeys.includes(event.target.name) && event.target.name !== 'language') return;
    dirty.add(event.target.name);
    onManualEdit(event.target.name, event.target.value);
    render();
  });
  form.addEventListener('change', (event) => {
    const pairs = { minDurationMinutes: 'maxDurationMinutes', maxDurationMinutes: 'minDurationMinutes' };
    const other = form.elements.namedItem(pairs[event.target.name] || '');
    const value = Number(event.target.value);
    if (!other || other.value !== '' || !event.target.value || !Number.isInteger(value) || value < 1 || value > 1440) return;
    other.value = String(value);
    other.dispatchEvent(new Event('input', { bubbles: true }));
  });
  function render() {
    cancelConfirmation?.();
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
    const count = Object.keys(automatic).filter((key) => !protectedField(key) && factSignature(current[key]) === factSignature(automatic[key])).length;
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
      const requiresDecision = needed.includes(key);
      if (requiresDecision && !grouped.includes(key)) continue;
      helper.classList.toggle('metadata-conflict', requiresDecision);
      const origin = model.fieldSources[key];
      const same = factSignature(current[key]) === factSignature(model.fields[key]);
      const hasSuggestion = !requiresDecision && facts.some((fact) => factSignature(current[key]) !== factSignature(fact.value)) && (protectedField(key) || !same);
      helper.classList.toggle('metadata-suggestion', hasSuggestion);
      const selectedOrigins = facts.filter((fact) => factSignature(fact.value) === factSignature(model.fields[key])).flatMap(originsFor);
      const originText = originLabel(selectedOrigins.length ? selectedOrigins : originsFor(origin));
      const reference = origin.evidence?.page ? `, página ${origin.evidence.page}` : '';
      helper.append(
        text(
          'summary',
          requiresDecision
            ? `${fieldLabels[key]} · escolha o valor`
            : protectedField(key)
              ? hasSuggestion ? 'Sua correção foi preservada · sugestão diferente disponível' : 'Sua correção foi preservada · ver fontes'
              : !same
                ? `Sugestão disponível · origem: ${originText}${reference}`
                : `Origem: ${originText}${reference}${['consistent', 'consensus'].includes(model.consistency[key]) ? ' · fontes concordam' : model.consistency[key] === 'manual-preferred' ? ' · manual desta edição' : ''}`,
        ),
      );
      const unique = facts.filter((f, i) => facts.findIndex((other) => factSignature(f.value) === factSignature(other.value)) === i);
      for (const fact of unique) {
        const row = text('div', ''),
          origins = facts
            .filter((f) => factSignature(f.value) === factSignature(fact.value))
            .flatMap(originsFor)
            .filter((f, i, all) => all.findIndex((other) => other.source === f.source && other.id === f.id && other.evidence?.page === f.evidence?.page && other.url === f.url) === i);
        if (hasSuggestion && factSignature(current[key]) !== factSignature(fact.value)) {
          row.className = 'metadata-alternative';
          const badge = text('strong', 'Sugestão diferente do valor atual');
          badge.className = 'metadata-alternative-label';
          row.append(badge);
        }
        row.append(text('p', display(fact.value)));
        for (const source of origins) {
          row.append(
            text(
              'small',
              `${sourceNames[source.source] || source.source}${source.evidence?.page ? ` · página ${source.evidence.page}` : ''}${source.source === 'gemini-model' ? ' · sem fonte externa verificada' : source.editionUnconfirmed ? ' · edição não confirmada pela fonte' : ''}`,
            ),
          );
          for (const [label, url] of [
            ['Consultar fonte', source.url],
            ['Licença', source.licenseUrl],
            ['Autores e histórico', source.authorsUrl],
          ]) {
            if (!String(url || '').startsWith('https://')) continue;
            const link = text('a', label + ' ↗');
            link.href = url;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            row.append(link);
          }
          if (source.license) row.append(text('small', source.license));
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
            const accept = () => {
              for (const k of Object.keys(values)) dirty.add(k);
              apply(values, { ...model, fieldSources }, { automatic: false });
              render();
              input.focus({ preventScroll: true });
            };
            if (!Object.keys(values).some((k) => protectedField(k) && display(latest[k]) !== display(values[k]))) {
              accept();
              return;
            }
            cancelConfirmation?.();
            const confirmation = text('section', '');
            confirmation.className = 'metadata-confirmation';
            confirmation.dataset.metadataConfirmation = '';
            confirmation.setAttribute('role', 'group');
            confirmation.setAttribute('aria-label', 'Confirmar substituição da sua correção');
            confirmation.append(text('strong', 'Substituir sua correção?'), text('p', 'Confira a troca antes de aplicar. Os demais campos serão mantidos.'));
            const comparison = text('dl', '');
            for (const k of Object.keys(values)) {
              comparison.append(text('dt', fieldLabels[k]), text('dd', `Atual: ${display(latest[k]) || 'Não informado'}`), text('dd', `Novo: ${display(values[k])}`));
            }
            const actions = text('div', '');
            actions.className = 'metadata-confirmation-actions';
            const keep = text('button', 'Manter como está'),
              replace = text('button', Object.keys(values).length > 1 ? 'Substituir valores' : 'Substituir valor');
            keep.type = replace.type = 'button';
            keep.className = 'button secondary small';
            replace.className = 'button primary small';
            cancelConfirmation = () => {
              confirmation.remove();
              button.hidden = false;
              cancelConfirmation = null;
            };
            keep.onclick = () => {
              cancelConfirmation();
              button.focus({ preventScroll: true });
            };
            replace.onclick = accept;
            confirmation.addEventListener('keydown', (event) => {
              if (event.key !== 'Escape') return;
              event.preventDefault();
              event.stopPropagation();
              keep.click();
            });
            actions.append(keep, replace);
            confirmation.append(comparison, actions);
            row.append(confirmation);
            button.hidden = true;
            keep.focus({ preventScroll: true });
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
      attachOrigin(input, helper);
    }
    // O idioma pertence ao PDF, não aos metadados dos catálogos/Gemini.
    const language = form.elements.namedItem('language');
    if (language && (protectedField('language') || (current.language !== 'other' && /^PDF/i.test(current.sources?.language?.source || '')))) {
      const helper = text('details', '');
      helper.className = 'metadata-origin';
      helper.dataset.metadataField = 'language';
      helper.append(text('summary', protectedField('language') ? 'Sua correção foi preservada · ver origem' : 'Origem: PDF · idioma sugerido pelo texto do manual'));
      helper.append(text('small', protectedField('language') ? 'O idioma que você informou tem prioridade.' : 'Identificação automática do texto do PDF. Confira e corrija se necessário.'));
      attachOrigin(language, helper);
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
