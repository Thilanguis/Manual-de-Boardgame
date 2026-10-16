import { MAX_PDF_BYTES } from './pdf-limits.js';
import { DOCUMENT_TYPES, gameDocuments, primaryDocumentId } from './documents.js';
import { inspectPdf } from './pdf.js';
import { PREPARATION_LABELS } from './preparation-queue.js';
const el = (tag, text) => {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  return node;
};
export function createDocumentPanel({ root, readRoot, repository, queue, openManual, onNotice, onSaved }) {
  let game,
    sequence = 0,
    busy = false,
    pendingRemovals = [],
    controller;
  const button = (text, action) => {
    const b = el('button', text);
    b.type = 'button';
    b.className = 'button secondary small';
    b.disabled = busy;
    b.onclick = () => void run(action);
    return b;
  };
  async function run(action) {
    if (busy) return;
    busy = true;
    controller = new AbortController();
    const token = sequence;
    render();
    try {
      await action();
    } catch (error) {
      if (token === sequence) onNotice(error.message);
    } finally {
      busy = false;
      controller = null;
      if (token === sequence) render();
    }
  }
  async function saved(next) {
    game = next;
    await queue.update([...(repository.games || []).filter((g) => g.id !== next.id), next]);
    onSaved(next);
    if (repository.fileWarning) {
      onNotice(repository.fileWarning);
      repository.fileWarning = '';
    }
  }
  async function addFiles(target, files, { types = {} } = {}) {
    let latest = target;
    const failures = [];
    for (const [i, file] of [...files].entries()) {
      if (!repository.session.canEdit) throw new Error('Sua conta não pode adicionar documentos.');
      try {
        const info = await inspectPdf(file, { maxBytes: MAX_PDF_BYTES, signal: controller?.signal });
        if (gameDocuments(latest).some((doc) => doc.manual.sha256 === info.manual.sha256)) throw new Error('Este PDF já está vinculado ao jogo.');
        const doc = { id: crypto.randomUUID(), name: file.name.replace(/\.pdf$/i, '').slice(0, 160), documentType: types[i] || 'complemento', language: info.language, edition: info.edition || '', manual: info.manual };
        latest = await repository.saveDocument(latest, doc, file);
        await saved(latest);
      } catch (error) {
        failures.push(`${file.name}: ${error.message}`);
      }
    }
    if (failures.length) onNotice(`Jogo preservado. Não foi possível adicionar: ${failures.join(' · ')}`);
    return { game: latest, failures };
  }
  function render() {
    root.replaceChildren();
    readRoot?.replaceChildren();
    if (!game || !repository.session.canRead) return;
    root.className = 'document-list';
    const documents = gameDocuments(game),
      blocked = queue.blockedReason?.() || '';
    for (const [i, doc] of documents.entries()) {
      const principal = doc.id === primaryDocumentId(game);
      const name = principal
        ? 'Manual principal'
        : doc.name
            .replace(/_/g, ' ')
            .replace(/\b\d{5,}\b/g, '')
            .trim() || `${DOCUMENT_TYPES[doc.documentType]} ${i + 1}`;
      const row = el('div');
      row.className = 'document-reading-row';
      row.dataset.readDocumentId = doc.id;
      row.append(
        el(
          'p',
          `${name}${principal ? '' : ` · ${DOCUMENT_TYPES[doc.documentType]}`} · ${{ 'pt-BR': 'Português', pt: 'Português', en: 'Inglês', fr: 'Francês' }[doc.language] || 'Idioma não identificado'} · ${doc.manual.pages} ${doc.manual.pages === 1 ? 'página' : 'páginas'}`,
        ),
      );
      if (documents.length > 1) row.append(button('Ler documento', () => openManual(game, { documentId: doc.id })));
      readRoot?.append(row);
    }
    if (!repository.session.canEdit && !repository.session.canDelete) return;
    if (blocked) {
      root.append(el('p', blocked));
      const diagnostic = el('details');
      diagnostic.append(el('summary', 'Detalhes da conexão'), el('p', repository.session.cacheError || repository.session.storageStatus?.error || 'A conexão dos documentos precisa ser atualizada.'));
      root.append(
        diagnostic,
        button('Tentar novamente', async () => {
          await repository.retryPreparation?.();
          await queue.update(repository.games || [game]);
        }),
      );
    }
    for (const doc of gameDocuments(game)) {
      const row = el('article');
      row.className = 'document-row';
      row.dataset.documentId = doc.id;
      const job = queue.entries().find((j) => j.gameId === game.id && j.documentId === doc.id && j.sourceHash === doc.manual.sha256);
      row.append(
        el('strong', doc.id === primaryDocumentId(game) ? 'Manual principal' : doc.name.replace(/_/g, ' ').replace(/\.pdf$/i, '')),
        el(
          'p',
          `${DOCUMENT_TYPES[doc.documentType]}${doc.id === primaryDocumentId(game) ? ' · Principal' : ''} · ${{ 'pt-BR': 'Português', pt: 'Português', en: 'Inglês', fr: 'Francês' }[doc.language] || 'Idioma não identificado'} · ${doc.manual.pages} ${doc.manual.pages === 1 ? 'página' : 'páginas'}`,
        ),
      );
      const paused = blocked && job && !['ready', 'partial'].includes(job.state);
      if (job) {
        const badge = el('small', `${PREPARATION_LABELS[paused ? 'paused' : job.state]}${!paused && job.total && ['analyzing', 'ocr'].includes(job.state) && repository.session.canEdit ? ` · ${job.current} de ${job.total} páginas` : ''}`);
        badge.dataset.preparationStatus = doc.id;
        row.append(badge);
        if (!paused && ['analyzing', 'ocr', 'translating'].includes(job.state) && repository.session.canEdit) {
          const progress = el('progress');
          progress.max = job.total || 1;
          progress.value = job.current || 0;
          row.append(progress);
        }
        const reason = el('p', repository.session.canEdit && !paused ? job.error || (job.state === 'paused' ? 'Pausado por você.' : '') : '');
        reason.dataset.preparationReason = doc.id;
        reason.hidden = !reason.textContent;
        row.append(reason);
        if (job.translationPending) row.append(el('p', doc.language === 'other' ? 'Confirme o idioma para preparar a tradução.' : 'Tradução pendente. O original continua disponível.'));
      }
      const actions = el('div');
      actions.className = 'document-actions';
      if (repository.session.canEdit) {
        const settings = el('details');
        settings.append(el('summary', 'Editar dados'));
        const name = el('input');
        name.value = doc.name;
        name.maxLength = 160;
        name.setAttribute('aria-label', 'Nome do documento');
        const type = el('select');
        type.setAttribute('aria-label', 'Tipo de documento');
        for (const [value, label] of Object.entries(DOCUMENT_TYPES)) {
          const option = el('option', label);
          option.value = value;
          option.selected = value === doc.documentType;
          type.append(option);
        }
        const edition = el('input');
        edition.value = doc.edition;
        edition.maxLength = 100;
        edition.setAttribute('aria-label', 'Edição do documento');
        const language = el('select');
        language.setAttribute('aria-label', 'Idioma do documento');
        for (const value of ['pt-BR', 'en', 'fr', 'other']) {
          const option = el('option', { 'pt-BR': 'Português', en: 'Inglês', fr: 'Francês', other: 'Não identificado' }[value]);
          option.value = value;
          option.selected = value === doc.language;
          language.append(option);
        }
        settings.append(
          name,
          type,
          edition,
          language,
          button('Salvar alterações', async () => saved(await repository.saveDocument(game, { ...doc, name: name.value.trim(), documentType: type.value, edition: edition.value.trim(), language: language.value }))),
        );
        const replace = el('input');
        replace.type = 'file';
        replace.accept = 'application/pdf';
        replace.setAttribute('aria-label', `Substituir ${doc.name}`);
        replace.onchange = () =>
          void run(async () => {
            const file = replace.files[0];
            if (!file || !confirm('Substituir este PDF? As referências desta versão precisarão de revisão.')) return;
            const info = await inspectPdf(file, { maxBytes: MAX_PDF_BYTES, signal: controller.signal });
            await saved(await repository.saveDocument(game, { ...doc, expectedSourceHash: doc.manual.sha256, manual: info.manual, language: info.language }, file));
          });
        replace.hidden = true;
        const replaceButton = button('Substituir PDF', () => {});
        replaceButton.onclick = () => replace.click();
        actions.append(replaceButton, replace);
        actions.append(settings);
        if (doc.id !== primaryDocumentId(game)) actions.append(button('Tornar principal', async () => saved(await repository.setPrimaryDocument(game, doc.id))));
        const pause = button('Pausar', () => queue.pause(game, doc)),
          resume = button(job?.state === 'partial' ? 'Tentar novamente' : 'Retomar', () => queue.resume(game, doc, { retryFailed: job?.state === 'partial' }));
        pause.dataset.preparationAction = 'pause';
        resume.dataset.preparationAction = 'resume';
        pause.hidden = !!blocked || !job || !['analyzing', 'ocr', 'translating'].includes(job.state);
        resume.hidden = !!blocked || !job || !['paused', 'attention', 'partial'].includes(job.state);
        settings.append(pause, resume);
        if (repository.session.canDelete && gameDocuments(game).length > 1 && doc.id !== primaryDocumentId(game))
          actions.append(
            button('Remover PDF', async () => {
              if (confirm(`Remover “${doc.name}”? Os demais documentos serão mantidos.`)) await saved(await repository.removeDocument(game, doc.id));
            }),
          );
      }
      row.append(actions);
      root.append(row);
    }
    if (repository.session.canEdit && gameDocuments(game).length < 12) {
      const label = el('label', 'Adicionar PDFs');
      label.className = 'button secondary';
      const input = el('input');
      input.type = 'file';
      input.multiple = true;
      input.accept = 'application/pdf';
      input.disabled = busy;
      input.onchange = () => void run(() => addFiles(game, input.files));
      input.hidden = true;
      input.setAttribute('aria-label', 'Adicionar PDFs');
      label.append(input);
      root.prepend(label);
    }
    if (repository.session.canDelete && pendingRemovals.length) {
      const pending = el('details');
      pending.className = 'document-management';
      pending.open = true;
      pending.append(
        el('summary', 'Remoções pendentes'),
        el('p', 'Os documentos já foram retirados do jogo. Falta concluir a limpeza dos arquivos.'),
        button('Concluir remoções', async () => {
          await saved(await repository.retryDocumentRemovals(game));
          pendingRemovals = await repository.pendingDocumentRemovals(game);
        }),
      );
      root.append(pending);
    }
  }
  return {
    addFiles,
    refresh() {
      if (busy) return;
      if (root.querySelector('details[open]') || (root.contains(document.activeElement) && /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName))) {
        const blocked = queue.blockedReason?.() || '';
        for (const row of root.querySelectorAll('[data-document-id]')) {
          const job = queue.entries().find((j) => j.gameId === game?.id && j.documentId === row.dataset.documentId);
          const badge = row.querySelector('[data-preparation-status]');
          if (badge && job)
            badge.textContent =
              PREPARATION_LABELS[blocked && !['ready', 'partial'].includes(job.state) ? 'paused' : job.state] +
              (!blocked && job.total && ['analyzing', 'ocr'].includes(job.state) && repository.session.canEdit ? ` · ${job.current} de ${job.total} páginas` : '');
          const reason = row.querySelector('[data-preparation-reason]');
          if (reason && job) {
            reason.textContent = repository.session.canEdit ? (blocked && !['ready', 'partial'].includes(job.state) ? '' : job.error || (job.state === 'paused' ? 'Pausado por você.' : '')) : '';
            reason.hidden = !reason.textContent;
          }
          const progress = row.querySelector('progress');
          if (progress && job) {
            progress.hidden = !!blocked || !['analyzing', 'ocr', 'translating'].includes(job.state);
            progress.max = job.total || 1;
            progress.value = job.current || 0;
          }
          const pause = row.querySelector('[data-preparation-action=pause]'),
            resume = row.querySelector('[data-preparation-action=resume]');
          if (pause) pause.hidden = !!blocked || !job || !['analyzing', 'ocr', 'translating'].includes(job.state);
          if (resume) {
            resume.hidden = !!blocked || !job || !['paused', 'attention', 'partial'].includes(job.state);
            resume.textContent = job?.state === 'partial' ? 'Tentar novamente' : 'Retomar';
          }
        }
        return;
      }
      render();
    },
    open(next) {
      if (game?.id !== next.id) ++sequence;
      game = next;
      queue.observeGame?.(next);
      render();
      const token = sequence;
      if (repository.session.canDelete && (repository.mode !== 'firebase' || repository.session.storageStatus?.documentRemovalProtocol >= 2))
        void repository
          .pendingDocumentRemovals?.(next)
          .then((items) => {
            if (token === sequence && game?.id === next.id) {
              pendingRemovals = items;
              if (!busy) render();
            }
          })
          .catch((error) => onNotice(error.message));
    },
    close() {
      ++sequence;
      controller?.abort();
      game = null;
      queue.observeGame?.(null);
      pendingRemovals = [];
      root.replaceChildren();
      readRoot?.replaceChildren();
    },
    isBusy: () => busy,
  };
}
