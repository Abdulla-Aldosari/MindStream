/* global acquireVsCodeApi */
(function () {
  const vscode = acquireVsCodeApi();

  const STATUS_CYCLE = ['pending', 'in-progress', 'done'];
  const STATUS_ORDER = { pending: 0, 'in-progress': 1, done: 2 };
  const ICONS = {
    wrench: 'codicon-wrench',
    edit: 'codicon-edit',
    star: 'codicon-star',
    sync: 'codicon-sync',
    code: 'codicon-code',
    beaker: 'codicon-beaker',
    note: 'codicon-note',
    link: 'codicon-link',
    tag: 'codicon-tag'
  };

  const saved = vscode.getState() || {};

  const state = {
    items: [],
    types: [],
    statusLabels: {},
    includeArchived: false,
    editingId: null,
    viewMode: saved.viewMode || 'auto',
    collapsed: saved.collapsed || {}
  };

  const $ = (id) => document.getElementById(id);
  const listEl = $('list');
  const emptyEl = $('empty');
  const modalEl = $('modal');
  let tooltipEl = null;
  let tooltipTimer = null;

  function persist() {
    vscode.setState({ viewMode: state.viewMode, collapsed: state.collapsed });
  }

  function iconClass(name) {
    return 'codicon ' + (ICONS[name] || 'codicon-tag');
  }

  function typeOf(typeId) {
    const t = state.types.find((x) => x.id === typeId);
    return t || { id: typeId, label: '(Deleted type)', icon: 'tag' };
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // --- Ordering / grouping ---

  function byCreatedAsc(a, b) {
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  }

  function autoSorted() {
    return [...state.items].sort((a, b) => {
      const s = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
      if (s !== 0) {
        return s;
      }
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });
  }

  function orderedItems() {
    if (state.viewMode === 'auto') {
      return autoSorted();
    }
    return [...state.items].sort(byCreatedAsc); // fixed: stable creation order
  }

  function groupedByStatus() {
    const groups = { pending: [], 'in-progress': [], done: [] };
    for (const item of state.items) {
      (groups[item.status] || groups.pending).push(item);
    }
    for (const key of Object.keys(groups)) {
      groups[key].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    }
    return groups;
  }

  function renderList(changedIds) {
    const prevPositions = capturePositions();

    listEl.innerHTML = '';
    emptyEl.hidden = state.items.length > 0;

    if (state.viewMode === 'grouped') {
      const groups = groupedByStatus();
      const order = ['pending', 'in-progress', 'done'];
      for (const statusKey of order) {
        const items = groups[statusKey];
        const section = document.createElement('div');
        section.className = 'group';
        section.appendChild(buildGroupHeader(statusKey, items));
        if (!state.collapsed[statusKey]) {
          for (const item of items) {
            section.appendChild(buildCard(item));
          }
        }
        listEl.appendChild(section);
      }
    } else {
      for (const item of orderedItems()) {
        listEl.appendChild(buildCard(item));
      }
    }

    // FLIP animation (only when order actually changes)
    if (state.viewMode === 'auto' || state.viewMode === 'grouped') {
      animateFlip(prevPositions, changedIds);
    }
  }

  function capturePositions() {
    const map = {};
    listEl.querySelectorAll('.card[data-id]').forEach((el) => {
      map[el.dataset.id] = el.getBoundingClientRect();
    });
    return map;
  }

  function animateFlip(prevPositions, changedIds) {
    const cards = listEl.querySelectorAll('.card[data-id]');
    const hasMoves = Object.keys(prevPositions).length > 0;

    cards.forEach((el) => {
      const id = el.dataset.id;
      const prev = prevPositions[id];

      if (!prev) {
        // Newly added card
        el.animate(
          [{ opacity: 0 }, { opacity: 1 }],
          { duration: 250, easing: 'ease' }
        );
        return;
      }

      if (hasMoves) {
        const next = el.getBoundingClientRect();
        const dy = prev.top - next.top;
        if (Math.abs(dy) > 1) {
          el.animate(
            [
              { transform: 'translateY(' + dy + 'px)' },
              { transform: 'translateY(0px)' }
            ],
            { duration: 250, easing: 'ease' }
          );
        }
      }

      if (changedIds && changedIds[id]) {
        el.animate(
          [
            { backgroundColor: 'var(--vscode-focusBorder)' },
            { backgroundColor: 'var(--vscode-editor-background, var(--vscode-sideBar-background))' }
          ],
          { duration: 500, easing: 'ease' }
        );
      }
    });
  }

  function buildCard(item) {
    const t = typeOf(item.typeId);
    const card = document.createElement('div');
    card.className = 'card' + (item.archived ? ' archived' : '');
    card.dataset.id = item.id;

    const head = document.createElement('div');
    head.className = 'card-head';

    const title = document.createElement('div');
    title.className = 'card-title';
    title.textContent = item.title;
    head.appendChild(title);

    const typeBadge = document.createElement('span');
    typeBadge.className = 'card-type';
    typeBadge.innerHTML = '<span class="' + iconClass(t.icon) + '"></span> ' + esc(t.label);
    head.appendChild(typeBadge);
    card.appendChild(head);

    if (item.description) {
      const desc = document.createElement('div');
      desc.className = 'card-desc';
      desc.textContent = item.description;
      desc.title = item.description;
      card.appendChild(desc);
    }

    const footer = document.createElement('div');
    footer.className = 'card-footer';

    const status = document.createElement('span');
    status.className = 'status ' + item.status;
    status.textContent = state.statusLabels[item.status] || item.status;
    const tooltip = statusTooltip(item.status);
    status.dataset.tooltip = tooltip;
    status.addEventListener('click', (e) => cycleStatus(item, e));
    status.addEventListener('mouseenter', (e) => showStatusTooltip(status, e));
    status.addEventListener('mouseleave', hideStatusTooltip);
    footer.appendChild(status);

    const spacer = document.createElement('span');
    spacer.className = 'spacer';
    footer.appendChild(spacer);

    footer.appendChild(btnIcon('codicon-edit', 'Edit', () => openEdit(item)));
    footer.appendChild(btnIcon('codicon-archive', item.archived ? 'Unarchive' : 'Archive', () => toggleArchive(item)));
    footer.appendChild(btnIcon('codicon-trash', 'Delete permanently', () => deleteItem(item), true));

    card.appendChild(footer);
    return card;
  }

  function buildGroupHeader(statusKey, items) {
    const header = document.createElement('div');
    header.className = 'group-header' + (state.collapsed[statusKey] ? ' collapsed' : '');
    header.dataset.group = statusKey;

    const chevron = document.createElement('span');
    chevron.className = 'chevron codicon codicon-chevron-down';
    header.appendChild(chevron);

    const label = document.createElement('span');
    label.textContent = state.statusLabels[statusKey] || statusKey;
    header.appendChild(label);

    const count = document.createElement('span');
    count.className = 'group-count';
    count.textContent = '(' + items.length + ')';
    header.appendChild(count);

    header.addEventListener('click', () => {
      state.collapsed[statusKey] = !state.collapsed[statusKey];
      persist();
      renderList();
    });
    return header;
  }

  function btnIcon(codicon, title, onClick, danger) {
    const b = document.createElement('button');
    b.className = 'icon-btn' + (danger ? ' danger' : '');
    b.title = title;
    b.innerHTML = '<span class="codicon ' + codicon + '"></span>';
    b.addEventListener('click', onClick);
    return b;
  }

  function statusTooltip(status) {
    if (status === 'pending') {
      return "Change status to 'In Progress'\nCtrl+Click: Change to 'Done'";
    }
    if (status === 'in-progress') {
      return "Change status to 'Done'\nCtrl+Click: Change to 'None'";
    }
    // done
    return "Change status to 'None'";
  }

  function ensureTooltip() {
    if (tooltipEl) {
      return tooltipEl;
    }
    tooltipEl = document.createElement('div');
    tooltipEl.className = 'tooltip';
    tooltipEl.style.visibility = 'hidden';
    document.body.appendChild(tooltipEl);
    return tooltipEl;
  }

  function showStatusTooltip(statusEl) {
    // Delay before showing, similar to VS Code's own hover behavior.
    clearTimeout(tooltipTimer);
    tooltipTimer = setTimeout(() => {
      positionStatusTooltip(statusEl);
    }, 500);
  }

  function positionStatusTooltip(statusEl) {
    const tip = ensureTooltip();
    tip.textContent = statusEl.dataset.tooltip || '';
    tip.classList.remove('below');
    tip.style.visibility = 'hidden';
    tip.style.left = '0px';
    tip.style.top = '0px';

    const target = statusEl.getBoundingClientRect();
    const tipWidth = tip.offsetWidth;
    const tipHeight = tip.offsetHeight;
    const viewportWidth = document.documentElement.clientWidth;
    const margin = 6;

    // Ideal: centered above the status chip.
    let left = target.left + target.width / 2 - tipWidth / 2;
    let top = target.top - tipHeight - margin;
    let below = false;

    // Clamp horizontally to stay fully within the viewport (works for both
    // left/right sidebar positions and RTL/LTR without any fixed assumption).
    if (left < margin) {
      left = margin;
    } else if (left + tipWidth > viewportWidth - margin) {
      left = viewportWidth - tipWidth - margin;
    }

    // If there is not enough room above, place it below the chip.
    if (top < margin) {
      top = target.bottom + margin;
      below = true;
    }

    // Arrow x position: center of the chip relative to the tooltip's left edge,
    // clamped within the tooltip so the arrow never overflows it.
    const chipCenter = target.left + target.width / 2;
    const arrowX = Math.min(Math.max(chipCenter - left, 10), tipWidth - 10);

    tip.style.left = left + 'px';
    tip.style.top = top + 'px';
    tip.style.setProperty('--arrow-x', arrowX + 'px');
    if (below) {
      tip.classList.add('below');
    }
    tip.style.visibility = 'visible';
  }

  function hideStatusTooltip() {
    clearTimeout(tooltipTimer);
    if (tooltipEl) {
      tooltipEl.style.visibility = 'hidden';
    }
  }

  function cycleStatus(item, event) {
    const ctrl = !!(event && (event.ctrlKey || event.metaKey));
    let next;

    if (!ctrl) {
      // Normal click: forward cycle.
      const i = STATUS_CYCLE.indexOf(item.status);
      next = STATUS_CYCLE[(i + 1) % STATUS_CYCLE.length];
    } else if (item.status === 'pending') {
      next = 'done';
    } else if (item.status === 'in-progress') {
      next = 'pending';
    } else {
      // done + Ctrl+Click: no-op
      return;
    }

    vscode.postMessage({ type: 'changeStatus', id: item.id, status: next });
  }

  function toggleArchive(item) {
    vscode.postMessage({ type: 'toggleArchive', id: item.id, archived: !item.archived });
  }

  function deleteItem(item) {
    vscode.postMessage({ type: 'deleteItem', id: item.id });
  }

  function fillTypeSelect() {
    const sel = $('f-type');
    sel.innerHTML = '';
    for (const t of state.types) {
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = t.label;
      sel.appendChild(opt);
    }
  }

  function openAdd() {
    state.editingId = null;
    $('modal-title').textContent = 'New note';
    $('f-title').value = '';
    $('f-desc').value = '';
    fillTypeSelect();
    if (state.types.length > 0) {
      $('f-type').value = state.types[0].id;
    }
    modalEl.hidden = false;
    $('f-title').focus();
  }

  function openEdit(item) {
    state.editingId = item.id;
    $('modal-title').textContent = 'Edit note';
    $('f-title').value = item.title;
    $('f-desc').value = item.description || '';
    fillTypeSelect();
    $('f-type').value = item.typeId;
    modalEl.hidden = false;
    $('f-title').focus();
  }

  function closeModal() {
    modalEl.hidden = true;
    state.editingId = null;
  }

  function saveModal() {
    const title = $('f-title').value.trim();
    if (!title) {
      $('f-title').focus();
      return;
    }
    const payload = {
      type: state.editingId ? 'updateItem' : 'addItem',
      title: title,
      description: $('f-desc').value,
      typeId: $('f-type').value
    };
    if (state.editingId) {
      payload.id = state.editingId;
    }
    vscode.postMessage(payload);
    closeModal();
  }

  function setArchiveVisible(visible) {
    state.includeArchived = visible;
    $('btn-archive-toggle').textContent = visible ? 'Hide archive' : 'Archive';
  }

  let prevStatusById = {};

  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (!msg || msg.type !== 'state') {
      return;
    }
    const newItems = msg.items || [];
    const changedIds = {};
    newItems.forEach((it) => {
      if (prevStatusById[it.id] !== undefined && prevStatusById[it.id] !== it.status) {
        changedIds[it.id] = true;
      }
    });

    state.items = newItems;
    state.types = msg.types || [];
    state.statusLabels = msg.statusLabels || {};
    state.includeArchived = !!msg.includeArchived;
    if (msg.direction === 'rtl' || msg.direction === 'ltr') {
      document.documentElement.setAttribute('dir', msg.direction);
    }
    setArchiveVisible(state.includeArchived);
    renderList(changedIds);

    prevStatusById = {};
    newItems.forEach((it) => {
      prevStatusById[it.id] = it.status;
    });
  });

  const viewModeEl = $('view-mode');
  viewModeEl.value = state.viewMode;
  viewModeEl.addEventListener('change', () => {
    state.viewMode = viewModeEl.value;
    persist();
    renderList();
  });

  $('btn-add').addEventListener('click', openAdd);
  $('btn-archive-toggle').addEventListener('click', () => {
    vscode.postMessage({ type: 'toggleArchiveView' });
  });
  $('btn-insert-test').addEventListener('click', () => {
    vscode.postMessage({ type: 'insertTestData' });
  });
  $('btn-delete-test').addEventListener('click', () => {
    vscode.postMessage({ type: 'clearAll' });
  });
  $('modal-close').addEventListener('click', closeModal);
  $('modal-cancel').addEventListener('click', closeModal);
  $('modal-save').addEventListener('click', saveModal);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modalEl.hidden) {
      closeModal();
    }
  });

  // Request the initial state on startup
  vscode.postMessage({ type: 'refresh' });
})();
