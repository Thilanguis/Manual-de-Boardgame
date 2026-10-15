import { emptyGuide, cleanGuide, SECTION_TYPES } from './guide-model.js';
import { analyzePdf, suggestedSections, packIndex, unpackIndex } from './pdf-index.js';
import { imageToJpeg } from './pdf.js';
import { cachedIndex } from './index-cache.js';
const el = (tag, text, className) => {
  const e = document.createElement(tag);
  if (text) e.textContent = text;
  if (className) e.className = className;
  return e;
};
const button = (text, fn, className = 'button secondary small') => {
  const b = el('button', text, className);
  b.type = 'button';
  b.onclick = fn;
  return b;
};
const $ = (id) => document.getElementById(id);
export function formattedText(target, text) {
  for (const line of String(text || '').split('\n')) {
    const p = el('p');
    for (const part of line.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g)) {
      if (/^\*\*[^*]+\*\*$/.test(part)) p.append(el('strong', part.slice(2, -2)));
      else if (/^\*[^*]+\*$/.test(part)) p.append(el('em', part.slice(1, -1)));
      else p.append(document.createTextNode(part));
    }
    target.append(p);
  }
}
export function createGuidePanel({ repository, openManual, onNotice, scope }) {
  const dialog = $('guide-dialog'),
    view = $('guide-content'),
    status = $('guide-status');
  let game,
    guide,
    published,
    index,
    editor = false,
    busy = false,
    dirty = false,
    sequence = 0,
    controller,
    returnFocus,
    sessionUid = repository.session.user?.uid;
  const urls = new Map(),
    receipts = [];
  const searchWorker = new Worker(new URL('./rule-search-worker.js', import.meta.url), { type: 'module' });
  let searchSequence = 0,
    workerIndex,
    workerGuide,
    workerHash,
    searchTimer;
  searchWorker.onmessage = ({ data }) => {
    if (data.id !== searchSequence || !dialog.open || editor || $('guide-search').hidden) return;
    if (data.error) message(data.error);
    else renderResults(data.results);
  };
  searchWorker.onerror = () => message('A pesquisa não ficou pronta. Reabra o guia e tente novamente.');
  window.addEventListener('beforeunload', (event) => {
    if (dirty || busy) {
      event.preventDefault();
      event.returnValue = '';
    }
  });
  const cacheKey = () => `${scope}:${repository.session.user?.uid || 'visitor'}:${game.id}:${game.manual.sha256}`;
  const progressKey = () => `acervo-guide-progress:${scope}:${repository.session.user?.uid || 'visitor'}:${game.id}`;
  const message = (text) => {
    status.textContent = text;
    status.hidden = !text;
  };
  function setBusy(value) {
    busy = value;
    dialog.setAttribute('aria-busy', String(value));
    for (const b of dialog.querySelectorAll('[data-mutate], .guide-editor-section input, .guide-editor-section textarea, .guide-editor-section select')) b.disabled = value || b.dataset.limitDisabled === 'true';
    $('guide-cancel-analysis').hidden = !value || !controller;
  }
  function mutation(text, fn, className) {
    const b = button(text, () => act(fn), className);
    b.dataset.mutate = '';
    b.disabled = busy;
    return b;
  }
  async function act(fn) {
    if (busy) return;
    const token = sequence;
    try {
      await fn();
    } catch (error) {
      if (token === sequence) message(error.message);
    }
  }
  function release() {
    for (const u of urls.values()) URL.revokeObjectURL(u);
    urls.clear();
  }
  function close(force = false) {
    if (busy && !controller && !force) {
      message('Aguarde o salvamento terminar.');
      return false;
    }
    if (dirty && !force && !window.confirm('Há alterações não salvas no guia. Fechar e descartar essas alterações?')) return false;
    ++sequence;
    ++searchSequence;
    clearTimeout(searchTimer);
    searchWorker.postMessage({ type: 'context', index: null, guide: null, currentHash: '' });
    workerIndex = workerGuide = workerHash = undefined;
    controller?.abort();
    controller = null;
    for (const r of receipts.splice(0)) repository.discardGuideAsset(r).catch(() => {});
    release();
    dialog.close();
    document.body.classList.remove('modal-open');
    returnFocus?.focus();
    busy = dirty = false;
    return true;
  }
  $('guide-close').onclick = () => close();
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    close();
  });
  $('guide-cancel-analysis').onclick = () => controller?.abort();
  $('guide-search').oninput = () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(renderSearch, 150);
  };
  const maySwitch = () => {
    if (dirty || busy) {
      message('Salve o rascunho ou conclua a operação antes de mudar de modo.');
      return false;
    }
    return true;
  };
  $('guide-tab-learn').onclick = () => {
    if (!maySwitch()) return;
    editor = false;
    guide = published;
    renderReader();
  };
  $('guide-tab-quick').onclick = () => {
    if (!maySwitch()) return;
    editor = false;
    guide = published;
    renderSearch();
  };
  $('guide-edit').onclick = () =>
    act(async () => {
      if (!maySwitch()) return;
      guide = (await repository.getGuide(game, true)) || emptyGuide(game);
      editor = true;
      dirty = false;
      renderEditor();
    });
  $('guide-analyze').onclick = () => act(analyze);
  function stale(g = guide) {
    return g && g.sourceHash !== game.manual.sha256;
  }
  function pageButton(page, hash) {
    const b = button(`Ver no manual · p. ${page}`, () => {
      if (close()) openManual(game, { page });
    });
    b.disabled = hash !== game.manual.sha256;
    b.title = b.disabled ? 'O PDF foi substituído. Referência aguardando revisão.' : 'Abrir esta página do PDF oficial';
    return b;
  }
  async function image(id, parent, caption) {
    const token = sequence;
    try {
      if (!urls.has(id)) {
        const blob = await repository.getGuideAsset(game, id);
        if (token !== sequence || !parent.isConnected) return;
        if (!urls.has(id)) urls.set(id, URL.createObjectURL(blob));
      }
      if (token !== sequence) return;
      const img = el('img');
      img.src = urls.get(id);
      img.alt = caption || 'Ilustração do guia';
      img.loading = 'lazy';
      const figure = el('figure');
      figure.append(img);
      if (caption) figure.append(el('figcaption', caption));
      parent.append(figure);
    } catch {
      if (token === sequence) parent.append(el('p', 'Imagem indisponível.', 'muted-text'));
    }
  }
  function renderSection(s, parent, hash) {
    const article = el('details', '', `guide-section guide-${s.type}`),
      summary = el('summary', s.title);
    article.id = `guide-section-${s.id}`;
    article.open = true;
    article.append(summary);
    const content = el('div', '', 'guide-section-body');
    if (s.type === 'lista') {
      const list = el('ul');
      for (const line of s.text.split('\n').filter(Boolean)) {
        const li = el('li');
        formattedText(li, line.replace(/^[-*]\s*/, ''));
        list.append(li);
      }
      content.append(list);
    } else formattedText(content, s.text);
    if (s.imageId) image(s.imageId, content, s.caption);
    if (s.page) content.append(pageButton(s.page, hash));
    article.append(content);
    summary.addEventListener('click', () => {
      if (dialog.open)
        try {
          localStorage.setItem(progressKey(), s.id);
        } catch {}
    });
    parent.append(article);
  }
  function contextNotice() {
    $('guide-stale').hidden = !stale(published) && !(editor && stale());
    $('guide-stale').textContent = 'O PDF foi substituído. O guia foi preservado, mas as referências de páginas precisam ser revisadas. Os links antigos estão desativados.';
    $('guide-edit').hidden = !repository.session.canEdit;
  }
  function renderReader() {
    ++searchSequence;
    $('guide-search').hidden = true;
    view.replaceChildren();
    contextNotice();
    if (!guide?.sections?.length) {
      view.append(el('p', 'Este jogo ainda não tem um guia publicado. O manual completo e a consulta rápida continuam disponíveis.'));
      return;
    }
    const nav = el('nav', '', 'guide-index');
    nav.setAttribute('aria-label', 'Índice do guia');
    for (const s of guide.sections)
      nav.append(
        button(s.title, () => {
          const section = $(`guide-section-${s.id}`);
          section.open = true;
          section.scrollIntoView({ behavior: 'smooth', block: 'start' });
          try {
            localStorage.setItem(progressKey(), s.id);
          } catch {}
        }),
      );
    const contents = el('details', '', 'guide-contents');
    contents.open = !window.matchMedia('(max-width: 600px)').matches;
    contents.append(el('summary', `Índice do guia · ${guide.sections.length} seções`), nav);
    view.append(contents);
    for (const s of guide.sections) renderSection(s, view, guide.sourceHash);
    try {
      const saved = localStorage.getItem(progressKey());
      if (saved && guide.sections.some((s) => s.id === saved)) view.prepend(button('Retomar última seção', () => $(`guide-section-${saved}`).scrollIntoView({ behavior: 'smooth', block: 'start' })));
    } catch {}
  }
  function renderSearch() {
    $('guide-search').hidden = false;
    view.replaceChildren();
    contextNotice();
    const id = ++searchSequence;
    if (!index) view.append(el('p', 'Para pesquisar todo o PDF, clique em “Analisar PDF completo”. O processamento ocorre neste dispositivo e pode ser cancelado.'));
    if (!$('guide-search').value.trim()) {
      if (index) {
        view.append(el('p', `${index.pageCount} páginas analisadas. Pesquise uma palavra ou expressão, ou consulte os assuntos abaixo.`));
        if (index.scanned) view.append(el('p', 'Pouco texto extraível: este PDF pode ser escaneado. Não há OCR nesta versão.', 'guide-warning'));
        for (const h of index.headings.slice(0, 160)) {
          const row = el('div', '', 'guide-topic');
          row.append(el('strong', h.title), el('small', h.category || h.source), pageButton(h.page, index.sourceHash));
          view.append(row);
        }
      }
      return;
    }
    if (workerIndex !== index || workerGuide !== published || workerHash !== game.manual.sha256) {
      searchWorker.postMessage({ type: 'context', index, guide: published, currentHash: game.manual.sha256 });
      workerIndex = index;
      workerGuide = published;
      workerHash = game.manual.sha256;
    }
    view.append(el('p', 'Pesquisando regras…', 'muted-text'));
    searchWorker.postMessage({ type: 'query', id, query: $('guide-search').value });
  }
  function renderResults(results) {
    view.replaceChildren(el('p', `${results.length} resultados${results.length === 60 ? ' mais relevantes' : ''}.`));
    for (const r of results) {
      const card = el('article', '', 'rule-result');
      card.append(el('h3', r.title), el('small', r.source));
      // Escolhe um trecho próximo da busca sem executar HTML do PDF.
      const at = r.text.toLocaleLowerCase().indexOf($('guide-search').value.toLocaleLowerCase()),
        begin = Math.max(0, at - 100);
      card.append(el('p', `${begin ? '…' : ''}${r.text.slice(begin, begin + 650)}${r.text.length > begin + 650 ? '…' : ''}`));
      if (r.page) card.append(pageButton(r.page, game.manual.sha256));
      if (r.sectionId)
        card.append(
          button('Abrir seção do guia', () => {
            guide = published;
            renderReader();
            $(`guide-section-${r.sectionId}`).scrollIntoView({ behavior: 'smooth', block: 'start' });
          }),
        );
      view.append(card);
    }
  }
  function inputField(label, name, value, kind = 'input') {
    const wrapper = el('label', label),
      field = el(kind);
    field.name = name;
    field.value = value ?? '';
    wrapper.append(field);
    return wrapper;
  }
  function readEditor() {
    if (!editor) return;
    guide.sections = [...view.querySelectorAll('.guide-editor-section')].map((row) => {
      const s = { ...guide.sections.find((s) => s.id === row.dataset.id) };
      for (const name of ['title', 'text', 'type', 'page', 'caption']) s[name] = row.querySelector(`[name=${name}]`).value;
      s.reviewed = row.querySelector('[name=reviewed]').checked;
      return s;
    });
  }
  function renderEditor() {
    ++searchSequence;
    $('guide-search').hidden = true;
    view.replaceChildren();
    contextNotice();
    const actions = el('div', '', 'guide-editor-actions');
    actions.append(
      mutation('Nova seção', () => {
        readEditor();
        guide.sections.push({ id: crypto.randomUUID(), title: 'Nova seção', text: '', type: 'texto', reviewed: false, page: null, imageId: '', caption: '' });
        dirty = true;
        renderEditor();
      }),
      mutation('Salvar rascunho', save),
      mutation('Pré-visualizar', () => {
        readEditor();
        const clean = cleanGuide(guide);
        view.replaceChildren(button('Voltar ao editor', renderEditor));
        for (const s of clean.sections) renderSection(s, view, clean.sourceHash);
      }),
      mutation('Publicar guia revisado', publish, 'button primary small'),
    );
    if (stale())
      actions.append(
        mutation('Revisar referências para o PDF atual', () => {
          readEditor();
          guide.sourceHash = game.manual.sha256;
          guide.sections.forEach((s) => (s.reviewed = false));
          dirty = true;
          renderEditor();
          message('Confira cada página no PDF atual e marque novamente as seções revisadas.');
        }),
      );
    view.append(actions, el('p', 'Sugestões são trechos extraídos, não resumos. Edite para ensinar o jogo e confirme cada seção. Formatação: **negrito**, *itálico*. Para listas, use uma linha por item.', 'muted-text'));
    if (index?.headings?.length)
      view.append(
        mutation('Adicionar sugestões do PDF ao rascunho', () => {
          readEditor();
          const existing = new Set(guide.sections.map((s) => `${s.page}:${s.title}`));
          const additions = suggestedSections(index).filter((s) => !existing.has(`${s.page}:${s.title}`));
          if (guide.sections.length + additions.length > 100) throw new Error('Há mais de 100 seções. Organize ou remova as sugestões antes de adicionar outras.');
          guide.sections.push(...additions);
          dirty = true;
          renderEditor();
          message('Sugestões adicionadas ao final, sem alterar as explicações existentes. Revise antes de publicar.');
        }),
      );
    for (const [i, s] of guide.sections.entries()) {
      const row = el('fieldset', '', 'guide-editor-section');
      row.dataset.id = s.id;
      row.append(el('legend', `Seção ${i + 1}`));
      row.append(inputField('Título', 'title', s.title), inputField('Texto / resposta', 'text', s.text, 'textarea'));
      row.querySelector('textarea').rows = 6;
      row.querySelector('[name=title]').maxLength = 160;
      row.querySelector('[name=text]').maxLength = 20000;
      const type = inputField('Apresentação', 'type', '', 'select'),
        select = type.querySelector('select');
      for (const t of SECTION_TYPES) {
        const opt = el('option', t);
        opt.value = t;
        select.append(opt);
      }
      select.value = s.type;
      row.append(type);
      const page = inputField('Página física do PDF (opcional)', 'page', s.page);
      page.querySelector('input').type = 'number';
      page.querySelector('input').min = 1;
      page.querySelector('input').max = game.manual.pages;
      row.append(page);
      const imageInput = inputField('Ilustração (JPEG, PNG ou WebP)', 'image', '', 'input'),
        file = imageInput.querySelector('input');
      file.type = 'file';
      file.accept = 'image/jpeg,image/png,image/webp';
      file.dataset.mutate = '';
      file.onchange = () =>
        act(async () => {
          readEditor();
          const item = guide.sections.find((v) => v.id === s.id),
            selected = file.files[0],
            token = sequence,
            activeGame = game;
          if (!selected) return;
          if (selected.size > 12 * 1024 * 1024) throw new Error('Selecione uma imagem de até 12 MB.');
          setBusy(true);
          try {
            const jpeg = await imageToJpeg(selected),
              receipt = await repository.uploadGuideAsset(activeGame, jpeg, `${activeGame.title} — ${item.title}.jpg`, (p) => {
                if (token === sequence) message(`Enviando imagem: ${p}%`);
              });
            if (token !== sequence) {
              await repository.discardGuideAsset(receipt).catch(() => {});
              return;
            }
            receipts.push(receipt);
            item.imageId = receipt.driveFileId;
            item.reviewed = false;
            guide.assets[receipt.driveFileId] = { mimeType: 'image/jpeg' };
            urls.set(receipt.driveFileId, URL.createObjectURL(jpeg));
            dirty = true;
            renderEditor();
            message('Imagem enviada. Salve o rascunho para vinculá-la ao guia.');
          } finally {
            if (token === sequence) setBusy(false);
          }
        });
      row.append(imageInput, inputField('Legenda / descrição da imagem', 'caption', s.caption));
      if (s.imageId) {
        image(s.imageId, row, s.caption);
        row.append(
          mutation('Remover ilustração da seção', () => {
            readEditor();
            guide.sections[i].imageId = '';
            guide.sections[i].reviewed = false;
            dirty = true;
            renderEditor();
          }),
        );
      }
      const reviewed = inputField('Revisei esta explicação e suas referências', 'reviewed', '', 'input');
      reviewed.className = 'check-row';
      reviewed.querySelector('input').type = 'checkbox';
      reviewed.querySelector('input').checked = s.reviewed;
      row.append(reviewed);
      const controls = el('div', '', 'guide-section-controls');
      for (const [label, direction] of [
        ['Subir', -1],
        ['Descer', 1],
      ]) {
        const b = mutation(label, () => {
          readEditor();
          const next = i + direction;
          [guide.sections[i], guide.sections[next]] = [guide.sections[next], guide.sections[i]];
          dirty = true;
          renderEditor();
        });
        b.disabled = i + direction < 0 || i + direction >= guide.sections.length;
        b.dataset.limitDisabled = String(b.disabled);
        controls.append(b);
      }
      controls.append(
        mutation('Remover seção', () => {
          readEditor();
          guide.sections.splice(i, 1);
          dirty = true;
          renderEditor();
        }),
      );
      if (s.page) controls.append(pageButton(Number(s.page), guide.sourceHash));
      row.append(controls);
      row.addEventListener('input', (event) => {
        dirty = true;
        if (event.target.name !== 'reviewed') row.querySelector('[name=reviewed]').checked = false;
      });
      view.append(row);
    }
  }
  async function save() {
    readEditor();
    const clean = cleanGuide(guide),
      token = sequence,
      activeGame = game,
      pending = [...receipts];
    setBusy(true);
    message('Salvando rascunho privado…');
    try {
      const saved = await repository.saveGuide(activeGame, clean);
      for (const receipt of pending) {
        try {
          await repository.finalizeGuideAsset(receipt);
          if (receipts.includes(receipt)) receipts.splice(receipts.indexOf(receipt), 1);
        } catch {
          onNotice('Rascunho salvo. A finalização de um arquivo precisa ser tentada novamente.');
        }
      }
      if (token !== sequence) return false;
      guide = saved;
      dirty = false;
      renderEditor();
      message('Rascunho salvo. Visitantes continuam vendo a versão publicada anterior.');
      return true;
    } finally {
      if (token === sequence) setBusy(false);
    }
  }
  async function publish() {
    readEditor();
    const clean = cleanGuide(guide);
    if (!clean.reviewed) throw new Error('Marque todas as seções como revisadas antes de publicar.');
    if (stale(clean)) throw new Error('Revise as referências do PDF atual antes de publicar.');
    const token = sequence;
    if (!(await save()) || token !== sequence) return;
    setBusy(true);
    try {
      const next = await repository.publishGuide(game, guide, published?.revision || 0);
      if (token !== sequence) return;
      published = next;
      message('Guia publicado. As alterações agora estão disponíveis aos visitantes.');
      onNotice('Guia publicado.');
    } finally {
      if (token === sequence) setBusy(false);
    }
  }
  async function analyze() {
    if (editor) readEditor();
    const wasEditor = editor,
      token = sequence,
      activeGame = game;
    controller = new AbortController();
    setBusy(true);
    message('Baixando o PDF completo para análise…');
    try {
      const signal = controller.signal,
        blob = await repository.getManual(activeGame, { signal });
      if (token !== sequence) return;
      controller.signal.throwIfAborted();
      const result = await analyzePdf(blob, activeGame, {
        signal: controller.signal,
        onProgress: (p) => {
          if (token !== sequence) return;
          message(p.message);
          $('guide-progress').hidden = false;
          $('guide-progress').value = p.current;
          $('guide-progress').max = p.total || 1;
        },
      });
      if (token !== sequence || activeGame.manual.sha256 !== game.manual.sha256) return;
      index = result;
      await cachedIndex(cacheKey(), index);
      if (token !== sequence) return;
      if (wasEditor) {
        controller = null;
        setBusy(true);
        const packed = await packIndex(index),
          receipt = await repository.uploadGuideAsset(activeGame, packed, `${activeGame.title} — índice de regras.json.gz`, (p) => {
            if (token === sequence) message(`Salvando consulta rápida: ${p}%`);
          });
        if (token !== sequence) {
          await repository.discardGuideAsset(receipt).catch(() => {});
          return;
        }
        receipts.push(receipt);
        guide.assets[receipt.driveFileId] = { mimeType: 'application/gzip' };
        guide.indexFileId = receipt.driveFileId;
        dirty = true;
        renderEditor();
      } else renderSearch();
      message(index.scanned ? 'Análise concluída com pouco texto extraível. Para PDFs escaneados, preencha o guia manualmente; não há OCR.' : 'PDF completo analisado. Os títulos e trechos são sugestões para revisão.');
    } catch (error) {
      if (token === sequence) message(controller?.signal.aborted ? 'Análise cancelada. O guia e a publicação foram preservados.' : error.message);
    } finally {
      if (token === sequence) {
        controller = null;
        setBusy(false);
        $('guide-progress').hidden = true;
      }
    }
  }
  return {
    isBusy: () => busy || dirty,
    updateSession(session) {
      if (sessionUid !== session.user?.uid || (!session.canEdit && editor)) close(true);
      sessionUid = session.user?.uid;
      if (game) contextNotice();
    },
    invalidate(next) {
      if (game?.id !== next.id) return;
      if (next.deleting) {
        close(true);
        return;
      }
      if (game.manual.sha256 === next.manual.sha256) return;
      controller?.abort();
      if (editor) readEditor();
      game = next;
      index = null;
      if (dialog.open) {
        if (editor) renderEditor();
        else if ($('guide-search').hidden) renderReader();
        else renderSearch();
      }
      onNotice('O PDF foi substituído. Seu guia foi preservado; confira as referências da versão atual.');
    },
    async open(nextGame, mode = 'learn') {
      close(true);
      returnFocus = document.activeElement;
      game = nextGame;
      published = guide = index = null;
      editor = false;
      dirty = false;
      const token = ++sequence;
      $('guide-title').textContent = game.title;
      $('guide-search').value = '';
      view.replaceChildren();
      message('Carregando conteúdo…');
      document.querySelectorAll('dialog[open]').forEach((d) => d.close());
      document.body.classList.add('modal-open');
      dialog.showModal();
      try {
        const loaded = await repository.getGuide(game);
        if (token !== sequence) return;
        published = guide = loaded;
        index = await cachedIndex(cacheKey());
        if (!index && loaded?.indexFileId && !stale(loaded)) {
          try {
            index = await unpackIndex(await repository.getGuideAsset(game, loaded.indexFileId), game);
            await cachedIndex(cacheKey(), index);
          } catch {
            message('O índice publicado está indisponível. Você pode analisar novamente o PDF neste dispositivo.');
          }
        }
        if (token !== sequence) return;
        if (mode === 'edit' && repository.session.canEdit) {
          guide = (await repository.getGuide(game, true)) || emptyGuide(game);
          editor = true;
          renderEditor();
        } else if (mode === 'quick') renderSearch();
        else renderReader();
        message('');
      } catch (error) {
        if (token === sequence) message(error.message);
      }
    },
    close,
  };
}
