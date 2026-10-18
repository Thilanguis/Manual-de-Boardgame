import { lockPrivateCache } from './private-cache.js';
import { createPreparationQueue } from './preparation-queue.js';
import { createDocumentPanel } from './document-panel.js';
import { DOCUMENT_TYPES, gameDocuments, findDocument } from './documents.js';
import { createGameSteps } from './game-steps.js';
import { titleCandidates } from './recognition.js';
import { createAccountPanel } from './account-panel.js';
import { APP_CONFIG } from '../config/app-config.js';
import { fileErrorMessage } from './file-errors.js';
import { filterGames, playersLabel, validateGame, normalizeGameDraft, safeImageUrl, durationRange, durationLabel, isTechnicalTitle, displayTitle, displayDescription } from './model.js';
import { inspectPdf, imageToJpeg } from './pdf.js';
import { createReader } from './reader.js';
import { setupPwa } from './pwa.js';
import { createAdminPanel } from './admin-panel.js';
import { statusLabel } from './permissions.js';
import { readableGame, unavailableReason } from './catalog-availability.js';
import { createGuidePanel } from './guide-panel.js';
import { createKnowledgePanel } from './knowledge-panel.js';
import { createMetadataForm } from './metadata-form.js';
import { sourceField } from './metadata-consolidation.js';
import { vocabularyTerm } from './game-vocabulary.js';
import { portugueseCandidate } from './catalog-language.js';
import { bggWebsiteSearch } from './bgg-client.js';
import { createResearchPanel } from './research-panel.js';
import { RESEARCH_VERSION } from './research-contract.js';
import { cachedIndex, indexCacheKey } from './index-cache.js';
import { addOcrPage } from './pdf-knowledge.js';
import { createDraftProfile } from './draft-profile.js';
import { createInformationFlow } from './information-flow.js';
import { pdfIndexCandidate } from './pdf-profile.js';
import { metadataKeys, emptyValue } from './metadata-consolidation.js';
import { fieldLabels } from './research-client.js';

const $ = (id) => document.getElementById(id);
const state = { gamesLoading: true, games: [], filter: 'all', query: '', players: '', sort: 'recent', session: { resolving: true, canWrite: false, canRead: false, user: null }, selected: null, busy: false, importing: false };
let repository,
  adminPanel,
  guidePanel,
  knowledgePanel,
  preparationQueue,
  preparationSignature = '',
  documentPanel,
  additionalFiles = [],
  registrationSavingId = null,
  reader,
  draft = null,
  registrationOcr = null,
  manualBlob = null,
  draftCoverBlob = null,
  originalPdfCover = null,
  draftCoverURL = '',
  importAbort = null,
  importSequence = 0,
  noticeTimer,
  metadataForm,
  draftProfile,
  informationFlow,
  consolidatedDraft = null;
