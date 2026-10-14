import { APP_CONFIG } from '../config/app-config.js';
import { filterGames, playersLabel, validateGame, safeImageUrl } from './model.js';
import { inspectPdf, imageToJpeg } from './pdf.js';
import { createReader } from './reader.js';
import { setupPwa } from './pwa.js';
import { createAdminPanel } from './admin-panel.js';
import { roleLabel, statusLabel } from './permissions.js';
import { readableGame, unavailableReason } from './catalog-availability.js';
import { createGuidePanel } from './guide-panel.js';

const $ = (id) => document.getElementById(id);
const state = { games: [], filter: 'all', query: '', players: '', sort: 'recent', session: { canWrite: false, canRead: false, user: null }, selected: null, busy: false, importing: false };
let repository,
  adminPanel,
  guidePanel,
  reader,
  draft = null,
  manualBlob = null,
  draftCoverBlob = null,
  originalPdfCover = null,
  draftCoverURL = '',
  importAbort = null,
  importSequence = 0,
  noticeTimer;
const localMode = new URLSearchParams(location.search).get('local') === '1' || !APP_CONFIG.firebase;
function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const use = document.createElementNS(svg.namespaceURI, 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.append(use);
  svg.setAttribute('aria-hidden', 'true');
  return svg;
}
function node(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}
function errorMessage(error) {
  const messages = {
    'auth/invalid-credential': 'E-mail ou senha incorretos.',
    'auth/invalid-email': 'Informe um e-mail válido.',
    'auth/too-many-requests': 'Muitas tentativas. Aguarde um pouco e tente novamente.',
    'auth/network-request-failed': 'Não foi possível conectar. Confira sua internet.',
    'auth/operation-not-allowed': 'Este método de login precisa ser habilitado no Firebase Authentication.',
    'auth/configuration-not-found': 'Ative o Firebase Authentication no Console do projeto.',
    'auth/popup-blocked': 'O navegador bloqueou a janela de login. Permita popups para este site e tente novamente.',
    'auth/account-exists-with-different-credential': 'Esta conta usa outro método de login. Entre com e-mail e senha e vincule o Google para preservar seu UID.',
    'auth/email-already-in-use': 'Já existe uma conta com este e-mail. Entre ou use a recuperação de senha.',
    'auth/weak-password': 'Use uma senha com pelo menos oito caracteres.',
    'auth/unauthorized-domain': 'Adicione este domínio aos domínios autorizados do Firebase Authentication.',
    'resource-exhausted': 'A cota gratuita do Firebase foi atingida. Aguarde a renovação da cota e tente novamente.',
    'permission-denied': 'Você não tem permissão para esta operação. Sua aprovação e suas permissões são verificadas no Firestore.',
  };
  if (error.name === 'PasswordException') return 'Este PDF é protegido por senha. Importe uma cópia sem senha.';
  if (error.name === 'InvalidPDFException') return 'O PDF não pôde ser lido. Verifique se o arquivo está íntegro.';
  return messages[error.code] || error.message || 'Não foi possível concluir. Tente novamente.';
}
function showNotice(message, action = null, label = '') {
  clearTimeout(noticeTimer);
  $('notice-text').textContent = message;
  $('notice').hidden = false;
  $('notice-action').hidden = !action;
  $('notice-action').textContent = label;
  $('notice-action').onclick = action;
  if (!action) noticeTimer = setTimeout(() => ($('notice').hidden = true), 7500);
}
$('notice-close').onclick = () => {
  $('notice').hidden = true;
  clearTimeout(noticeTimer);
};
function storageKey(type) {
  return `acervo:${repository?.mode || (localMode ? 'local' : 'firebase')}:${APP_CONFIG.firebase?.projectId || 'device'}:${state.session.user?.uid || 'device'}:${type}`;
}
function readPreferences(type) {
  try {
    return JSON.parse(localStorage.getItem(storageKey(type))) || (type === 'favorites' ? [] : {});
  } catch {
    return type === 'favorites' ? [] : {};
  }
}
function writePreferences(type, value) {
  try {
    localStorage.setItem(storageKey(type), JSON.stringify(value));
  } catch {
    showNotice('O navegador não permitiu salvar favoritos ou a posição da leitura.');
  }
}
function getProgress(id) {
  return readPreferences('reading')[id];
}
function saveProgress(id, progress) {
  const reading = readPreferences('reading');
  reading[id] = progress;
  writePreferences('reading', reading);
  renderRecent();
}
function toggleFavorite(id) {
  const favorites = readPreferences('favorites');
  const next = favorites.includes(id) ? favorites.filter((value) => value !== id) : [...favorites, id];
  writePreferences('favorites', next);
  renderGrid();
  if (state.selected?.id === id) renderFavorite();
}
function showDialog(id) {
  $(id).showModal();
  document.body.classList.add('modal-open');
}
function closeDialog(id) {
  if (id === 'guide-dialog') {
    guidePanel?.close();
    return;
  }
  if (state.busy && ['upload-dialog', 'delete-dialog'].includes(id)) {
    showNotice('Aguarde a operação terminar para fechar.');
    return;
  }
  $(id).close();
}
document.querySelectorAll('[data-close]').forEach((button) => (button.onclick = () => closeDialog(button.dataset.close)));
document.querySelectorAll('dialog').forEach((dialog) => {
  dialog.addEventListener('cancel', (event) => {
    if (state.busy && ['upload-dialog', 'delete-dialog'].includes(dialog.id)) {
      event.preventDefault();
      showNotice('Aguarde a operação terminar para fechar.');
    }
  });
  dialog.addEventListener('close', () => {
    if (!document.querySelector('dialog[open]')) document.body.classList.remove('modal-open');
    if (dialog.id === 'upload-dialog') resetDraft();
  });
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) {
      const bounds = dialog.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) closeDialog(dialog.id);
    }
  });
});
async function populateImage(image, game) {
  const id = game.id;
  image.dataset.gameId = id;
  image.hidden = true;
  image.removeAttribute('src');
  try {
    const url = await repository.getCoverURL(game);
    if (image.dataset.gameId !== id || !url || !image.isConnected) return;
    image.src = url;
    image.hidden = false;
    image.onerror = () => {
      image.hidden = true;
    };
  } catch {
    /* O catálogo permanece utilizável mesmo se uma capa não carregar. */
  }
}
function renderGrid() {
  const available = state.games.filter(readableGame);
  const games = filterGames(available, { ...state, favorites: readPreferences('favorites') });
  $('game-count').textContent = `${available.length} ${available.length === 1 ? 'jogo' : 'jogos'}`;
  $('games-grid').replaceChildren();
  $('empty-state').hidden = available.length > 0;
  $('no-results').hidden = !available.length || games.length > 0;
  renderUnavailable();
  for (const game of games) {
    const card = node('article', 'game-card'),
      button = node('button', 'card-main');
    button.type = 'button';
    button.setAttribute('aria-label', `Ver ${game.title}`);
    const cover = node('div', 'card-cover'),
      image = node('img');
    image.alt = '';
    image.loading = 'lazy';
    cover.append(icon('book'), image, node('span', 'card-pdf', 'MANUAL PDF'));
    const overlay = node('div', 'card-overlay'),
      overlayLabel = node('span', null, 'Ver jogo');
    overlayLabel.prepend(icon('book'));
    overlay.append(overlayLabel);
    cover.append(overlay);
    const meta = node('div', 'card-meta');
    if (game.deleting) meta.append(node('span', null, 'Exclusão pendente'));
    if (game.minPlayers) {
      const players = node('span', null, `${game.minPlayers}${game.maxPlayers !== game.minPlayers ? `–${game.maxPlayers}` : ''}`);
      players.prepend(icon('users'));
      meta.append(players);
    }
    if (game.durationMinutes) {
      const duration = node('span', null, `${game.durationMinutes} min`);
      duration.prepend(icon('clock'));
      meta.append(duration);
    }
    if (!meta.children.length) meta.append(node('span', null, `${game.manual?.pages || '—'} páginas`));
    button.append(cover, node('span', 'card-title', game.title), meta);
    button.onclick = () => showGame(game);
    const favorite = node('button', `card-favorite ${readPreferences('favorites').includes(game.id) ? 'is-favorite' : ''}`);
    favorite.type = 'button';
    favorite.append(icon('heart'));
    favorite.setAttribute('aria-label', `Favoritar ${game.title}`);
    favorite.setAttribute('aria-pressed', String(readPreferences('favorites').includes(game.id)));
    favorite.onclick = () => toggleFavorite(game.id);
    card.append(button, favorite);
    $('games-grid').append(card);
    populateImage(image, game);
  }
  document.querySelectorAll('[data-filter]').forEach((button) => {
    const active = button.dataset.filter === state.filter;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  $('nav-favorites').classList.toggle('active', state.filter === 'favorites');
  $('nav-library').classList.toggle('active', state.filter !== 'favorites');
}
function renderUnavailable() {
  const missing = state.games.filter((game) => !readableGame(game));
  $('unavailable-games').hidden = !(state.session.canEdit || state.session.canDelete) || !missing.length;
  $('unavailable-list').replaceChildren();
  if ($('unavailable-games').hidden) return;
  for (const game of missing) {
    const row = node('div', 'unavailable-row'),
      text = node('div');
    text.append(node('strong', null, game.title), node('p', 'muted-text', unavailableReason(game)));
    const button = node('button', 'button secondary small', 'Gerenciar cadastro');
    button.type = 'button';
    button.onclick = () => showGame(game);
    row.append(text, button);
    $('unavailable-list').append(row);
  }
}
$('refresh-library').onclick = async () => {
  $('refresh-library').disabled = true;
  try {
    await repository?.refreshAvailability?.();
    showNotice('Biblioteca atualizada.');
  } catch (error) {
    showNotice(errorMessage(error));
  } finally {
    $('refresh-library').disabled = false;
  }
};
let heroSequence = 0;
async function renderHero() {
  const token = ++heroSequence;
  const game = [...state.games].filter(readableGame).sort((a, b) => b.createdAt - a.createdAt)[0];
  const hero = document.querySelector('.hero');
  hero.classList.toggle('has-game', !!game);
  $('hero-art').hidden = !!game;
  $('hero-meta').hidden = !game;
  $('hero-backdrop').style.backgroundImage = '';
  $('hero-meta').replaceChildren();
  $('hero-main').querySelector('span').textContent = game ? 'Ler manual' : state.session.canAdd ? 'Adicionar meu primeiro jogo' : 'Entrar na biblioteca';
  $('hero-main')
    .querySelector('use')
    .setAttribute('href', `#i-${game ? 'book' : 'plus'}`);
  if (!game) {
    const lineBreak = document.createElement('br'),
      emphasized = node('em', null, 'aqui.');
    $('hero-title').replaceChildren(document.createTextNode('A próxima partida'), lineBreak, document.createTextNode('começa '), emphasized);
    $('hero-description').textContent = 'Todos os seus manuais, em um só lugar. Menos tempo procurando. Mais tempo jogando.';
    $('hero-caption').replaceChildren(node('span', 'status-dot'), document.createTextNode('Uma biblioteca feita para a sua mesa.'));
    $('hero-main').onclick = addGame;
    return;
  }
  $('hero-title').textContent = game.title;
  $('hero-description').textContent = game.description || 'O manual da sua próxima partida está pronto para leitura.';
  if (game.minPlayers) {
    const span = node('span', null, playersLabel(game));
    span.prepend(icon('users'));
    $('hero-meta').append(span);
  }
  if (game.durationMinutes) {
    const span = node('span', null, `${game.durationMinutes} min`);
    span.prepend(icon('clock'));
    $('hero-meta').append(span);
  }
  $('hero-main').onclick = () => reader.open(game);
  $('hero-caption').replaceChildren(node('span', 'status-dot'), document.createTextNode('Adicionado recentemente à sua biblioteca.'));
  try {
    const url = await repository.getCoverURL(game);
    if (token === heroSequence && url) $('hero-backdrop').style.backgroundImage = `url(${JSON.stringify(url)})`;
  } catch {}
}
function renderRecent() {
  if (!repository) return;
  const reading = readPreferences('reading');
  const games = state.games
    .filter((game) => reading[game.id] && readableGame(game))
    .sort((a, b) => reading[b.id].lastRead - reading[a.id].lastRead)
    .slice(0, 6);
  $('recent-section').hidden = !games.length;
  $('recent-row').replaceChildren();
  for (const game of games) {
    const progress = reading[game.id],
      card = node('button', 'recent-card'),
      image = node('img');
    image.alt = '';
    const info = node('div');
    info.append(node('strong', null, game.title), node('span', null, `Página ${progress.page} de ${progress.total}`));
    const bar = node('progress');
    bar.max = progress.total;
    bar.value = progress.page;
    bar.setAttribute('aria-label', `Leitura de ${game.title}`);
    info.append(bar);
    card.append(image, info);
    card.onclick = () => reader.open(game);
    $('recent-row').append(card);
    populateImage(image, game);
  }
}
function setFilter(filter) {
  state.filter = filter;
  renderGrid();
}
document.querySelectorAll('[data-filter]').forEach((button) => (button.onclick = () => setFilter(button.dataset.filter)));
$('search').oninput = (event) => {
  state.query = event.target.value;
  renderGrid();
};
$('players-filter').onchange = (event) => {
  state.players = event.target.value;
  renderGrid();
};
$('sort').onchange = (event) => {
  state.sort = event.target.value;
  renderGrid();
};
$('clear-filters').onclick = () => {
  state.query = '';
  state.players = '';
  $('search').value = '';
  $('players-filter').value = '';
  setFilter('all');
};
$('nav-favorites').onclick = () => {
  setFilter('favorites');
  $('biblioteca').scrollIntoView({ behavior: 'smooth' });
};
$('nav-library').onclick = () => setFilter('all');
document.addEventListener('keydown', (event) => {
  if (event.key === '/' && !document.querySelector('dialog[open]') && $('reader').hidden && !['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName)) {
    event.preventDefault();
    $('search').focus();
  }
});
function renderFavorite() {
  const favorite = readPreferences('favorites').includes(state.selected?.id);
  $('detail-favorite').classList.toggle('is-favorite', favorite);
  $('detail-favorite').setAttribute('aria-pressed', String(favorite));
  $('detail-favorite').setAttribute('aria-label', favorite ? 'Remover dos favoritos' : 'Adicionar aos favoritos');
}
function showGame(game) {
  state.selected = game;
  $('detail-title').textContent = game.title;
  $('detail-description').textContent = game.description || 'Descrição não informada. Você pode completar as informações na área de administração.';
  $('detail-cover').alt = `Capa de ${game.title}`;
  populateImage($('detail-cover'), game);
  $('detail-tags').replaceChildren(...[...(game.tags || []), ...(game.mechanics || []), game.gameType, game.edition ? `Edição · ${game.edition}` : ''].filter(Boolean).map((tag) => node('span', null, tag)));
  $('detail-stats').replaceChildren();
  for (const [symbol, label, value] of [
    ['users', 'JOGADORES', playersLabel(game)],
    ['clock', 'DURAÇÃO', game.durationMinutes ? `${game.durationMinutes} minutos` : 'Não informada'],
    ['users', 'IDADE', game.recommendedAge ? `${game.recommendedAge}+ anos` : 'Não informada'],
  ]) {
    const stat = node('div'),
      content = node('div');
    content.append(node('small', null, label), node('strong', null, value));
    stat.append(icon(symbol), content);
    $('detail-stats').append(stat);
  }
  updateManualStatus(game);
  $('detail-admin').hidden = !state.session.canEdit && !state.session.canDelete;
  $('edit-game').hidden = !state.session.canEdit;
  $('edit-guide').hidden = !state.session.canEdit;
  $('edit-guide').disabled = game.deleting === true;
  $('delete-game').hidden = !state.session.canDelete;
  $('edit-game').disabled = game.deleting === true;
  $('read-manual').disabled = !readableGame(game);
  $('delete-game').textContent = game.deleting ? 'Concluir exclusão pendente' : 'Excluir jogo';
  $('detail-source').hidden = !game.bgg?.id;
  if (game.bgg?.id) $('detail-source').href = `https://boardgamegeek.com/boardgame/${Number(game.bgg.id)}`;
  renderFavorite();
  showDialog('detail-dialog');
}
function updateManualStatus(game) {
  $('detail-manual').textContent = readableGame(game)
    ? `${game.manual?.pages || '—'} páginas · ${formatBytes(game.manual?.size)} · ${game.manual?.name || 'Manual PDF'}${repository.mode === 'firebase' ? ' · Drive central' : ''}`
    : `${unavailableReason(game)}. Você pode corrigir ou remover este cadastro.`;
}
$('detail-favorite').onclick = () => toggleFavorite(state.selected.id);
$('read-manual').onclick = () => reader.open(state.selected);
$('learn-game').onclick = () => guidePanel.open(state.selected, 'learn');
$('quick-rules').onclick = () => guidePanel.open(state.selected, 'quick');
$('edit-guide').onclick = () => guidePanel.open(state.selected, 'edit');
function formatBytes(size = 0) {
  return size >= 1024 * 1024 ? `${(size / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(size / 1024)} KB`;
}
function resetDraft() {
  ++bggSequence;
  $('bgg-search').removeAttribute('aria-busy');
  importAbort?.abort();
  ++importSequence;
  if (draftCoverURL.startsWith('blob:')) URL.revokeObjectURL(draftCoverURL);
  draft = manualBlob = draftCoverBlob = originalPdfCover = null;
  draftCoverURL = '';
  state.importing = false;
  $('game-form').reset();
  $('game-form').hidden = true;
  $('upload-picker').hidden = false;
  $('pdf-file').value = '';
  $('cover-file').value = '';
  $('upload-status').textContent = '';
  $('upload-progress').hidden = true;
  $('save-error').hidden = true;
  $('title-suggestions').replaceChildren();
  $('bgg-results').replaceChildren();
  $('bgg-status').textContent = '';
  $('save-game').disabled = false;
}
function addGame() {
  if (!repository) {
    showNotice('A conexão ainda não ficou pronta. Abra “Sobre o acervo” para usar a biblioteca deste dispositivo.');
    return;
  }
  if (!state.session.canAdd) {
    showLogin();
    return;
  }
  resetDraft();
  $('upload-title').textContent = 'Um novo jogo na estante.';
  $('save-game').querySelector('span').textContent = 'Adicionar à biblioteca';
  showDialog('upload-dialog');
}
document.querySelectorAll('[data-add]').forEach((button) => (button.onclick = addGame));
$('empty-action').onclick = addGame;
$('hero-main').onclick = addGame;
function previewCover() {
  if (draftCoverURL.startsWith('blob:')) URL.revokeObjectURL(draftCoverURL);
  draftCoverURL = draftCoverBlob ? URL.createObjectURL(draftCoverBlob) : safeImageUrl(draft.cover?.url);
  $('draft-cover').src = draftCoverURL || 'assets/icon.svg';
}
function fillForm() {
  const form = $('game-form');
  for (const field of ['title', 'description', 'minPlayers', 'maxPlayers', 'durationMinutes', 'language', 'recommendedAge', 'gameType', 'edition']) form.elements.namedItem(field).value = draft[field] ?? (field === 'language' ? 'other' : '');
  form.elements.namedItem('mechanics').value = (draft.mechanics || []).join(', ');
  form.elements.namedItem('tags').value = (draft.tags || []).join(', ');
  form.elements.namedItem('isPublic').checked = draft.isPublic === true;
  form.elements.namedItem('confirmed').checked = false;
  $('file-info').textContent = `${draft.manual.name} · ${formatBytes(draft.manual.size)} · ${draft.manual.pages} páginas`;
  $('upload-picker').hidden = true;
  form.hidden = false;
  previewCover();
  renderEvidence();
  $('use-pdf-cover').hidden = !originalPdfCover;
  $('replace-pdf-label').hidden = !draft.id || !state.session.canEdit;
  $('bgg-search').disabled = !APP_CONFIG.enableBgg || repository.mode !== 'firebase';
  $('bgg-search').title = $('bgg-search').disabled ? 'A consulta ao BoardGameGeek ainda não está ativa neste acervo.' : 'Buscar informações complementares no BoardGameGeek';
  $('bgg-status').textContent = APP_CONFIG.enableBgg && repository.mode === 'firebase' ? '' : 'Consulta ao BoardGameGeek indisponível neste acervo. Você pode continuar com a capa e os dados do PDF.';
}
function renderEvidence() {
  $('source-evidence').replaceChildren();
  const labels = { title: 'Nome', players: 'Jogadores', duration: 'Duração', description: 'Descrição', cover: 'Capa', recommendedAge: 'Idade', gameType: 'Tipo', edition: 'Edição', mechanics: 'Mecânicas', tags: 'Categorias', language: 'Idioma' };
  for (const [key, value] of Object.entries(draft.sources || {})) {
    const paragraph = node('p');
    paragraph.append(node('strong', null, `${labels[key] || key}: ${value.source}`), document.createElement('br'), document.createTextNode(value.excerpt || 'Sem trecho disponível.'));
    $('source-evidence').append(paragraph);
  }
  if (!$('source-evidence').children.length) $('source-evidence').append(node('p', null, 'Não foi possível extrair informações. Preencha apenas os dados que você conhece.'));
}
async function importFile(file) {
  if (!file || state.busy || state.importing) return;
  if (!state.session.canAdd) {
    showLogin();
    return;
  }
  const token = ++importSequence;
  importAbort?.abort();
  importAbort = new AbortController();
  state.importing = true;
  $('pdf-file').disabled = true;
  $('save-error').hidden = true;
  $('upload-status').textContent = 'Lendo seu manual…';
  try {
    const inspected = await inspectPdf(file, {
      maxBytes: APP_CONFIG.maxPdfBytes,
      signal: importAbort.signal,
      onProgress: (message) => {
        if (token === importSequence) $('upload-status').textContent = message;
      },
    });
    if (token !== importSequence || !$('upload-dialog').open) return;
    const duplicate = state.games.find((game) => game.manual?.sha256 === inspected.manual.sha256);
    if (duplicate) throw new Error(`Este manual já está na biblioteca como “${duplicate.title}”. Edite o jogo existente para alterar suas informações.`);
    const { coverBlob, candidates, textFound, ...record } = inspected;
    draft = { ...record };
    manualBlob = file;
    draftCoverBlob = originalPdfCover = coverBlob;
    $('upload-status').textContent = '';
    $('review-notice-text').textContent = textFound
      ? 'Informações extraídas do manual. Confira o título, a capa e os dados antes de salvar.'
      : 'O PDF parece escaneado ou contém pouco texto. Usamos a primeira página como capa; preencha as informações conhecidas.';
    fillForm();
    for (const candidate of candidates) {
      const button = node('button', null, candidate.text);
      button.type = 'button';
      button.title = candidate.source;
      button.onclick = () => {
        $('game-title').value = candidate.text;
        draft.sources.title = { source: candidate.source, excerpt: candidate.text };
        draft.title = candidate.text;
        renderEvidence();
      };
      $('title-suggestions').append(button);
    }
    $('game-title').focus();
  } catch (error) {
    if (error.name !== 'AbortError' && token === importSequence) $('upload-status').textContent = errorMessage(error);
  } finally {
    if (token === importSequence) state.importing = false;
    $('pdf-file').disabled = false;
    $('pdf-file').value = '';
  }
}
$('pdf-file').onchange = (event) => importFile(event.target.files[0]);
for (const type of ['dragenter', 'dragover'])
  $('dropzone').addEventListener(type, (event) => {
    event.preventDefault();
    $('dropzone').classList.add('dragover');
  });
for (const type of ['dragleave', 'drop'])
  $('dropzone').addEventListener(type, (event) => {
    event.preventDefault();
    $('dropzone').classList.remove('dragover');
    if (type === 'drop') importFile(event.dataTransfer.files[0]);
  });
$('cover-file').onchange = async (event) => {
  const file = event.target.files[0];
  if (!file || !draft) return;
  try {
    if (file.size > 8 * 1024 * 1024 || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Selecione uma imagem JPG, PNG ou WebP de até 8 MB.');
    draftCoverBlob = await imageToJpeg(file);
    draft.cover = { kind: 'upload', url: '' };
    draft.sources.cover = { source: 'Imagem escolhida por você', excerpt: file.name };
    previewCover();
    renderEvidence();
  } catch (error) {
    showNotice(errorMessage(error));
  } finally {
    event.target.value = '';
  }
};
$('use-pdf-cover').onclick = () => {
  if (originalPdfCover) {
    draftCoverBlob = originalPdfCover;
    draft.cover = { kind: 'pdf', url: '' };
    draft.sources.cover = { source: 'Primeira página do PDF', excerpt: 'Capa renderizada do manual.' };
    previewCover();
    renderEvidence();
  }
};
$('replace-pdf-file').onchange = async (event) => {
  const file = event.target.files[0],
    currentDraft = draft;
  if (!file || !draft?.id || !state.session.canEdit || state.busy || state.importing) return;
  const token = ++importSequence;
  importAbort?.abort();
  importAbort = new AbortController();
  state.importing = true;
  $('save-game').disabled = true;
  try {
    const inspected = await inspectPdf(file, {
      maxBytes: APP_CONFIG.maxPdfBytes,
      signal: importAbort.signal,
      onProgress: (message) => {
        if (token === importSequence) $('upload-status').textContent = message;
      },
    });
    if (draft !== currentDraft || token !== importSequence || !$('upload-dialog').open) return;
    const form = $('game-form'),
      values = Object.fromEntries(new FormData(form).entries());
    draft = { ...draft, ...validateGame(values), manual: inspected.manual, sources: { ...draft.sources, manual: { source: 'Manual substituído por você', excerpt: file.name } } };
    manualBlob = file;
    originalPdfCover = inspected.coverBlob;
    if (draft.cover.kind === 'pdf') {
      draftCoverBlob = inspected.coverBlob;
      draft.cover = { kind: 'pdf', url: '' };
      draft.sources.cover = { source: 'Primeira página do novo PDF', excerpt: file.name };
    }
    fillForm();
    $('review-notice-text').textContent = 'O novo PDF está preparado. Confira a edição e as informações do jogo antes de salvar a substituição.';
    $('upload-status').textContent = '';
  } catch (error) {
    if (error.name !== 'AbortError' && token === importSequence) $('upload-status').textContent = errorMessage(error);
  } finally {
    if (token === importSequence) {
      state.importing = false;
      $('save-game').disabled = false;
    }
    event.target.value = '';
  }
};
let bggSequence = 0;
async function searchBgg() {
  if (!draft || !APP_CONFIG.enableBgg || state.busy || state.importing) return;
  const token = ++bggSequence,
    currentDraft = draft,
    query = $('game-title').value.trim();
  if (query.length < 2) {
    $('bgg-status').textContent = 'Informe um nome com pelo menos dois caracteres.';
    return;
  }
  $('bgg-search').disabled = true;
  $('bgg-search').setAttribute('aria-busy', 'true');
  $('bgg-results').replaceChildren();
  $('bgg-status').textContent = 'Procurando jogos com esse nome…';
  try {
    const results = await repository.lookup('search', query);
    if (token !== bggSequence || draft !== currentDraft) return;
    $('bgg-status').textContent = results.length ? 'Confirme qual jogo corresponde ao seu manual:' : 'Nenhuma correspondência encontrada. Você pode usar os dados do PDF e corrigir o título.';
    for (const result of results) {
      const button = node('button');
      button.type = 'button';
      button.append(node('span', null, result.title), node('small', null, result.year || ''));
      button.onclick = () => selectBgg(result.id, currentDraft);
      $('bgg-results').append(button);
    }
  } catch (error) {
    if (token === bggSequence && draft === currentDraft) $('bgg-status').textContent = errorMessage(error);
  } finally {
    if (token === bggSequence) {
      $('bgg-search').disabled = false;
      $('bgg-search').removeAttribute('aria-busy');
    }
  }
}
$('bgg-search').onclick = searchBgg;
async function selectBgg(id, currentDraft) {
  if (draft !== currentDraft || state.busy || state.importing) return;
  const selection = ++bggSequence;
  state.importing = true;
  $('bgg-search').disabled = true;
  $('bgg-search').setAttribute('aria-busy', 'true');
  $('save-game').disabled = true;
  $('bgg-results')
    .querySelectorAll('button')
    .forEach((button) => (button.disabled = true));
  $('bgg-status').textContent = 'Buscando capa e informações do jogo…';
  try {
    const metadata = await repository.lookup('thing', id);
    if (draft !== currentDraft) return;
    const sourceURL = `https://boardgamegeek.com/boardgame/${metadata.id}`;
    const description = plainText(metadata.description).slice(0, 2000);
    const short = description.length > 600 ? description.slice(0, 600).replace(/\s+\S*$/, '') + '…' : description;
    draft = {
      ...draft,
      title: metadata.title || draft.title,
      description: short || draft.description,
      minPlayers: metadata.minPlayers || draft.minPlayers,
      maxPlayers: metadata.maxPlayers || draft.maxPlayers,
      durationMinutes: metadata.durationMinutes || draft.durationMinutes,
      bgg: {
        id: metadata.id,
        url: sourceURL,
        matchedAt: Date.now(),
        original: { title: metadata.title, description: metadata.description, minPlayers: metadata.minPlayers, maxPlayers: metadata.maxPlayers, durationMinutes: metadata.durationMinutes },
      },
      sources: { ...draft.sources },
    };
    for (const field of ['title', 'players', 'duration', 'description'].filter((field) =>
      field === 'title' ? metadata.title : field === 'players' ? metadata.minPlayers && metadata.maxPlayers : field === 'duration' ? metadata.durationMinutes : short,
    ))
      draft.sources[field] = {
        source: 'BoardGameGeek · correspondência confirmada',
        excerpt: field === 'title' ? metadata.title : field === 'players' ? `${metadata.minPlayers ?? '—'}–${metadata.maxPlayers ?? '—'} jogadores` : field === 'duration' ? `${metadata.durationMinutes ?? '—'} minutos` : description.slice(0, 600),
      };
    const cover = safeImageUrl(metadata.image || metadata.thumbnail);
    if (cover) {
      try {
        const selectedDraft = draft,
          image = await imageToJpeg(await repository.fetchBggCover(metadata.id));
        if (draft !== selectedDraft || selection !== bggSequence) return;
        draftCoverBlob = image;
        draft.cover = { kind: 'bgg', url: '', attribution: sourceURL, sourceUrl: cover };
        draft.sources.cover = { source: 'BoardGameGeek · cópia no Drive central', excerpt: sourceURL };
      } catch {
        showNotice('Não foi possível importar a capa do BGG. Mantivemos a capa do manual para você revisar.');
      }
    }
    fillForm();
    $('bgg-results').replaceChildren();
    $('bgg-status').textContent = 'Correspondência selecionada. Confira os dados; a descrição do BGG pode estar em inglês.';
  } catch (error) {
    if (draft === currentDraft) $('bgg-status').textContent = errorMessage(error);
  } finally {
    if (selection === bggSequence) {
      state.importing = false;
      $('save-game').disabled = false;
      $('bgg-search').disabled = !APP_CONFIG.enableBgg || repository.mode !== 'firebase';
      $('bgg-search').removeAttribute('aria-busy');
    }
    $('bgg-results')
      .querySelectorAll('button')
      .forEach((button) => (button.disabled = false));
  }
}
function plainText(value) {
  const doc = new DOMParser().parseFromString(String(value || ''), 'text/html');
  return doc.body.textContent.replace(/\s+/g, ' ').trim();
}
$('game-form').onsubmit = async (event) => {
  event.preventDefault();
  if (!draft || state.busy || state.importing) return;
  $('save-error').hidden = true;
  try {
    if (!$('game-form').elements.namedItem('confirmed').checked) throw new Error('Confira os dados e marque a confirmação antes de salvar.');
    const values = Object.fromEntries(new FormData($('game-form')).entries());
    const normalized = validateGame(values);
    const sources = { ...draft.sources };
    for (const [field, sourceField] of [
      ['title', 'title'],
      ['description', 'description'],
      ['minPlayers', 'players'],
      ['maxPlayers', 'players'],
      ['durationMinutes', 'duration'],
      ['recommendedAge', 'recommendedAge'],
      ['gameType', 'gameType'],
      ['edition', 'edition'],
      ['language', 'language'],
    ])
      if ((draft[field] ?? '') !== (normalized[field] ?? '')) sources[sourceField] = { source: 'Conferido e ajustado por você', excerpt: sourceField === 'players' ? playersLabel(normalized) : String(normalized[field] ?? '') };
    state.busy = true;
    $('game-form')
      .querySelectorAll('button,input,textarea,select')
      .forEach((el) => (el.disabled = true));
    if (!draft.id) draft.id = repository.reserveGameId ? await repository.reserveGameId(draft.manual.sha256) : crypto.randomUUID();
    const record = { ...draft, ...normalized, sources };
    $('upload-progress').hidden = repository.mode !== 'firebase';
    $('upload-progress').value = 0;
    $('upload-status').textContent = 'Salvando seu jogo…';
    const result = await repository.saveGame(record, {
      manualBlob,
      coverBlob: draftCoverBlob,
      onProgress: (percent) => {
        $('upload-progress').value = percent;
        $('upload-status').textContent = `Enviando para o Drive central: ${percent}%`;
      },
    });
    state.busy = false;
    closeDialog('upload-dialog');
    showNotice(result.warning || 'Jogo salvo. Seu manual já está na biblioteca.');
    if (repository.mode === 'local') navigator.storage?.persist?.().catch(() => {});
  } catch (error) {
    $('save-error').textContent = errorMessage(error);
    $('save-error').hidden = false;
    $('upload-status').textContent = '';
  } finally {
    state.busy = false;
    $('game-form')
      .querySelectorAll('button,input,textarea,select')
      .forEach((el) => (el.disabled = false));
    $('bgg-search').disabled = !APP_CONFIG.enableBgg || repository.mode !== 'firebase';
    $('upload-progress').hidden = true;
  }
};
$('edit-game').onclick = () => {
  const game = state.selected;
  closeDialog('detail-dialog');
  resetDraft();
  draft = structuredClone(game);
  draftCoverBlob = null;
  $('upload-title').textContent = 'Uma estante do seu jeito.';
  $('save-game').querySelector('span').textContent = 'Salvar alterações';
  $('review-notice-text').textContent = 'Edite as informações ou substitua o PDF. Uma substituição só é publicada depois de você confirmar e salvar.';
  fillForm();
  repository
    .getCoverURL(game)
    .then((url) => {
      if (draft?.id === game.id) $('draft-cover').src = url || 'assets/icon.svg';
    })
    .catch(() => {});
  showDialog('upload-dialog');
};
$('delete-game').onclick = () => {
  $('delete-message').textContent = `Você vai remover “${state.selected.title}”.`;
  $('delete-error').hidden = true;
  showDialog('delete-dialog');
};
$('confirm-delete').onclick = async () => {
  if (state.busy) return;
  state.busy = true;
  $('confirm-delete').disabled = true;
  $('delete-error').hidden = true;
  try {
    const result = await repository.deleteGame(state.selected);
    state.busy = false;
    closeDialog('delete-dialog');
    closeDialog('detail-dialog');
    state.selected = null;
    showNotice(result?.warning || 'Jogo excluído da biblioteca.');
  } catch (error) {
    $('delete-error').textContent = `${errorMessage(error)} A exclusão não terminou; tente novamente.`;
    $('delete-error').hidden = false;
  } finally {
    state.busy = false;
    $('confirm-delete').disabled = false;
  }
};
function authView(view = 'login') {
  const signedIn = !!state.session.user;
  for (const name of ['login', 'register', 'recovery']) $(`${name}-form`).hidden = signedIn || name !== view;
  $('google-login').hidden = signedIn || view === 'recovery';
  $('pages-login-note').hidden = true;
  $('session-info').hidden = !signedIn;
}
function renderAccount() {
  const { user, profile } = state.session;
  if (!user) return;
  $('session-message').textContent = `${profile?.name || user.displayName || user.email} · ${roleLabel(profile?.role)}`;
  $('session-uid').value = user.uid;
  $('session-status').textContent =
    statusLabel(profile?.status) +
    '. ' +
    ({
      pending: 'Sua solicitação será analisada. Você já pode ler os manuais públicos.',
      approved: 'Seu acesso está atualizado.',
      rejected: 'Sua solicitação foi recusada. A leitura pública continua disponível.',
      blocked: 'Seu acesso administrativo foi revogado. A leitura pública continua disponível.',
    }[profile?.status] || 'Sua solicitação ainda precisa ser registrada.');
  $('retry-profile-button').hidden = !!profile || user.uid === '7TitBObtb8a0W8GisSstSM1RHiX2';
  $('link-google-button').hidden = user.providerData?.some((provider) => provider.providerId === 'google.com');
}
function showLogin() {
  if (localMode || !repository) {
    showDialog('setup-dialog');
    return;
  }
  authView();
  renderAccount();
  $('google-login-error').hidden = true;
  $('login-error').hidden = true;
  showDialog('login-dialog');
}
document.querySelectorAll('[data-auth-view]').forEach((button) => (button.onclick = () => authView(button.dataset.authView)));
$('register-form').onsubmit = async (event) => {
  event.preventDefault();
  $('register-submit').disabled = true;
  $('register-error').hidden = true;
  try {
    const fields = new FormData(event.target);
    if (fields.get('password') !== fields.get('confirmation')) throw new Error('As senhas não coincidem.');
    await repository.register(fields.get('name'), fields.get('email'), fields.get('password'));
    event.target.reset();
    closeDialog('login-dialog');
    showNotice('Conta criada! Aguarde a aprovação de um administrador.');
  } catch (error) {
    $('register-error').textContent = errorMessage(error);
    $('register-error').hidden = false;
  } finally {
    $('register-submit').disabled = false;
  }
};
$('recovery-form').onsubmit = async (event) => {
  event.preventDefault();
  $('recovery-submit').disabled = true;
  $('recovery-message').hidden = true;
  try {
    await repository.resetPassword(new FormData(event.target).get('email'));
    $('recovery-message').textContent = 'Se houver uma conta com este e-mail, você receberá as instruções para recuperar a senha.';
  } catch (error) {
    $('recovery-message').textContent = errorMessage(error);
  } finally {
    $('recovery-message').hidden = false;
    $('recovery-submit').disabled = false;
  }
};
$('retry-profile-button').onclick = async () => {
  $('retry-profile-button').disabled = true;
  try {
    await repository.retryProfile();
    showNotice('Solicitação registrada. Aguarde a aprovação de um administrador.');
  } catch (error) {
    showNotice(errorMessage(error));
  } finally {
    $('retry-profile-button').disabled = false;
  }
};
$('account-button').onclick = showLogin;
$('google-login-button').onclick = async () => {
  $('google-login-button').disabled = true;
  $('google-login-error').hidden = true;
  try {
    await repository.loginGoogle();
    closeDialog('login-dialog');
    showNotice('Conta conectada. Verificando as permissões…');
  } catch (error) {
    $('google-login-error').textContent = errorMessage(error);
    $('google-login-error').hidden = false;
  } finally {
    $('google-login-button').disabled = false;
  }
};
$('link-google-button').onclick = async () => {
  $('link-google-button').disabled = true;
  try {
    await repository.linkGoogle();
    showNotice('Conta Google vinculada. Seu UID e suas permissões foram preservados.');
  } catch (error) {
    showNotice(errorMessage(error));
  } finally {
    $('link-google-button').disabled = false;
  }
};
$('login-form').onsubmit = async (event) => {
  event.preventDefault();
  $('login-submit').disabled = true;
  $('login-error').hidden = true;
  try {
    const values = new FormData(event.target);
    await repository.login(values.get('email'), values.get('password'));
    event.target.reset();
    closeDialog('login-dialog');
    showNotice('Conta conectada. Verificando a autorização…');
  } catch (error) {
    $('login-error').textContent = errorMessage(error);
    $('login-error').hidden = false;
  } finally {
    $('login-submit').disabled = false;
  }
};
$('logout-button').onclick = async () => {
  try {
    await repository.logout();
    closeDialog('login-dialog');
    showNotice('Você saiu da conta.');
  } catch (error) {
    showNotice(errorMessage(error));
  }
};
function setupContent() {
  $('setup-mode').textContent = localMode
    ? 'Você está usando a biblioteca deste dispositivo. PDFs e dados ficam neste navegador, sem sincronização. Apagar os dados do site remove essa biblioteca.'
    : `Este Acervo usa o Firebase Spark para dados e permissões. PDFs e capas são guardados na conta Drive do proprietário. ${APP_CONFIG.fileStorage?.apiBase ? 'Os administradores usam suas próprias contas Firebase para enviar arquivos à mesma pasta central.' : 'A conexão do Drive central ainda precisa ser configurada. Siga o guia Google Drive e Cloudflare do projeto.'}`;
  $('switch-mode').textContent = localMode ? 'Abrir a biblioteca no Firebase' : 'Usar biblioteca deste dispositivo';
}
$('setup-button').onclick = () => {
  setupContent();
  showDialog('setup-dialog');
};
$('switch-mode').onclick = () => {
  const url = new URL(location.href);
  if (localMode) url.searchParams.delete('local');
  else url.searchParams.set('local', '1');
  location.href = url.href;
};
const install = setupPwa({ onNotice: showNotice, isBusy: () => state.busy || state.importing || !!draft || adminPanel?.isBusy() || guidePanel?.isBusy(), onInstallReady: (ready) => $('install-button').classList.toggle('ready', ready) });
async function installApp() {
  if (!(await install())) {
    setupContent();
    if (!$('setup-dialog').open) showDialog('setup-dialog');
    showNotice('Android: menu do navegador → Instalar aplicativo. iPhone/iPad: Safari → Compartilhar → Adicionar à Tela de Início.');
  }
}
$('install-button').onclick = installApp;
$('footer-install').onclick = installApp;
$('setup-install').onclick = installApp;
window.addEventListener('offline', () => {
  $('connection-status').textContent = repository?.mode === 'local' ? 'Neste dispositivo · disponível offline' : 'Sem conexão · os PDFs na nuvem precisam de internet';
});
window.addEventListener('online', () => updateSession(state.session));
function updateSession(session) {
  const previous = state.session;
  if (state.session.user?.uid !== session.user?.uid && !$('reader').hidden) reader?.close();
  state.session = session;
  guidePanel?.updateSession(session);
  if (previous.user?.uid === session.user?.uid && previous.profile && session.profile && previous.profile.status !== session.profile.status) showNotice(`${statusLabel(session.profile.status)}. Abra Minha conta para ver seu acesso atualizado.`);
  adminPanel?.updateSession(session);
  if ($('login-dialog').open) {
    authView();
    renderAccount();
  }
  if (!session.canWrite && $('upload-dialog').open) closeDialog('upload-dialog');
  $('account-label').textContent = session.mode === 'local' ? 'Local' : session.user ? (session.canWrite ? 'Administrador' : 'Minha conta') : 'Entrar';
  $('refresh-library').hidden = session.mode !== 'firebase';
  $('account-button').querySelector('.avatar').textContent = session.mode === 'local' ? 'L' : (session.user?.email?.[0] || 'A').toUpperCase();
  $('connection-status').replaceChildren(
    node('span', 'status-dot'),
    document.createTextNode(
      session.mode === 'local'
        ? 'Neste dispositivo · sem sincronização'
        : session.canWrite
          ? session.role === 'subadmin'
            ? 'Firebase Spark · subadministrador'
            : 'Firebase Spark · administrador'
          : session.canRead
            ? 'Acervo na nuvem · leitura pública'
            : session.user
              ? 'Conta conectada · autorização pendente'
              : 'Acervo privado · entre para acessar',
    ),
  );
  $('empty-description').textContent = session.canWrite
    ? 'Adicione um manual em PDF. A gente prepara a capa e procura as informações para você conferir.'
    : session.canRead
      ? 'Ainda não há manuais publicados nesta biblioteca. Os jogos aparecerão aqui quando o administrador liberar a leitura.'
      : session.user
        ? 'Esta conta ainda precisa ser autorizada. Abra “Minha conta” para consultar o UID e siga o guia do Firebase.'
        : 'Sua coleção fica protegida no Firebase. Entre com a conta autorizada para acessar seus jogos e manuais.';
  $('empty-action').querySelector('span').textContent = session.canAdd ? 'Escolher um manual' : session.user ? 'Ver autorização da conta' : 'Entrar na biblioteca';
  $('empty-note').textContent = session.mode === 'local' ? 'PDF de até 50 MB · Armazenado somente neste navegador' : 'Firebase · Acesso controlado pelo administrador';
  if (!session.canWrite) $('detail-admin').hidden = true;
  renderGrid();
  renderRecent();
  renderHero();
}
async function start() {
  setupContent();
  $('bgg-attribution').hidden = !APP_CONFIG.enableBgg;
  try {
    repository = localMode ? await (await import('./local-repository.js')).createLocalRepository() : await (await import('./firebase-repository.js')).createFirebaseRepository(APP_CONFIG);
    adminPanel = createAdminPanel({ repository, config: APP_CONFIG, onNotice: showNotice, onError: errorMessage });
    reader = createReader({
      repository,
      getProgress,
      saveProgress,
      onError: (error) => {
        if ([403, 404, 410].includes(error.status)) {
          showNotice('Este manual não está disponível. Conferindo a biblioteca…');
          reader.close().catch(() => {});
          repository.refreshAvailability?.().catch(() => {});
        } else showNotice(errorMessage(error));
      },
    });
    repository.subscribeSession(updateSession);
    guidePanel = createGuidePanel({ repository, openManual: (game, options) => reader.open(game, options), onNotice: showNotice, scope: APP_CONFIG.firebase?.projectId || 'local' });
    repository.subscribeGames(
      (games) => {
        state.games = games;
        $('library-error').hidden = true;
        renderGrid();
        renderHero();
        renderRecent();
        if (state.selected) {
          const latest = games.find((game) => game.id === state.selected.id);
          if (latest) {
            state.selected = latest;
            guidePanel?.invalidate(latest);
            $('read-manual').disabled = !readableGame(latest);
            updateManualStatus(latest);
          }
        }
        if (state.selected && !games.some((game) => game.id === state.selected.id) && !state.busy) {
          guidePanel?.close(true);
          state.selected = null;
          if ($('detail-dialog').open) closeDialog('detail-dialog');
        }
      },
      (error) => {
        $('library-error').textContent = errorMessage(error);
        $('library-error').hidden = false;
      },
    );
  } catch (error) {
    $('connection-status').textContent = 'A conexão não ficou pronta';
    $('library-error').textContent = `${errorMessage(error)} Você pode abrir “Sobre o acervo” e escolher a biblioteca deste dispositivo.`;
    $('library-error').hidden = false;
    $('empty-description').textContent = 'Verifique a conexão com o Firebase ou use a biblioteca deste dispositivo em “Sobre o acervo”.';
  }
}
start();
