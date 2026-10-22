import { libraryFilterDefaults, libraryFacetKeys, libraryFacetOptions } from './library-filter-model.js';

const labels = { players: 'Jogadores', gameType: 'Tipo', category: 'Categoria', mechanic: 'Mecânica', duration: 'Duração', age: 'Idade' };
export function createLibraryFilters({ root, state, onChange }) {
  Object.assign(state, libraryFilterDefaults);
  const controls = Object.fromEntries(libraryFacetKeys.map((key) => [key, root.querySelector(`[data-library-facet="${key}"]`)]));
  const search = root.querySelector('#search'),
    active = root.querySelector('#library-active-filters');
  function reset() {
    Object.assign(state, libraryFilterDefaults);
    search.value = '';
    for (const control of Object.values(controls)) control.value = '';
  }
  function change() {
    onChange();
  }
  for (const [key, control] of Object.entries(controls))
    control.onchange = () => {
      state[key] = control.value;
      change();
    };
  search.oninput = () => {
    state.query = search.value;
    change();
  };
  root.querySelector('#sort').onchange = (event) => {
    state.sort = event.target.value;
    change();
  };
  root.querySelectorAll('#clear-filters,[data-clear-library-filters]').forEach(
    (button) =>
      (button.onclick = () => {
        reset();
        change();
        search.focus();
      }),
  );
  root.querySelectorAll('[data-filter]').forEach(
    (button) =>
      (button.onclick = () => {
        const key = button.dataset.filter;
        if (key === 'all') reset();
        else if (key === 'favorites') state.favoritesOnly = !state.favoritesOnly;
        else if (key === 'quick') state.duration = state.duration === '30' ? '' : '30';
        else if (key === 'solo' || key === 'two') {
          const value = key === 'solo' ? '1' : '2';
          state.players = state.players === value ? '' : value;
        }
        change();
      }),
  );
  function render(games, favorites) {
    const facets = libraryFacetOptions(games, { ...state, favorites });
    for (const [key, control] of Object.entries(controls)) {
      const value = state[key],
        previous = control.value === value ? control.selectedOptions[0]?.dataset.label : '';
      const options = [...facets[key]];
      const fallback =
        key === 'players' ? `${value} ${value === '1' ? 'jogador' : 'jogadores'}` : key === 'age' ? `Até ${value} anos` : key === 'duration' ? { 30: 'Até 30 min', 60: 'Até 1 hora', 120: 'Até 2 horas', long: 'Mais de 2 horas' }[value] : value;
      if (value && !options.some((option) => option.value === value)) options.push({ value, label: previous || fallback, count: 0 });
      control.replaceChildren(new Option(control.dataset.placeholder, ''));
      for (const item of options) {
        const option = new Option(`${item.label} · ${item.count}`, item.value);
        option.dataset.label = item.label;
        control.append(option);
      }
      control.value = value;
    }
    const selected = libraryFacetKeys.filter((key) => state[key]);
    const count = selected.length + Number(state.favoritesOnly);
    root.querySelector('#library-filter-count').textContent = count ? `${count} ${count === 1 ? 'ativo' : 'ativos'}` : '';
    const any = !!count || !!state.query.trim();
    root.querySelector('[data-clear-library-filters]').hidden = !any;
    active.replaceChildren();
    function chip(key, text, remove) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'library-active-chip';
      button.textContent = text + ' ×';
      button.setAttribute('aria-label', `Remover ${text}`);
      button.onclick = () => {
        remove();
        change();
        (controls[key] || search).focus();
      };
      active.append(button);
    }
    if (state.query.trim())
      chip('query', `Busca: ${state.query.trim()}`, () => {
        state.query = '';
        search.value = '';
      });
    for (const key of selected)
      chip(key, `${labels[key]}: ${controls[key].selectedOptions[0].dataset.label}`, () => {
        state[key] = '';
      });
    if (state.favoritesOnly)
      chip('favorites', 'Favoritos', () => {
        state.favoritesOnly = false;
      });
    active.hidden = !any;
    const pressed = { all: !any, favorites: state.favoritesOnly, two: state.players === '2', solo: state.players === '1', quick: state.duration === '30' };
    root.querySelectorAll('[data-filter]').forEach((button) => {
      const selected = !!pressed[button.dataset.filter];
      button.classList.toggle('active', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
  }
  return {
    render,
    reset,
    favorites(value) {
      state.favoritesOnly = value;
      change();
    },
  };
}
