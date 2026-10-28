// Pointer Events permitem a mesma alça no mouse, caneta e toque, sem biblioteca.
export function createDocumentOrder({ root, permitted, commit, onEnd = () => {} }) {
  let drag = null,
    frame = 0;
  const help = document.createElement('p'),
    status = document.createElement('p');
  help.id = `document-order-${crypto.randomUUID()}`;
  help.className = status.className = 'sr-only';
  help.textContent = 'Arraste para organizar. No teclado, pressione Espaço, use as setas para mover e Enter para salvar. Escape cancela.';
  status.setAttribute('role', 'status');
  function announce(text) {
    status.textContent = text;
  }
  function focus(id) {
    if (root?.isConnected) [...root.querySelectorAll('.document-drag-handle')].find((handle) => handle.dataset.documentId === id)?.focus({ preventScroll: true });
  }
  function finish(save = false) {
    const previous = drag;
    if (!previous) return;
    drag = null;
    cancelAnimationFrame(frame);
    root.classList.remove('is-ordering');
    for (const item of previous.items) {
      item.row.style.removeProperty('transform');
      item.row.classList.remove('is-dragging');
    }
    previous.handle.setAttribute('aria-pressed', 'false');
    if (previous.pointerId != null && root.hasPointerCapture(previous.pointerId)) root.releasePointerCapture(previous.pointerId);
    if (save && previous.active && permitted() && previous.ids.join() !== previous.initial.join()) {
      void Promise.resolve(commit(previous.ids, previous.initial)).finally(() => focus(previous.id));
    } else if (previous.active) {
      announce(save ? 'Ordem mantida.' : 'Ordenação cancelada.');
    }
    onEnd();
  }
  function begin(handle, row, pointer) {
    if (!permitted() || drag) return;
    const items = [...root.querySelectorAll('.document-reading-row')].map((row) => ({ row, id: row.dataset.readDocumentId, top: row.getBoundingClientRect().top, height: row.getBoundingClientRect().height }));
    const index = items.findIndex((item) => item.row === row);
    if (index < 0) return;
    const initial = items.map((item) => item.id);
    let scrollBox = root.parentElement;
    while (scrollBox && !/(auto|scroll)/.test(getComputedStyle(scrollBox).overflowY)) scrollBox = scrollBox.parentElement;
    drag = {
      id: initial[index],
      index,
      handle,
      row,
      items,
      initial,
      ids: [...initial],
      top: root.getBoundingClientRect().top,
      scrollBox: scrollBox || document.scrollingElement,
      active: !pointer,
      pointerId: pointer?.pointerId,
      startY: pointer?.clientY,
      y: pointer?.clientY,
    };
    handle.focus({ preventScroll: true });
    if (pointer) root.setPointerCapture(pointer.pointerId);
    else activate();
  }
  function activate() {
    drag.active = true;
    drag.row.classList.add('is-dragging');
    drag.handle.setAttribute('aria-pressed', 'true');
    root.classList.add('is-ordering');
    announce('Documento selecionado. Mova para a posição desejada.');
  }
  function preview(index, offset) {
    if (!drag) return;
    const others = drag.items.filter((item) => item.id !== drag.id);
    const ids = others.map((item) => item.id);
    ids.splice(index, 0, drag.id);
    if (ids.join() !== drag.ids.join()) announce(`Posição ${index + 1} de ${ids.length}. Solte para salvar.`);
    drag.ids = ids;
    let top = drag.items[0].top;
    for (const id of ids) {
      const item = drag.items.find((item) => item.id === id);
      item.row.style.transform = `translateY(${id === drag.id && offset != null ? offset : top - item.top}px)`;
      top += item.height;
    }
  }
  function move(y) {
    if (!drag || !permitted()) {
      finish();
      return;
    }
    drag.y = y;
    if (!drag.active && Math.abs(y - drag.startY) < 6) return;
    if (!drag.active) activate();
    const source = drag.items[drag.index],
      shift = root.getBoundingClientRect().top - drag.top;
    const total = drag.items.reduce((height, item) => height + item.height, 0);
    const offset = Math.max(drag.items[0].top - source.top, Math.min(total - source.height + drag.items[0].top - source.top, y - drag.startY - shift));
    const center = source.top + y - drag.startY - shift + source.height / 2;
    const others = drag.items.filter((item) => item.id !== drag.id);
    let target = others.findIndex((item) => center < item.top + item.height / 2);
    if (target < 0) target = others.length;
    preview(target, offset);
  }
  function autoScroll() {
    if (!drag?.active || drag.pointerId == null) return;
    const box = drag.scrollBox,
      bounds = box.getBoundingClientRect();
    const top = box === document.scrollingElement ? 0 : Math.max(0, bounds.top);
    const bottom = box === document.scrollingElement ? innerHeight : Math.min(innerHeight, bounds.bottom);
    const speed = drag.y < top + 48 ? -Math.min(14, (top + 48 - drag.y) / 3) : drag.y > bottom - 48 ? Math.min(14, (drag.y - bottom + 48) / 3) : 0;
    if (speed) {
      box.scrollTop += speed;
      move(drag.y);
    }
    frame = requestAnimationFrame(autoScroll);
  }
  root?.addEventListener('pointermove', (event) => {
    if (drag?.pointerId !== event.pointerId) return;
    move(event.clientY);
    if (drag?.active) {
      event.preventDefault();
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(autoScroll);
    }
  });
  root?.addEventListener('pointerup', (event) => {
    if (drag?.pointerId === event.pointerId) finish(true);
  });
  root?.addEventListener('pointercancel', (event) => {
    if (drag?.pointerId === event.pointerId) finish();
  });
  root?.addEventListener('lostpointercapture', (event) => {
    if (drag?.pointerId === event.pointerId) finish();
  });
  window.addEventListener('resize', () => finish());
  return {
    active: () => !!drag,
    reset() {
      finish();
    },
    mount() {
      root?.append(help, status);
    },
    handle(row, doc, disabled) {
      const handle = document.createElement('button');
      handle.type = 'button';
      handle.className = 'document-drag-handle';
      handle.dataset.documentId = doc.id;
      handle.title = 'Arrastar para organizar';
      handle.disabled = disabled;
      handle.setAttribute('aria-label', `Reordenar ${doc.name}`);
      handle.setAttribute('aria-describedby', help.id);
      handle.setAttribute('aria-pressed', 'false');
      const grip = document.createElement('span');
      grip.className = 'document-drag-grip';
      grip.setAttribute('aria-hidden', 'true');
      handle.append(grip);
      handle.onpointerdown = (event) => {
        if (event.button !== 0 || !event.isPrimary || disabled || !permitted()) return;
        event.preventDefault();
        begin(handle, row, event);
      };
      handle.onkeydown = (event) => {
        if ([' ', 'Enter'].includes(event.key)) {
          event.preventDefault();
          event.stopPropagation();
          if (!drag) begin(handle, row);
          else if (drag.handle === handle) finish(true);
        } else if (drag?.handle === handle) {
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            finish();
          } else if (drag.pointerId == null && ['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
            event.preventDefault();
            event.stopPropagation();
            const index = drag.ids.indexOf(drag.id),
              last = drag.ids.length - 1;
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? last : Math.max(0, Math.min(last, index + (event.key === 'ArrowUp' ? -1 : 1)));
            preview(next);
            row.scrollIntoView({ block: 'nearest', behavior: 'instant' });
          } else if (event.key === 'Tab') finish();
        }
      };
      return handle;
    },
  };
}