const gameSteps = createGameSteps({
  form: $('game-form'),
  dialog: $('upload-dialog'),
  getSession: () => state.session,
  getDocuments: () => [...gameDocuments(draft), ...additionalFiles],
  isBusy: () => state.busy || state.importing || researchPanel.isBusy() || informationFlow?.isBusy(),
  onEnter: (step) => {
    if (step === 2) {
      void informationFlow?.load();
      void researchPanel.loadExisting();
    } else if (step === 3) {
      researchPanel.cancel();
      informationFlow?.stop();
    }
  },
});
const localMode = APP_CONFIG.allowLocalDevelopment === true && ['localhost', '127.0.0.1'].includes(location.hostname) && new URLSearchParams(location.search).get('local') === '1';
if (localMode) document.body.classList.add('access-approved');
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
  if (error.uploadContext === 'large-pdf') return error.message;
  const messages = {
    'auth/user-disabled': 'Esta conta foi desativada. Entre em contato com o administrador.',
    'auth/user-not-found': 'E-mail ou senha incorretos.',
    'auth/wrong-password': 'E-mail ou senha incorretos.',
    'auth/popup-closed-by-user': 'O login com Google foi cancelado. Você pode tentar novamente ou usar e-mail e senha.',
    'auth/invalid-credential': 'E-mail ou senha incorretos.',
    'auth/invalid-email': 'Informe um e-mail válido.',
    'auth/too-many-requests': 'Muitas tentativas. Aguarde um pouco e tente novamente.',
    'auth/network-request-failed': 'Não foi possível conectar. Confira sua internet.',
    'auth/operation-not-allowed': 'Este método de acesso não está disponível. Tente outra opção ou fale com o administrador.',
    'auth/configuration-not-found': 'O serviço de acesso ainda não está pronto. Avise o administrador.',
    'auth/popup-blocked': 'O navegador bloqueou a janela de login. Permita popups para este site e tente novamente.',
    'auth/account-exists-with-different-credential': 'Esta conta usa outro método de login. Entre com e-mail e senha e vincule o Google em Minha conta para manter seu acesso.',
    'auth/email-already-in-use': 'Já existe uma conta com este e-mail. Entre ou use a recuperação de senha.',
    'auth/weak-password': 'Use uma senha com pelo menos oito caracteres.',
    'auth/unauthorized-domain': 'Este endereço não está autorizado para login. Use o endereço oficial do Acervo ou avise o administrador.',
    'resource-exhausted': 'O limite de uso foi atingido. Tente novamente mais tarde.',
    'permission-denied': 'Você não tem permissão para esta operação. Confira sua situação em Minha conta ou fale com o administrador.',
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
    showNotice('Não foi possível guardar suas preferências neste navegador.');
  }
}
function getProgress(id) {
  return readPreferences('reading')[id];
}
function saveProgress(id, progress) {
  const reading = readPreferences('reading');
  reading[id] = progress;
  writePreferences('reading', reading);
  const dismissed = readPreferences('reading-dismissed');
  if (dismissed[id]) {
    delete dismissed[id];
    writePreferences('reading-dismissed', dismissed);
  }
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
  if (id === 'login-dialog' && !localMode && !state.session.canRead) return;
  if (id === 'guide-dialog') {
    guidePanel?.close();
    return;
  }
  if (state.busy && ['upload-dialog', 'delete-dialog'].includes(id)) {
    showNotice('Aguarde a operação terminar para fechar.');
    return;
  }
  if (id === 'upload-dialog') {
    researchPanel.cancel();
    draftProfile?.cancel();
    informationFlow?.stop();
  }
  $(id).close();
}
document.querySelectorAll('[data-close]').forEach((button) => (button.onclick = () => closeDialog(button.dataset.close)));
document.querySelectorAll('dialog').forEach((dialog) => {
  dialog.addEventListener('cancel', (event) => {
    if (dialog.id === 'login-dialog' && !localMode && !state.session.canRead) event.preventDefault();
    if (state.busy && ['upload-dialog', 'delete-dialog'].includes(dialog.id)) {
      event.preventDefault();
      showNotice('Aguarde a operação terminar para fechar.');
    }
  });
  dialog.addEventListener('close', () => {
    if (!document.querySelector('dialog[open]')) document.body.classList.remove('modal-open');
    if (dialog.id === 'upload-dialog') {
      const saved = additionalFiles.length && draft?.id && state.games.some((game) => game.id === draft.id);
      resetDraft();
      if (saved) void preparationQueue?.update(state.games);
    }
    if (dialog.id === 'detail-dialog' && !$('game-management-dialog').open) documentPanel?.close();
    if (dialog.id === 'game-management-dialog') {
      knowledgePanel?.suspend();
      if (!$('detail-dialog').open) documentPanel?.close();
    }
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
    if (!state.session.canRead || image.dataset.gameId !== id || !url || !image.isConnected) return;
    image.src = url;
    image.hidden = false;
    image.onerror = () => {
      image.hidden = true;
      $('cover-warning').hidden = !state.session.canRead;
    };
  } catch (error) {
    if (state.session.canRead && image.isConnected && image.dataset.gameId === id) {
      image.title = fileErrorMessage(error);
      $('cover-warning').hidden = false;
      $('cover-warning').title = fileErrorMessage(error);
    }
  }
}
function renderGrid() {
  const matches = state.games.flatMap((game) => game.sources?.catalog?.matches || []),
    bggMatch = matches.find((match) => match.source === 'bgg' && safeImageUrl(match.attributionLogo));
  $('ludopedia-attribution').hidden = !matches.some((match) => match.source === 'ludopedia');
  $('bgg-attribution').hidden = !bggMatch;
  if (bggMatch) {
    const img = document.createElement('img');
    img.src = bggMatch.attributionLogo;
    img.alt = 'Powered by BGG';
    img.width = 150;
    $('bgg-attribution').replaceChildren(img);
  }
  const available = state.games.filter(readableGame);
  const games = filterGames(available, { ...state, favorites: readPreferences('favorites') });
  $('game-count').textContent = `${available.length} ${available.length === 1 ? 'jogo' : 'jogos'}`;
  $('games-grid').replaceChildren();
  $('empty-state').hidden = state.gamesLoading || available.length > 0;
  $('no-results').hidden = state.gamesLoading || !available.length || games.length > 0;
  renderUnavailable();
  const repair = state.games.filter((g) => isTechnicalTitle(g.title));
  $('title-repairs').hidden = !state.session.canEdit || !repair.length;
  $('title-repairs').replaceChildren();
  for (const game of state.session.canEdit ? repair : []) {
    const row = node('div', 'unavailable-row');
    row.append(node('p', null, 'Um jogo está com título técnico. Confirme o nome para melhorar a biblioteca.'));
    const fix = node('button', 'button secondary small', 'Revisar título');
    fix.type = 'button';
    fix.onclick = () => showGame(game);
    row.append(fix);
    $('title-repairs').append(row);
  }
  for (const game of games) {
    const card = node('article', 'game-card'),
      button = node('button', 'card-main');
    button.type = 'button';
    button.setAttribute('aria-label', `Ver ${displayTitle(game)}`);
    const cover = node('div', 'card-cover'),
      image = node('img');
    image.alt = '';
    image.loading = 'lazy';
    cover.append(icon('book'), image);
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
    if (durationRange(game).minDurationMinutes) {
      const duration = node('span', null, durationLabel(game));
      duration.prepend(icon('clock'));
      meta.append(duration);
    }
    if (!meta.children.length) meta.append(node('span', null, `${game.manual?.pages || '—'} páginas`));
    button.append(cover, node('span', 'card-title', displayTitle(game)), meta);
    button.onclick = () => showGame(game);
    const favorite = node('button', `card-favorite ${readPreferences('favorites').includes(game.id) ? 'is-favorite' : ''}`);
    favorite.type = 'button';
    favorite.append(icon('heart'));
    favorite.setAttribute('aria-label', `Favoritar ${displayTitle(game)}`);
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
const lastViewedGames = new Map();
function rememberGame(game) {
  if (!readableGame(game)) return;
  lastViewedGames.set(storageKey('last-viewed'), game.id);
  writePreferences('last-viewed', { gameId: game.id });
  void renderHero();
}
async function renderHero() {
  const token = ++heroSequence;
  const lastId = lastViewedGames.get(storageKey('last-viewed')) || readPreferences('last-viewed').gameId;
  const game = state.games.find((game) => game.id === lastId && readableGame(game));
  const hero = document.querySelector('.hero');
  hero.hidden = !game;
  hero.classList.toggle('has-game', !!game);
  $('hero-art').hidden = !!game;
  $('hero-meta').hidden = !game;
  $('hero-backdrop').style.backgroundImage = '';
  $('hero-meta').replaceChildren();
  $('hero-source').replaceChildren();
  $('hero-main').querySelector('span').textContent = game ? 'Ler manual' : state.session.canAdd ? 'Adicionar meu primeiro jogo' : 'Entrar na biblioteca';
  $('hero-main')
    .querySelector('use')
    .setAttribute('href', `#i-${game ? 'book' : 'plus'}`);
  if (!game) {
    $('hero-title').textContent = '';
    $('hero-description').textContent = '';
    $('hero-main').onclick = null;
    return;
  }
  $('hero-title').textContent = displayTitle(game);
  $('hero-description').textContent = displayDescription(game);
  const wikiDescription = displayDescription(game) && (game.sources?.catalog?.matches || []).find((match) => match.source === 'wikipedia' && match.licenseUrl);
  if (wikiDescription) {
    const source = node('a', null, 'Wikipédia · autores');
    source.href = wikiDescription.url;
    source.target = '_blank';
    source.rel = 'noopener noreferrer';
    const license = node('a', null, 'CC BY-SA 4.0');
    license.href = wikiDescription.licenseUrl;
    license.target = '_blank';
    license.rel = 'noopener noreferrer';
    $('hero-source').append(source, document.createTextNode(' · '), license);
  }
  if (game.minPlayers) {
    const span = node('span', null, playersLabel(game));
    span.prepend(icon('users'));
    $('hero-meta').append(span);
  }
  if (durationRange(game).minDurationMinutes) {
    const span = node('span', null, durationLabel(game));
    span.prepend(icon('clock'));
    $('hero-meta').append(span);
  }
  $('hero-main').onclick = () => reader.open(game);
  try {
    const url = await repository.getCoverURL(game);
    if (token === heroSequence && url) $('hero-backdrop').style.backgroundImage = `url(${JSON.stringify(url)})`;
  } catch (error) {
    if (token === heroSequence && state.session.canRead) {
      $('cover-warning').hidden = false;
      $('cover-warning').title = fileErrorMessage(error);
    }
  }
}
function renderRecent() {
  if (!repository) return;
  const reading = readPreferences('reading');
  const dismissed = readPreferences('reading-dismissed');
  const games = state.games
    .filter((game) => reading[game.id] && !dismissed[game.id] && readableGame(game))
    .sort((a, b) => reading[b.id].lastRead - reading[a.id].lastRead)
    .slice(0, 6);
  $('recent-section').hidden = !games.length;
  $('recent-row').replaceChildren();
  for (const game of games) {
    const progress = reading[game.id],
      entry = node('div', 'recent-entry'),
      card = node('button', 'recent-card'),
      image = node('img');
    image.alt = '';
    const info = node('div');
    info.append(node('strong', null, displayTitle(game)), node('span', null, `Página ${progress.page} de ${progress.total}`));
    const bar = node('progress');
    bar.max = progress.total;
    bar.value = progress.page;
    bar.setAttribute('aria-label', `Leitura de ${game.title}`);
    info.append(bar);
    card.append(image, info);
    card.onclick = () => {
      rememberGame(game);
      return reader.open(game);
    };
    const remove = node('button', 'recent-remove', '×');
    remove.type = 'button';
    remove.title = 'Remover de Continue de onde parou';
    remove.setAttribute('aria-label', `Remover ${displayTitle(game)} de Continue de onde parou`);
    remove.onclick = () => {
      writePreferences('reading-dismissed', { ...readPreferences('reading-dismissed'), [game.id]: true });
      entry.remove();
      $('recent-section').hidden = !$('recent-row').children.length;
    };
    entry.append(card, remove);
    $('recent-row').append(entry);
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
  if (knowledgePanel?.isBusy() && !confirm('Há alterações não salvas no conhecimento. Descartar e abrir este jogo?')) return;
  knowledgePanel?.close();
  rememberGame(game);
  state.selected = game;
  if ($('game-management-dialog').open) $('game-management-dialog').close();
  documentPanel?.open(game);
  $('detail-title').textContent = displayTitle(game);
  $('detail-edition').textContent = game.edition ? 'Edição · ' + game.edition : '';
  $('detail-edition').hidden = !game.edition;
  $('detail-title-warning').hidden = !isTechnicalTitle(game.title);
  $('detail-title-warning').textContent = state.session.canEdit
    ? 'O título original deste cadastro é técnico e precisa de revisão. Use Editar informações para confirmar o nome real.'
    : 'O nome deste jogo está em revisão. O manual continua disponível.';
  $('detail-description').textContent = displayDescription(game);
  $('detail-description').hidden = !displayDescription(game);
  $('detail-description').classList.remove('expanded');
  $('detail-description-toggle').setAttribute('aria-expanded', 'false');
  $('detail-description-toggle').textContent = 'Ver mais';
  $('detail-cover').alt = `Capa de ${displayTitle(game)}`;
  populateImage($('detail-cover'), game);
  $('detail-tags').replaceChildren(...[...new Set([...(game.tags || []), ...(game.mechanics || []), game.gameType].filter(Boolean).map(vocabularyTerm))].map((tag) => node('span', null, tag)));
  $('detail-stats').replaceChildren();
  for (const [symbol, label, value] of [
    ['users', 'JOGADORES', playersLabel(game)],
    ['clock', 'DURAÇÃO', durationLabel(game)],
    ['users', 'IDADE', game.recommendedAge ? `${game.recommendedAge}+ anos` : 'Não informada'],
    ['book', 'IDIOMA', { 'pt-BR': 'Português', pt: 'Português', en: 'Inglês', fr: 'Francês', es: 'Espanhol' }[game.language] || 'Não informado'],
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
  $('delete-game').hidden = !state.session.canDelete;
  $('delete-game').parentElement.hidden = !state.session.canDelete;
  $('edit-game').disabled = game.deleting === true;
  $('read-manual').disabled = !readableGame(game);
  $('delete-game').textContent = game.deleting ? 'Concluir exclusão pendente' : 'Excluir jogo';
  const catalogLinks = $('detail-catalog-sources');
  catalogLinks.replaceChildren();
  const attributions = new Map();
  for (const item of Object.values(game.sources || {})) if (item?.url && /^https:\/\//.test(item.url)) attributions.set(item.url, item.source);
  for (const match of game.sources?.catalog?.matches || [])
    attributions.set(match.url, match.source === 'ludopedia' ? 'Ludopedia' : match.source === 'bgg' ? 'Powered by BoardGameGeek' : match.source === 'wikipedia' ? 'Autores da Wikipédia' : 'Wikidata');
  for (const [url, label] of attributions) {
    const a = node('a', 'text-button', label + ' ↗');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    catalogLinks.append(a);
  }
  for (const match of game.sources?.catalog?.matches || [])
    if (match.licenseUrl) {
      const a = node('a', 'text-button', match.license + ' · trecho/ajustes sob a mesma licença');
      a.href = match.licenseUrl;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      catalogLinks.append(a);
      if (match.authorsUrl) {
        const authors = node('a', 'text-button', 'Autores e histórico ↗');
        authors.href = match.authorsUrl;
        authors.target = '_blank';
        authors.rel = 'noopener noreferrer';
        catalogLinks.append(authors);
      }
    }
  $('detail-source').hidden = !game.bgg?.id;
  if (game.bgg?.id) $('detail-source').href = `https://boardgamegeek.com/boardgame/${Number(game.bgg.id)}`;
  renderFavorite();
  showDialog('detail-dialog');
  requestAnimationFrame(updateDescriptionToggle);
}
function updateDescriptionToggle() {
  const description = $('detail-description');
  $('detail-description-toggle').hidden = description.hidden || description.scrollHeight <= parseFloat(getComputedStyle(description).lineHeight) * 4 + 2;
}
new ResizeObserver(updateDescriptionToggle).observe($('detail-description'));
$('detail-description-toggle').onclick = () => {
  const expanded = $('detail-description').classList.toggle('expanded');
  $('detail-description-toggle').setAttribute('aria-expanded', String(expanded));
  $('detail-description-toggle').textContent = expanded ? 'Ver menos' : 'Ver mais';
};
function updateManualStatus(game) {
  $('detail-manual').textContent = readableGame(game) ? '' : unavailableReason(game);
  $('detail-manual').hidden = readableGame(game);
}
$('detail-favorite').onclick = () => toggleFavorite(state.selected.id);
$('read-manual').onclick = () => reader.open(state.selected);
$('quick-rules').onclick = () => guidePanel.open(state.selected);
function formatBytes(size = 0) {
  return size >= 1024 * 1024 ? `${(size / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(size / 1024)} KB`;
}
function resetDraft() {
  informationFlow?.stop();
  researchPanel.reset();
  metadataForm?.reset();
  $('research-applied').hidden = true;
  gameSteps.reset();
  $('bgg-search').removeAttribute('aria-busy');
  importAbort?.abort();
  ++importSequence;
  if (draftCoverURL.startsWith('blob:')) URL.revokeObjectURL(draftCoverURL);
  draft = manualBlob = draftCoverBlob = originalPdfCover = null;
  registrationOcr = null;
  additionalFiles = [];
  $('registration-pdfs').hidden = true;
  $('registration-pdfs').disabled = false;
  $('additional-pdf-file').value = '';
  $('additional-pdfs')?.replaceChildren();
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
  const data = { ...draft, ...durationRange(draft) };
  for (const field of ['title', 'description', 'minPlayers', 'maxPlayers', 'minDurationMinutes', 'maxDurationMinutes', 'language', 'recommendedAge', 'gameType', 'edition'])
    form.elements.namedItem(field).value = data[field] ?? (field === 'language' ? 'other' : '');
  form.elements.namedItem('mechanics').value = (draft.mechanics || []).join(', ');
  form.elements.namedItem('tags').value = (draft.tags || []).join(', ');
  form.elements.namedItem('isPublic').checked = !draft.id || draft.isPublic === true;
  form.elements.namedItem('confirmed').checked = false;
  $('file-info').textContent = `${draft.manual.name} · ${formatBytes(draft.manual.size)} · ${draft.manual.pages} páginas`;
  $('upload-picker').hidden = true;
  form.hidden = false;
  gameSteps.show();
  $('title-warning').hidden = !isTechnicalTitle(draft.title);
  $('title-warning').textContent = 'Este cadastro usa um nome técnico. Escolha uma alternativa ou digite o título real; o original só muda ao salvar.';
  previewCover();
  renderEvidence();
  $('use-pdf-cover').hidden = !originalPdfCover;
  $('replace-pdf-label').hidden = !draft.id || !state.session.canEdit;
  renderRegistrationPdfs();
  metadataForm?.refresh();
  $('bgg-search').disabled = true;
  $('bgg-search').hidden = true;
  $('bgg-web-search').hidden = !$('bgg-search').disabled;
  $('bgg-web-search').href = bggWebsiteSearch($('game-title').value);
  $('bgg-search').title = $('bgg-search').disabled ? 'A consulta ao BoardGameGeek ainda não está ativa neste acervo.' : 'Buscar informações complementares no BoardGameGeek';
  $('bgg-status').textContent = 'Consulta manual em outra aba. A pesquisa automática usa as fontes disponíveis acima.';
}
function renderEvidence() {
  $('source-evidence').replaceChildren();
  const labels = { title: 'Nome', players: 'Jogadores', duration: 'Duração', description: 'Descrição', cover: 'Capa', recommendedAge: 'Idade', gameType: 'Tipo', edition: 'Edição', mechanics: 'Mecânicas', tags: 'Categorias', language: 'Idioma' };
  for (const [key, value] of Object.entries(draft.sources || {})) {
    if (!value || typeof value !== 'object') continue;
    const paragraph = node('p');
    paragraph.append(node('strong', null, `${labels[key] || key}: ${value.source}${value.page ? ' · p. ' + value.page : ''}`), document.createElement('br'), document.createTextNode(value.excerpt || 'Sem trecho disponível.'));
    if (value.url && /^https:\/\//.test(value.url)) {
      const a = node('a', null, 'Consultar a origem ↗');
      a.href = value.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      paragraph.append(document.createElement('br'), a);
    }
    $('source-evidence').append(paragraph);
  }
  if (!$('source-evidence').children.length) $('source-evidence').append(node('p', null, 'Não foi possível extrair informações. Preencha apenas os dados que você conhece.'));
}
async function importFile(file) {
  informationFlow?.stop();
  draftProfile?.cancel();
  let needsOcr = false;
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
    needsOcr = !textFound;
    draft = { ...record };
    const localized = portugueseCandidate({ fields: record, language: record.language, descriptionLanguage: record.language });
    const originalFields = Object.fromEntries(
      ['title', 'edition', 'description', 'minPlayers', 'maxPlayers', 'minDurationMinutes', 'maxDurationMinutes', 'recommendedAge', 'tags', 'mechanics', 'gameType']
        .filter((key) => record[key] != null && record[key] !== '' && (!Array.isArray(record[key]) || record[key].length))
        .map((key) => [key, record[key]]),
    );
    for (const pending of localized.pendingTranslations) {
      originalFields[pending.key] = pending.value;
      draft[pending.key] = Array.isArray(pending.value) ? [] : '';
    }
    for (const field of ['tags', 'mechanics', 'gameType']) if (localized.fields[field]) draft[field] = localized.fields[field];
    if (Object.keys(originalFields).length) draft.sources.pdfOriginalMetadata = { manualHash: record.manual.sha256, language: record.language, fields: originalFields };
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
        $('title-warning').hidden = true;
        renderEvidence();
        researchPanel.invalidate();
      };
      $('title-suggestions').append(button);
    }
    $('game-title').focus();
  } catch (error) {
    if (error.name !== 'AbortError' && token === importSequence) $('upload-status').textContent = errorMessage(error);
  } finally {
    if (token === importSequence) {
      state.importing = false;
      $('registration-pdfs').disabled = false;
    }
    $('pdf-file').disabled = false;
    $('pdf-file').value = '';
  }
  return { needsOcr };
}
function renderRegistrationPdfs() {
  $('registration-pdfs').hidden = !draft;
  $('registration-pdfs').disabled = state.busy || state.importing;
  if (!draft) return;
  const count = gameDocuments(draft).length + additionalFiles.length;
  $('registration-pdfs').querySelector('legend').textContent = `${count} ${count === 1 ? 'PDF neste jogo' : 'PDFs neste jogo'}`;
  $('registration-main-pdf').textContent = `${draft.manual.name} · Manual principal`;
  $('additional-pdf-file').disabled = !state.session.canEdit;
  $('registration-pdf-permission').hidden = state.session.canEdit;
  const list = $('additional-pdfs');
  list.replaceChildren();
  for (const item of additionalFiles) {
    const row = node('div', 'registration-pdf-row');
    row.dataset.registrationDocument = item.id;
    row.append(node('small', null, `${item.file.name} · ${formatBytes(item.file.size)}${item.manual ? ` · ${item.manual.pages} páginas` : ' · Não preparado'}`));
    const label = node('label', null, 'Nome do documento'),
      name = node('input');
    name.type = 'text';
    name.value = item.name;
    name.maxLength = 160;
    name.setAttribute('aria-label', `Nome de ${item.file.name}`);
    name.oninput = () => {
      item.name = name.value;
    };
    label.append(name);
    row.append(label);
    const fields = node('div', 'form-row');
    for (const [key, title, options] of [
      ['documentType', 'Tipo', Object.entries(DOCUMENT_TYPES).filter(([value]) => value !== 'principal')],
      [
        'language',
        'Idioma',
        [
          ['pt-BR', 'Português'],
          ['en', 'Inglês'],
          ['fr', 'Francês'],
          ['other', 'Outro / não identificado'],
        ],
      ],
    ]) {
      const label = node('label', null, title),
        select = node('select');
      select.setAttribute('aria-label', `${title} de ${item.file.name}`);
      for (const [value, text] of options) {
        const option = node('option', null, text);
        option.value = value;
        select.append(option);
      }
      select.value = item[key] === 'pt' ? 'pt-BR' : item[key];
      select.onchange = () => {
        item[key] = select.value;
      };
      label.append(select);
      fields.append(label);
    }
    const remove = node('button', 'text-button', 'Retirar');
    remove.type = 'button';
    remove.setAttribute('aria-label', `Retirar ${item.file.name}`);
    remove.onclick = () => {
      if (state.busy || state.importing) return;
      additionalFiles = additionalFiles.filter((entry) => entry !== item);
      informationFlow.stop();
      researchPanel.invalidate();
      renderRegistrationPdfs();
    };
    fields.append(remove);
    row.append(fields);
    if (item.error) row.append(node('p', 'inline-error', item.error));
    list.append(row);
  }
}
async function appendRegistrationPdfs(files) {
  if (!draft || state.busy || state.importing || !state.session.canEdit) return;
  const selected = [...files];
  if (!selected.length) return;
  const count = gameDocuments(draft).length + additionalFiles.length;
  if (count + selected.length > 12) {
    $('save-error').textContent = 'Use até 12 PDFs por jogo. Nenhum arquivo desta seleção foi acrescentado.';
    $('save-error').hidden = false;
    return;
  }
  const token = importSequence,
    currentHash = draft.manual.sha256,
    errors = [];
  state.importing = true;
  $('registration-pdfs').disabled = true;
  $('save-game').disabled = true;
  $('save-error').hidden = true;
  try {
    for (const file of selected) {
      try {
        $('upload-status').textContent = `Conferindo ${file.name}…`;
        const info = await inspectPdf(file, { maxBytes: APP_CONFIG.maxPdfBytes, signal: importAbort?.signal });
        if (token !== importSequence || draft?.manual.sha256 !== currentHash || !$('upload-dialog').open) return;
        if ([...gameDocuments(draft), ...additionalFiles].some((item) => item.manual?.sha256 === info.manual.sha256)) throw Object.assign(new Error('Este PDF já está na lista deste jogo.'), { code: 'registration/duplicate' });
        informationFlow.stop();
        additionalFiles.push({ id: crypto.randomUUID(), file, name: file.name.replace(/\.pdf$/i, '').slice(0, 160), documentType: 'complemento', language: info.language || 'other', edition: info.edition || '', manual: info.manual });
      } catch (error) {
        if (token !== importSequence || error.name === 'AbortError') return;
        if (error.code !== 'registration/duplicate')
          additionalFiles.push({ id: crypto.randomUUID(), file, name: file.name.replace(/\.pdf$/i, '').slice(0, 160), documentType: 'complemento', language: 'other', edition: '', manual: null, error: errorMessage(error) });
        errors.push(`${file.name}: ${errorMessage(error)}`);
      }
    }
  } finally {
    if (token === importSequence) {
      state.importing = false;
      $('registration-pdfs').disabled = false;
      $('save-game').disabled = false;
      $('upload-status').textContent = '';
      renderRegistrationPdfs();
      researchPanel.invalidate();
      if (errors.length) {
        $('save-error').textContent = errors.join(' ');
        $('save-error').hidden = false;
      }
    }
  }
}
async function importFiles(files) {
  if (state.busy || state.importing) return;
  const selected = [...files];
  if (selected.length > 12) {
    $('upload-status').textContent = 'Selecione até 12 PDFs do mesmo jogo.';
    return;
  }
  const result = await importFile(selected[0]);
  const token = importSequence;
  if (draft && $('upload-dialog').open) {
    await appendRegistrationPdfs(selected.slice(1));
    if (token !== importSequence || !$('upload-dialog').open) return;
    // A importação só identifica; completar a ficha é uma ação da etapa 2.
  }
}
$('pdf-file').onchange = (event) => importFiles(event.target.files);
$('additional-pdf-file').onchange = async (event) => {
  const files = [...event.target.files];
  event.target.value = '';
  await appendRegistrationPdfs(files);
};
for (const type of ['dragenter', 'dragover'])
  $('dropzone').addEventListener(type, (event) => {
    event.preventDefault();
    $('dropzone').classList.add('dragover');
  });
for (const type of ['dragleave', 'drop'])
  $('dropzone').addEventListener(type, (event) => {
    event.preventDefault();
    $('dropzone').classList.remove('dragover');
    if (type === 'drop') importFiles(event.dataTransfer.files);
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
  researchPanel.invalidate();
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
    informationFlow.stop();
    researchPanel.invalidate();
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
const researchPanel = createResearchPanel({
  root: $('research-panel'),
  getRepository: () => repository,
  getDocuments: () => [...gameDocuments(draft), ...additionalFiles],
  onPrepareDraft: () => informationFlow.complete(),
  onCancel: () => informationFlow.stop(),
  onInvalidate: () => informationFlow?.invalidate(),
  getPdf: () => manualBlob || repository.getManual(draft),
  onOcrPage(page, current) {
    if (page.status !== 'done' || !current.manual?.sha256) return;
    if (registrationOcr?.hash !== current.manual.sha256) registrationOcr = { hash: current.manual.sha256, pages: new Map() };
    registrationOcr.pages.set(page.page, page);
  },
  canUse: () => !!draft && !state.busy && !state.importing && $('upload-dialog').open && state.session.canWrite,
  getCurrent() {
    if (!draft) return null;
    const values = Object.fromEntries(new FormData($('game-form')).entries());
    for (const key of ['minPlayers', 'maxPlayers', 'minDurationMinutes', 'maxDurationMinutes', 'recommendedAge']) values[key] = values[key] ? Number(values[key]) : null;
    for (const key of ['tags', 'mechanics'])
      values[key] = String(values[key] || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    return { ...draft, ...values };
  },
  readPreference: () => readPreferences('recognition').language,
  writePreference: (language) => writePreferences('recognition', { language }),
  onConsolidated(model) {
    consolidatedDraft = model;
    metadataForm?.update(model);
  },
  onApplied() {
    $('research-applied').hidden = true;
    return gameSteps.go(2, false);
  },
});
function currentMetadata() {
  const values = Object.fromEntries(new FormData($('game-form')).entries());
  return draft ? { ...draft, ...normalizeGameDraft(values) } : null;
}
function applyMetadataValues(values, model, { automatic = false, retract = false } = {}) {
  if (!draft || !$('upload-dialog').open || !state.session.canWrite || state.busy) return;
  const normalized = normalizeGameDraft({ ...currentMetadata(), ...values });
  if (automatic && Object.keys(values).length) $('game-form').elements.namedItem('confirmed').checked = false;
  draft = { ...draft, ...normalized, sources: { ...draft.sources } };
  for (const [key, value] of Object.entries(values)) {
    const input = $('game-form').elements.namedItem(key);
    if (input) input.value = Array.isArray(value) ? value.join(', ') : String(value ?? '');
    if (retract) {
      delete draft.sources[sourceField(key)];
      continue;
    }
    const origin = model.fieldSources?.[key] || model;
    draft.sources[sourceField(key)] = {
      ...(origin.evidence || {}),
      source: automatic ? (origin.source === 'gemini' ? 'Gemini · sugestão do manual' : 'Sugestão · ' + origin.source) : 'Conferido e ajustado por você',
      excerpt: origin.evidence?.excerpt || String(value),
      url: origin.url || '',
      license: origin.license || '',
      ...(origin.licenseUrl ? { licenseUrl: origin.licenseUrl, authorsUrl: origin.authorsUrl || '', modified: true } : {}),
      language: origin.language || 'unknown',
      originalLanguage: origin.originalLanguage || origin.language || 'unknown',
      originalValue: origin.originalValue ?? value,
      fetchedAt: origin.fetchedAt || Date.now(),
      ...(automatic ? {} : { confirmedAt: Date.now() }),
    };
  }
  const previous = draft.sources.catalog?.matches || [];
  const members = (model.members || []).filter((m) => !['pdf', 'gemini'].includes(m.source));
  const matches = members.map((m) => ({
    source: m.source,
    id: m.id,
    url: m.url || '',
    identifiers: m.identifiers || {},
    names: m.names || [],
    edition: m.edition || '',
    language: m.language || 'unknown',
    kind: m.kind || 'unknown',
    originalFields: m.fields,
    sourceFamily: m.sourceFamily || '',
    derivedFrom: m.derivedFrom || '',
    independenceKey: m.independenceKey || '',
    independenceVerified: m.independenceVerified === true,
    quality: m.quality || 'catalog',
    fieldTranslations: m.fieldTranslations || {},
    license: m.license || '',
    licenseUrl: m.licenseUrl || '',
    authorsUrl: m.authorsUrl || '',
    manualHash: draft.manual.sha256,
    fetchedAt: m.fetchedAt || Date.now(),
  }));
  if (matches.length) draft.sources.catalog = { source: 'Fontes reunidas · confira na ficha', excerpt: '', matches: [...previous.filter((old) => !matches.some((m) => m.source === old.source && m.id === old.id)), ...matches].slice(-6) };
  // As escolhas e suas evidências acompanham o salvamento normal do cadastro.
  draft.sources.metadata = { source: 'Ficha consolidada', excerpt: '', manualHash: draft.manual.sha256, fields: model.fields, origins: model.fieldSources, alternatives: model.alternatives, consistency: model.consistency };
  renderEvidence();
  gameSteps.refresh();
}
metadataForm = createMetadataForm({
  form: $('game-form'),
  getCurrent: currentMetadata,
  apply: applyMetadataValues,
  onManualEdit(key, value) {
    if (!draft) return;
    draft.sources ||= {};
    draft.sources[sourceField(key)] = { source: 'Conferido e ajustado por você', excerpt: value };
  },
});
draftProfile = createDraftProfile({
  getRepository: () => repository,
  getCurrent: currentMetadata,
  getDocuments: () => (draft && manualBlob ? [{ id: 'main', name: draft.manual.name, language: draft.language, manual: draft.manual, blob: manualBlob }, ...additionalFiles.map((d) => ({ ...d, blob: d.file }))] : []),
  onRecord: (record, game) => researchPanel.acceptKnowledge(record, game),
  onIndex(index, document) {
    if (document.id !== 'main' || !draft) return;
    const candidate = pdfIndexCandidate(index, { ...currentMetadata(), id: index.gameId }, document);
    if (candidate) researchPanel.acceptPdf(candidate);
  },
  onStatus: (message) => {
    if ($('upload-dialog').open) researchPanel.setKnowledgeStatus(message);
  },
});
informationFlow = createInformationFlow({
  getRepository: () => repository,
  getCurrent: currentMetadata,
  draftProfile,
  scope: APP_CONFIG.firebase?.projectId || 'local',
  getDocuments: () => [...gameDocuments(draft), ...additionalFiles],
  onPdf: (candidate) => researchPanel.acceptPdf(candidate),
  canUse: () => !!draft && $('upload-dialog').open && gameSteps.current === 2 && state.session.canWrite && !state.busy,
  onRecord: (record, game) => researchPanel.acceptKnowledge(record, game),
  onStatus: (message) => researchPanel.setKnowledgeStatus(message),
});
$('game-title').addEventListener('input', () => {
  $('bgg-web-search').href = bggWebsiteSearch($('game-title').value);
  $('title-warning').hidden = !isTechnicalTitle($('game-title').value);
  queueMicrotask(() => researchPanel.invalidate());
});
$('bgg-web-search').addEventListener('click', () => {
  $('bgg-web-search').href = bggWebsiteSearch($('game-title').value);
});
$('game-form')
  .elements.namedItem('language')
  .addEventListener('change', () => {
    const value = $('game-form').elements.namedItem('language').value;
    if (value === draft?.language) return;
    if (draft) draft.language = value;
    researchPanel.invalidate({ identityChanged: false });
  });
$('game-form')
  .elements.namedItem('edition')
  .addEventListener('input', () => {
    informationFlow.stop();
    queueMicrotask(() => researchPanel.invalidate());
  });
$('game-form').onsubmit = async (event) => {
  event.preventDefault();
  if (!draft || state.busy || state.importing) return;
  if (gameSteps.current < 3) {
    gameSteps.next();
    return;
  }
  $('save-error').hidden = true;
  try {
    if (!$('game-form').elements.namedItem('confirmed').checked) throw new Error('Confira os dados e marque a confirmação antes de salvar.');
    if (!draft || state.busy || !$('upload-dialog').open || !state.session.canWrite) return;
    if (!$('game-form').elements.namedItem('confirmed').checked) {
      gameSteps.go(2, false);
      throw new Error('A ficha recebeu informações novas. Confira os dados antes de salvar.');
    }
    if (metadataForm.unresolved().length) {
      gameSteps.go(2, false);
      throw new Error('Confira as divergências indicadas antes de salvar.');
    }
    const expectedDocuments = [...additionalFiles].map((item) => ({ id: item.id, hash: item.manual?.sha256, item }));
    if (additionalFiles.some((item) => !item.manual)) {
      gameSteps.go(1, false);
      throw new Error('Há PDFs que não puderam ser preparados. Retire os arquivos indicados ou selecione cópias válidas antes de salvar.');
    }
    if (additionalFiles.some((item) => !item.name.trim())) {
      gameSteps.go(1, false);
      throw new Error('Informe o nome de cada PDF adicional.');
    }
    if (consolidatedDraft) applyMetadataValues({}, consolidatedDraft, { automatic: true });
    const values = Object.fromEntries(new FormData($('game-form')).entries());
    const normalized = validateGame(values);
    const sources = { ...draft.sources };
    const before = { ...draft, ...durationRange(draft) };
    for (const [field, sourceField] of [
      ['title', 'title'],
      ['description', 'description'],
      ['minPlayers', 'players'],
      ['maxPlayers', 'players'],
      ['minDurationMinutes', 'duration'],
      ['maxDurationMinutes', 'duration'],
      ['recommendedAge', 'recommendedAge'],
      ['gameType', 'gameType'],
      ['edition', 'edition'],
      ['language', 'language'],
    ])
      if ((before[field] ?? '') !== (normalized[field] ?? ''))
        sources[sourceField] = { source: 'Conferido e ajustado por você', excerpt: sourceField === 'players' ? playersLabel(normalized) : sourceField === 'duration' ? durationLabel(normalized) : String(normalized[field] ?? '') };
    for (const field of ['tags', 'mechanics']) if (JSON.stringify(draft[field] || []) !== JSON.stringify(normalized[field])) sources[field] = { source: 'Conferido e ajustado por você', excerpt: normalized[field].join(', ') };
    for (const key of ['title', 'description', 'players', 'duration', 'recommendedAge', 'gameType', 'edition', 'tags', 'mechanics']) {
      if (/^Sugestão|^Gemini · sugestão/.test(sources[key]?.source || '')) sources[key] = { ...sources[key], confirmedAt: Date.now() };
    }
    researchPanel.confirmFields({ ...draft, ...normalized });
    researchPanel.cancel();
    state.busy = true;
    $('registration-pdfs').disabled = true;
    $('game-form')
      .querySelectorAll('button,input,textarea,select')
      .forEach((el) => (el.disabled = true));
    if (!draft.id) draft.id = repository.reserveGameId ? await repository.reserveGameId(draft.manual.sha256) : crypto.randomUUID();
    registrationSavingId = draft.id;
    await preparationQueue.update(state.games.filter((game) => game.id !== registrationSavingId));
    let record = { ...draft, ...normalized, sources };
    let registrationBlob = manualBlob;
    if (manualBlob && state.games.some((game) => game.id === record.id)) {
      const current = await repository.latestGame(state.games.find((game) => game.id === record.id));
      const principal = findDocument(current);
      const replaced = await repository.saveDocument(current, { ...principal, manual: record.manual, language: record.language }, manualBlob);
      record = { ...record, manual: replaced.manual, documents: replaced.documents, primaryDocumentId: replaced.primaryDocumentId, updatedAt: replaced.updatedAt };
      registrationBlob = null;
    }
    $('upload-progress').hidden = repository.mode !== 'firebase';
    $('upload-progress').value = 0;
    $('upload-status').textContent = 'Salvando seu jogo…';
    const result = await repository.saveGame(record, {
      manualBlob: registrationBlob,
      coverBlob: draftCoverBlob,
      onProgress: (percent) => {
        $('upload-progress').value = percent;
        $('upload-status').textContent = `Enviando manual: ${percent}%`;
      },
    });
    if (registrationOcr?.hash === record.manual.sha256 && registrationOcr.pages.size) {
      const game = result.game || record;
      const key = indexCacheKey(APP_CONFIG.firebase?.projectId || 'local', repository.session.user?.uid, game);
      const old = await cachedIndex(key);
      const index = old || {
        schemaVersion: 1,
        gameId: game.id,
        sourceHash: game.manual.sha256,
        pageCount: game.manual.pages,
        language: game.language,
        analysisComplete: false,
        unsavedChanges: true,
        pages: Array.from({ length: game.manual.pages }, (_, i) => ({ page: i + 1, text: '', extracted: false })),
        headings: [],
      };
      for (const page of registrationOcr.pages.values()) if (!index.pages[page.page - 1]?.text.trim()) addOcrPage(index, page);
      await cachedIndex(key, index);
    }
    let savedGame = result.game || record;
    draft = savedGame;
    manualBlob = draftCoverBlob = null;
    if (additionalFiles.length) {
      for (const item of [...additionalFiles]) {
        try {
          $('upload-status').textContent = `Salvando ${item.file.name}…`;
          const { file, error, ...metadata } = item;
          savedGame = await repository.saveDocument(savedGame, { ...metadata, name: metadata.name.trim() }, file, (percent) => {
            $('upload-progress').value = percent;
            $('upload-status').textContent = `Enviando ${file.name}: ${percent}%`;
          });
          draft = savedGame;
          additionalFiles = additionalFiles.filter((entry) => entry !== item);
        } catch (error) {
          item.error = errorMessage(error);
        }
      }
      renderRegistrationPdfs();
      if (additionalFiles.length) {
        draft = await repository.latestGame(savedGame);
        gameSteps.go(1, false);
        throw new Error('O jogo foi salvo, mas alguns PDFs não foram enviados. Confira os arquivos indicados e tente salvar novamente; os já enviados serão preservados.');
      }
    }
    savedGame = await repository.latestGame(savedGame);
    const missing = expectedDocuments.filter(({ id, hash }) => findDocument(savedGame, id)?.manual.sha256 !== hash);
    if (missing.length) {
      for (const { item } of missing) {
        item.error = 'O vínculo deste PDF não foi confirmado no cadastro.';
        if (!additionalFiles.includes(item)) additionalFiles.push(item);
      }
      draft = savedGame;
      renderRegistrationPdfs();
      gameSteps.go(1, false);
      throw new Error('Nem todos os PDFs foram confirmados no cadastro. Os arquivos enviados serão aproveitados na nova tentativa.');
    }
    state.games = [...state.games.filter((game) => game.id !== savedGame.id), savedGame];
    renderGrid();
    const research = researchPanel.snapshot();
    if (research) {
      try {
        await repository.saveResearch?.(research, savedGame);
      } catch {
        result.warning ||= 'Jogo salvo. Não foi possível guardar o histórico desta pesquisa.';
      }
    }
    await draftProfile.seedIndexes(savedGame);
    registrationSavingId = null;
    void preparationQueue.update([...state.games.filter((game) => game.id !== savedGame.id), savedGame]);
    state.busy = false;
    closeDialog('upload-dialog');
    const documentCount = gameDocuments(savedGame).length;
    showNotice(result.warning || repository.fileWarning || `Jogo salvo com ${documentCount} ${documentCount === 1 ? 'PDF' : 'PDFs'}.`);
    if (repository.mode === 'local') navigator.storage?.persist?.().catch(() => {});
  } catch (error) {
    $('save-error').textContent = errorMessage(error);
    $('save-error').hidden = false;
    $('upload-status').textContent = '';
  } finally {
    registrationSavingId = null;
    state.busy = false;
    $('registration-pdfs').disabled = false;
    $('game-form')
      .querySelectorAll('button,input,textarea,select')
      .forEach((el) => (el.disabled = false));
    $('bgg-search').disabled = true;
    $('additional-pdf-file').disabled = !state.session.canEdit;
    $('upload-progress').hidden = true;
  }
};
$('edit-game').onclick = () => {
  if ($('game-management-dialog').open) $('game-management-dialog').close();
  const game = state.selected;
  closeDialog('detail-dialog');
  resetDraft();
  draft = structuredClone(game);
  draftCoverBlob = null;
  $('upload-title').textContent = 'Uma estante do seu jeito.';
  $('save-game').querySelector('span').textContent = 'Salvar alterações';
  $('review-notice-text').textContent = 'Edite as informações ou substitua o PDF. Uma substituição só é publicada depois de você confirmar e salvar.';
  fillForm();
  if (isTechnicalTitle(game.title))
    for (const candidate of titleCandidates({ metadataTitle: game.title, filename: game.manual.name })) {
      const button = node('button', null, candidate.text);
      button.type = 'button';
      button.title = candidate.source;
      button.onclick = () => {
        $('game-title').value = candidate.text;
        $('title-warning').hidden = true;
        researchPanel.invalidate();
      };
      $('title-suggestions').append(button);
    }
  repository
    .getCoverURL(game)
    .then((url) => {
      if (draft?.id === game.id) $('draft-cover').src = url || 'assets/icon.svg';
    })
    .catch(() => {});
  showDialog('upload-dialog');
  gameSteps.go(2, false);
};
function selectManagement(section) {
  for (const button of document.querySelectorAll('[data-game-management]')) {
    const active = button.dataset.gameManagement === section;
    button.setAttribute('aria-pressed', String(active));
    $(button.dataset.gameManagement).hidden = !active;
  }
  if (section === 'manage-information' && state.selected) {
    const sheet = node('dl', 'game-summary');
    for (const key of [...metadataKeys, 'language']) {
      const row = node('div');
      const value = state.selected[key];
      row.append(
        node('dt', '', fieldLabels[key] || 'Idioma do manual'),
        node('dd', '', emptyValue(value) ? 'Não informado' : Array.isArray(value) ? value.join(', ') : key === 'language' ? { 'pt-BR': 'Português', en: 'Inglês', fr: 'Francês' }[value] || value : String(value)),
      );
      sheet.append(row);
    }
    $('saved-game-information').replaceChildren(sheet);
  }
  if (section === 'manage-rules' && state.selected && state.session.canEdit) knowledgePanel?.open(state.selected);
  else knowledgePanel?.suspend();
}
$('detail-admin').onclick = () => {
  $('management-title').textContent = displayTitle(state.selected);
  selectManagement('manage-documents-section');
  showDialog('game-management-dialog');
};
for (const button of document.querySelectorAll('[data-game-management]')) button.onclick = () => selectManagement(button.dataset.gameManagement);

$('delete-game').onclick = () => {
  if ($('game-management-dialog').open) $('game-management-dialog').close();
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
const accountPanel = createAccountPanel({
  root: $('login-dialog'),
  getRepository: () => repository,
  getSession: () => state.session,
  openDialog: showDialog,
  closeDialog,
  onNotice: showNotice,
  onError: errorMessage,
  googleEnabled: APP_CONFIG.enableGoogleLogin !== false,
});
function showLogin() {
  if (localMode || !repository) {
    showDialog('setup-dialog');
    return;
  }
  accountPanel.open();
}
$('account-button').onclick = showLogin;
function setupContent() {
  $('setup-mode').textContent = localMode
    ? 'Você está usando a biblioteca deste dispositivo. PDFs e dados ficam neste navegador, sem sincronização. Apagar os dados do site remove essa biblioteca.'
    : 'Entre com sua conta aprovada para acessar os manuais.';
  $('setup-technical').textContent = `Versão ${RESEARCH_VERSION} · Firebase Spark · Firestore e Authentication · Google Drive · Cloudflare Workers Free · GitHub Pages.`;
  $('setup-connection').textContent = $('connection-status').textContent;
  $('switch-mode').textContent = 'Abrir biblioteca compartilhada';
  $('switch-mode').hidden = !localMode;
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
const install = setupPwa({
  onNotice: showNotice,
  isBusy: () => state.busy || state.importing || !!draft || accountPanel.isBusy() || adminPanel?.isBusy() || guidePanel?.isBusy() || knowledgePanel?.isBusy(),
  onInstallReady: (ready) => $('install-button').classList.toggle('ready', ready),
});
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
  $('connection-warning').textContent = 'Você está sem internet. Os manuais compartilhados precisam de conexão.';
  $('connection-warning').hidden = repository?.mode === 'local';
});
window.addEventListener('online', () => {
  $('connection-warning').hidden = true;
  updateSession(state.session);
});
function updateSession(session) {
  const previous = state.session;
  const resolving = session.resolving === true;
  $('session-loading').hidden = !resolving;
  document.body.classList.toggle('access-approved', session.canRead === true);
  if (state.session.user?.uid !== session.user?.uid && !$('reader').hidden) reader?.close();
  state.session = session;

  if (!session.canEdit) knowledgePanel?.close();
  if (!session.canEdit && !session.canDelete && $('game-management-dialog').open) $('game-management-dialog').close();
  for (const button of document.querySelectorAll('[data-add]')) button.hidden = !session.canAdd;
  const preparationIssue = session.canRead && (session.canEdit || session.canAdd) && (session.cacheReady === false || (session.storageStatus && !(session.storageStatus.fileProtocol >= 2)));
  $('preparation-warning').hidden = !preparationIssue;
  $('preparation-diagnostic').textContent = preparationIssue
    ? [
        session.cacheError,
        session.storageStatus?.error,
        session.storageStatus && !(session.storageStatus.fileProtocol >= 2) ? 'O Worker conectado não informa suporte à preparação de múltiplos documentos. É necessário atualizar o backend e as regras, após autorização.' : '',
      ]
        .filter(Boolean)
        .join(' ')
    : '';
  if (session.canRead && (session.cacheReady !== previous.cacheReady || session.storageStatus !== previous.storageStatus || session.canEdit !== previous.canEdit || session.canAdd !== previous.canAdd))
    void preparationQueue?.update(
      state.games.filter((game) => game.id !== registrationSavingId),
      { loading: state.gamesLoading },
    );
  if (previous.canWrite && !session.canWrite) {
    informationFlow?.stop();
    draftProfile?.cancel();
    preparationQueue?.stop();
    documentPanel?.close();
  }
  if (previous.canReadAll && !session.canReadAll) {
    guidePanel?.close(true);
    reader?.close().catch(() => {});
    documentPanel?.close();
  }
  if (!session.canRead) {
    informationFlow?.stop();
    draftProfile?.cancel();
    knowledgePanel?.close();
    ++importSequence;
    importAbort?.abort();
    researchPanel.cancel();
    preparationQueue?.stop();
    documentPanel?.close();
    guidePanel?.close(true);
    reader?.close().catch(() => {});
    state.games = [];
    $('cover-warning').hidden = true;
    state.selected = null;
    for (const dialog of document.querySelectorAll('dialog[open]')) if (dialog.id !== 'login-dialog') dialog.close();
    for (const image of document.querySelectorAll('main img, #detail-dialog img, #upload-dialog img, #guide-dialog img')) {
      image.removeAttribute('src');
      delete image.dataset.gameId;
    }
    for (const id of ['management-title', 'detail-edition', 'detail-title', 'detail-description', 'detail-tags', 'detail-stats', 'detail-manual', 'hero-title', 'hero-description', 'games-grid', 'recent-list', 'detail-catalog-sources'])
      $(id)?.replaceChildren();
    if (resolving && $('login-dialog').open) $('login-dialog').close();
    if (!resolving && !localMode && repository && !$('login-dialog').open) accountPanel.open();
  } else if (!previous.canRead && $('login-dialog').open) $('login-dialog').close();
  $('login-dialog').querySelector('[data-close]').hidden = !session.canRead;

  guidePanel?.updateSession(session);
  if (previous.user?.uid === session.user?.uid && previous.profile && session.profile && previous.profile.status !== session.profile.status) showNotice(`${statusLabel(session.profile.status)}. Abra Minha conta para ver seu acesso atualizado.`);
  adminPanel?.updateSession(session);
  if ($('login-dialog').open) {
    accountPanel.render();
  }
  if (!session.canWrite && $('upload-dialog').open) closeDialog('upload-dialog');
  $('account-label').textContent = session.mode === 'local' ? 'Local' : session.user ? 'Minha conta' : 'Entrar';
  $('refresh-library').hidden = session.mode !== 'firebase';
  $('connection-warning').hidden = navigator.onLine || session.mode === 'local';
  $('connection-warning').textContent = 'Você está sem internet. Os manuais compartilhados precisam de conexão.';
  $('account-button').querySelector('.avatar').textContent = session.mode === 'local' ? 'L' : (session.user?.email?.[0] || 'A').toUpperCase();
  $('connection-status').replaceChildren(
    node('span', 'status-dot'),
    document.createTextNode(session.mode === 'local' ? 'Neste dispositivo · sem sincronização' : session.canRead ? 'Biblioteca conectada' : session.user ? 'Conta conectada · autorização pendente' : 'Acervo privado · entre para acessar'),
  );
  $('empty-description').textContent = session.canWrite
    ? 'Adicione seu primeiro manual em PDF.'
    : session.canRead
      ? 'Ainda não há manuais publicados.'
      : session.user
        ? 'Sua conta aguarda aprovação. Você pode acompanhar a situação em Minha conta.'
        : 'Entre com sua conta para acessar esta biblioteca.';
  $('empty-action').querySelector('span').textContent = session.canAdd ? 'Escolher um manual' : session.user ? 'Ver autorização da conta' : 'Entrar na biblioteca';
  $('empty-note').textContent = session.mode === 'local' ? 'PDF de até 50 MiB · Somente neste navegador' : session.canAdd ? 'PDF de até 50 MiB' : '';
  if (!session.canWrite) $('detail-admin').hidden = true;
  renderGrid();
  renderRecent();
  renderHero();
}
window.addEventListener('pagehide', () => {
  if (localMode) return;
  document.body.classList.remove('access-approved');
  preparationQueue?.destroy();
  repository?.close?.();
  importAbort?.abort();
  researchPanel.cancel();
  documentPanel?.close();
  guidePanel?.close(true);
  reader?.close().catch(() => {});
  lockPrivateCache();
  $('games-grid').replaceChildren();
});
window.addEventListener('beforeunload', (event) => {
  if (!state.busy && !state.importing) return;
  event.preventDefault();
  event.returnValue = '';
});
window.addEventListener('pageshow', (event) => {
  if (event.persisted && !localMode) location.reload();
});
async function start() {
  setupContent();
  $('session-loading').hidden = localMode;
  try {
    repository = localMode ? await (await import('./local-repository.js')).createLocalRepository() : await (await import('./firebase-repository.js')).createFirebaseRepository(APP_CONFIG);
    adminPanel = createAdminPanel({ repository, config: APP_CONFIG, onNotice: showNotice, onError: errorMessage });
    reader = createReader({
      repository,
      getProgress,
      saveProgress,
      onError: (error) => {
        if ([404, 410].includes(error.status)) {
          repository.refreshAvailability?.().catch(() => {});
        }
        showNotice(fileErrorMessage(error));
      },
    });
    preparationQueue = createPreparationQueue(repository, {
      scope: APP_CONFIG.firebase?.projectId || 'local',
      onChange: (jobs) => {
        documentPanel?.refresh();
        const signature = jobs
          .filter((job) => ['ready', 'partial'].includes(job.state))
          .map((job) => `${job.key}:${job.state}:${job.remoteRevision || job.updatedAt || 0}:${job.knowledgeStatus || ''}`)
          .join('|');
        if (signature !== preparationSignature) {
          preparationSignature = signature;
          void guidePanel?.refreshIndexes();
          void knowledgePanel?.refresh();
          void informationFlow?.prepared();
        }
      },
    });
    documentPanel = createDocumentPanel({
      root: $('manage-documents'),
      readRoot: $('detail-documents'),
      repository,
      queue: preparationQueue,
      openManual: (game, options) => reader.open(game, options),
      onNotice: showNotice,
      onSaved: (game) => {
        if (state.selected?.id === game.id) state.selected = game;
      },
    });
    repository.subscribeSession(updateSession);
    guidePanel = createGuidePanel({
      repository,
      getPreparation: (game, documentId) => preparationQueue.entries().find((job) => job.gameId === game.id && job.documentId === documentId),
      openManual: (game, options) => reader.open(game, options),
      onNotice: showNotice,
      scope: APP_CONFIG.firebase?.projectId || 'local',
    });
    knowledgePanel = createKnowledgePanel({
      openManual: (game, options) => reader.open(game, options),
      root: $('game-knowledge-admin'),
      repository,
      onNotice: showNotice,
    });
    repository.subscribeGames(
      (games, metadata = {}) => {
        state.games = games;
        reader?.revokeMissing(games);
        void preparationQueue
          .update(
            games.filter((game) => game.id !== registrationSavingId),
            { loading: metadata.loading === true },
          )
          .catch((error) => showNotice(errorMessage(error)));
        state.gamesLoading = metadata.loading === true;
        $('library-loading').hidden = !state.gamesLoading;
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
            if ($('detail-dialog').open || $('game-management-dialog').open) documentPanel?.open(latest);
          }
        }
        if (state.selected && !games.some((game) => game.id === state.selected.id) && !state.busy) {
          guidePanel?.close(true);
          state.selected = null;
          if ($('detail-dialog').open) closeDialog('detail-dialog');
        }
      },
      (error) => {
        state.gamesLoading = false;
        $('library-loading').hidden = true;
        $('library-error').textContent = errorMessage(error);
        $('library-error').hidden = false;
      },
    );
  } catch (error) {
    $('session-loading').hidden = true;
    accountPanel.open();
    $('library-loading').hidden = true;
    $('connection-status').textContent = 'A conexão não ficou pronta';
    $('library-error').textContent = errorMessage(error);
    $('login-error').textContent = `Não foi possível conectar. ${errorMessage(error)}`;
    $('login-error').hidden = false;
    $('library-error').hidden = false;
    $('empty-description').textContent = 'Não foi possível carregar a biblioteca. Verifique sua conexão e tente novamente.';
  }
}
$('retry-covers').onclick = () => {
  repository?.retryCovers?.();
  $('cover-warning').hidden = true;
  renderGrid();
  renderHero();
  if (state.selected) void populateImage($('detail-cover'), state.selected);
};
$('retry-preparation').onclick = async () => {
  const button = $('retry-preparation');
  button.disabled = true;
  try {
    await repository?.retryPreparation?.();
    await preparationQueue?.update(state.games);
    documentPanel?.refresh();
  } catch (error) {
    showNotice(errorMessage(error));
  } finally {
    button.disabled = false;
  }
};
start();
