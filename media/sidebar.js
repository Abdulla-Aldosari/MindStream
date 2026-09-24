(function () {
  const vscode = acquireVsCodeApi();

  const STATUS_CYCLE = ['pending', 'in-progress', 'done'];
  const STATUS_ORDER = { pending: 0, 'in-progress': 1, done: 2 };
  // Full list of available codicon names, generated at build time from the
  // codicons package (single source of truth) and loaded before this script.
  const AVAILABLE_ICONS = window.CODICON_NAMES && window.CODICON_NAMES.length
    ? window.CODICON_NAMES
    : ['wrench', 'edit', 'star', 'sync', 'code', 'beaker', 'note', 'link', 'tag'];

  const saved = vscode.getState() || {};

  const state = {
    items: [],
    types: [],
    categories: [],
    statusLabels: {},
    includeArchived: false,
    editingId: null,
    viewMode: saved.viewMode || 'auto',
    collapsed: saved.collapsed || {},
    categoryFilter: saved.categoryFilter || 'all',
    formTypeId: null,
    formCategoryId: null,
    pendingTypeIcon: 'tag',
    iconsModalMode: null,
    direction: 'ltr'
  };

  const $ = (id) => document.getElementById(id);
  const listEl = $('list');
  const emptyEl = $('empty');
  const modalEl = $('modal');
  const viewModalEl = $('view-modal');
  let viewingItem = null;
  let tooltipEl = null;
  let tooltipTimer = null;

  function persist() {
    vscode.setState({
      viewMode: state.viewMode,
      collapsed: state.collapsed,
      categoryFilter: state.categoryFilter
    });
  }

  function iconClass(name) {
    return 'codicon ' + (name ? 'codicon-' + name : 'codicon-tag');
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

  // --- Custom select component (replaces native <select>) ---

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function escapeAttr(value) {
    return escapeHtml(value).replace(/`/g, '&#96;');
  }

  const csIcons = {
    chevron: '<svg width="17" height="17" viewBox="0 0 21 21" class="cs-chevron" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="m6 9l6 6l6-6"></path></svg>',
    checkmark: '<svg width="17" height="17" viewBox="0 0 24 24" class="cs-check" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 6L9 17l-5-5"></path></svg>'
  };

  function renderCustomSelect(wrapperId, btnId, menuId, options, selectedValue, btnExtraClass, menuUp, wrapExtraClass) {
    const selectedOption = options.find(function (o) {
      return o.value === selectedValue;
    });
    const selectedLabel = selectedOption ? selectedOption.label : options.length ? options[0].label : '—';

    const items = options
      .map(function (opt) {
        const isSelected = opt.value === selectedValue;
        const badgeHtml = opt.badge ? '<span class="cs-item-badge">' + opt.badge + '</span>' : '';
        const isStart = opt.badgePosition === 'start';
        const itemClass = opt.itemClass ? ' ' + opt.itemClass : '';
        return (
          '<div class="cs-item' + itemClass + '" role="menuitem" tabindex="-1" data-value="' + escapeAttr(opt.value) + '">' +
          '<span class="cs-item-label-group">' +
          (isStart ? badgeHtml : '') +
          '<span class="cs-item-label">' + escapeHtml(opt.label) + '</span>' +
          (!isStart ? badgeHtml : '') +
          '</span>' +
          (isSelected ? csIcons.checkmark : '') +
          '</div>'
        );
      })
      .join('');

    const menuClass = 'cs-menu' + (menuUp ? ' cs-menu-up' : '');
    const wrapClass = 'cs-wrap' + (wrapExtraClass ? ' ' + wrapExtraClass : '');
    const selectedItemClass = selectedOption && selectedOption.itemClass ? ' ' + selectedOption.itemClass : '';

    return (
      '<div class="' + wrapClass + '" id="' + escapeAttr(wrapperId) + '">' +
      '<button class="cs-btn' + (btnExtraClass ? ' ' + btnExtraClass : '') + selectedItemClass + '" type="button" aria-haspopup="menu" aria-expanded="false" id="' + escapeAttr(btnId) + '">' +
      '<span class="cs-btn-label">' + escapeHtml(selectedLabel) + '</span>' +
      csIcons.chevron +
      '</button>' +
      '<div class="' + menuClass + '" role="menu" id="' + escapeAttr(menuId) + '" hidden>' +
      '<div class="cs-menu-items-wrapper">' + items + '</div>' +
      '</div>' +
      '</div>'
    );
  }

  function bindCustomSelect(wrapperId, btnId, menuId, onChange) {
    const wrap = document.getElementById(wrapperId);
    const btn = document.getElementById(btnId);
    const menu = document.getElementById(menuId);

    if (!btn || !menu) {
      return;
    }

    function closeMenu() {
      if (!menu.hidden) {
        menu.hidden = true;
        btn.setAttribute('aria-expanded', 'false');
      }
      document.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('blur', onWindowBlur);
    }

    function onPointerDown(e) {
      if (wrap && !wrap.contains(e.target)) {
        closeMenu();
      }
    }

    function onWindowBlur() {
      closeMenu();
    }

    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (!menu.hidden) {
        closeMenu();
      } else {
        menu.hidden = false;
        btn.setAttribute('aria-expanded', 'true');
        menu.querySelectorAll('.cs-item').forEach(function (el) {
          el.removeAttribute('data-highlighted');
        });
        const checkEl = menu.querySelector('.cs-check');
        if (checkEl) {
          const highlightedItem = checkEl.closest('.cs-item');
          highlightedItem.setAttribute('data-highlighted', '');
          const itemsWrapper = menu.querySelector('.cs-menu-items-wrapper');
          if (itemsWrapper) {
            itemsWrapper.scrollTop =
              highlightedItem.offsetTop - itemsWrapper.clientHeight / 2 + highlightedItem.offsetHeight / 2;
          }
        }
        document.addEventListener('pointerdown', onPointerDown, true);
        window.addEventListener('blur', onWindowBlur);
      }
    });

    menu.querySelectorAll('.cs-item').forEach(function (item) {
      item.addEventListener('click', function () {
        const labelEl = btn.querySelector('.cs-btn-label');
        const itemLabelEl = item.querySelector('.cs-item-label');
        if (labelEl && itemLabelEl) {
          labelEl.textContent = itemLabelEl.textContent;
        }
        menu.querySelectorAll('.cs-check').forEach(function (el) {
          el.remove();
        });
        item.insertAdjacentHTML('beforeend', csIcons.checkmark);
        onChange(item.dataset.value);
        closeMenu();
      });
      item.addEventListener('mouseenter', function () {
        menu.querySelectorAll('.cs-item').forEach(function (el) {
          el.removeAttribute('data-highlighted');
        });
        item.setAttribute('data-highlighted', '');
      });
      item.addEventListener('mouseleave', function () {
        item.removeAttribute('data-highlighted');
      });
    });
  }

  // --- Ordering / grouping ---

  function filteredItems() {
    if (state.categoryFilter === 'all') {
      return state.items;
    }
    return state.items.filter((it) => it.categoryId === state.categoryFilter);
  }

  function byCreatedAsc(a, b) {
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  }

  function autoSorted() {
    return [...filteredItems()].sort((a, b) => {
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
    return [...filteredItems()].sort(byCreatedAsc); // fixed: stable creation order
  }

  function groupedByStatus() {
    const groups = { pending: [], 'in-progress': [], done: [] };
    for (const item of filteredItems()) {
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

    // Mark cards whose description is truncated so the "view" button appears.
    markTruncatedCards();

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

  function buildCardBase(item) {
    const t = typeOf(item.typeId);
    const card = document.createElement('div');
    card.className = 'card' + (item.archived ? ' archived' : '');
    card.dataset.id = item.id;
    card.setAttribute('dir', state.direction);

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
      card.appendChild(desc);
    }

    const footer = document.createElement('div');
    footer.className = 'card-footer';

    const status = document.createElement('span');
    status.className = 'status ' + item.status;
    status.textContent = state.statusLabels[item.status] || item.status;
    footer.appendChild(status);

    card.appendChild(footer);

    return card;
  }

  function buildCard(item) {
    const card = buildCardBase(item);

    const status = card.querySelector('.card-footer .status');
    status.dataset.tooltip = statusTooltip(item.status);
    status.addEventListener('click', (e) => cycleStatus(item, e));
    status.addEventListener('mouseenter', (e) => showStatusTooltip(status, e));
    status.addEventListener('mouseleave', hideStatusTooltip);

    const footer = card.querySelector('.card-footer');

    const spacer = document.createElement('span');
    spacer.className = 'spacer';
    footer.appendChild(spacer);

    const viewBtn = btnIcon('codicon-eye', 'View note', () => openView(item));
    viewBtn.classList.add('card-view-btn');
    footer.appendChild(viewBtn);
    footer.appendChild(btnIcon('codicon-edit', 'Edit', () => openEdit(item)));
    footer.appendChild(btnIcon('codicon-archive', item.archived ? 'Unarchive' : 'Archive', () => toggleArchive(item)));
    footer.appendChild(btnIcon('codicon-trash', 'Delete permanently', () => deleteItem(item), true));

    card.addEventListener('dblclick', (e) => {
      if (e.target.closest('button, .status')) {
        return;
      }
      openView(item);
    });

    return card;
  }

  function buildReportCard(item) {
    return buildCardBase(item);
  }

  function markTruncatedCards() {
    listEl.querySelectorAll('.card').forEach((el) => {
      const desc = el.querySelector('.card-desc');
      if (desc && desc.scrollHeight > desc.clientHeight) {
        el.classList.add('has-overflow');
      } else {
        el.classList.remove('has-overflow');
      }
    });
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

  function fillTypeSelect(selectedTypeId) {
    const options = state.types.map(function (t) {
      const badge = t.icon ? '<span class="' + iconClass(t.icon) + '"></span>' : '';
      return { value: t.id, label: t.label, badge: badge, badgePosition: 'start' };
    });
    state.formTypeId = selectedTypeId != null ? selectedTypeId : (state.types[0] && state.types[0].id) || null;
    $('f-type-container').innerHTML = renderCustomSelect(
      'f-type-wrap',
      'f-type-btn',
      'f-type-menu',
      options,
      state.formTypeId,
      '',
      false,
      'cs-wrap-full'
    );
    bindCustomSelect('f-type-wrap', 'f-type-btn', 'f-type-menu', function (value) {
      state.formTypeId = value;
    });
  }

  function fillCategorySelect(selectedCategoryId) {
    const options = state.categories.map(function (c) {
      return { value: c.id, label: c.label };
    });
    state.formCategoryId = selectedCategoryId != null ? selectedCategoryId : (state.categories[0] && state.categories[0].id) || null;
    $('f-category-container').innerHTML = renderCustomSelect(
      'f-category-wrap',
      'f-category-btn',
      'f-category-menu',
      options,
      state.formCategoryId,
      '',
      false,
      'cs-wrap-full'
    );
    bindCustomSelect('f-category-wrap', 'f-category-btn', 'f-category-menu', function (value) {
      state.formCategoryId = value;
    });
  }

  function openAdd() {
    closeAllModals();
    state.editingId = null;
    $('modal-title').textContent = 'New note';
    $('f-title').value = '';
    $('f-desc').value = '';
    fillTypeSelect(state.types[0] && state.types[0].id);
    // Default to the currently filtered category when adding a note.
    fillCategorySelect(state.categoryFilter !== 'all' ? state.categoryFilter : null);
    modalEl.hidden = false;
    $('f-title').focus();
  }

  function openEdit(item) {
    closeAllModals();
    state.editingId = item.id;
    $('modal-title').textContent = 'Edit note';
    $('f-title').value = item.title;
    $('f-desc').value = item.description || '';
    fillTypeSelect(item.typeId);
    fillCategorySelect(item.categoryId);
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
      typeId: state.formTypeId,
      categoryId: state.formCategoryId
    };
    if (state.editingId) {
      payload.id = state.editingId;
    }
    vscode.postMessage(payload);
    closeModal();
  }

  function formatDate(value) {
    if (!value) {
      return '';
    }
    return new Date(value).toLocaleString();
  }

  function openView(item) {
    closeAllModals();
    viewingItem = item;

    const t = typeOf(item.typeId);
    const cat = state.categories.find((c) => c.id === item.categoryId);

    const titleEl = $('view-title');
    titleEl.textContent = item.title;
    titleEl.setAttribute('dir', state.direction);

    const typeEl = $('view-type');
    typeEl.innerHTML = '<span class="' + iconClass(t.icon) + '"></span> ' + esc(t.label);

    const catEl = $('view-category');
    catEl.textContent = cat ? cat.label : '';
    catEl.hidden = !cat;

    const statusEl = $('view-status');
    statusEl.className = 'status ' + item.status;
    statusEl.textContent = state.statusLabels[item.status] || item.status;

    const descEl = $('view-desc');
    descEl.setAttribute('dir', state.direction);
    descEl.hidden = !item.description;
    $('view-desc-scroll').textContent = item.description || '';

    $('view-timestamps').textContent =
      'Created: ' + formatDate(item.createdAt) + '\u2003\u00b7\u2003Updated: ' + formatDate(item.updatedAt);

    viewModalEl.hidden = false;
  }

  function closeView() {
    viewModalEl.hidden = true;
    viewingItem = null;
  }

  // Ensures only one modal is visible at a time within the sidebar.
  function closeAllModals() {
    modalEl.hidden = true;
    viewModalEl.hidden = true;
    $('categories-modal').hidden = true;
    $('report-modal').hidden = true;
    $('types-modal').hidden = true;
    $('icons-modal').hidden = true;
  }

  function setArchiveVisible(visible) {
    state.includeArchived = visible;
    $('btn-archive-toggle').textContent = visible ? 'Hide archive' : 'Archive';
  }

  // --- Categories management modal ---

  function openCategoriesModal() {
    closeAllModals();
    renderCategories();
    $('categories-modal').hidden = false;
    $('f-category-name').value = '';
    $('f-category-name').focus();
  }

  function closeCategoriesModal() {
    $('categories-modal').hidden = true;
  }

  // --- Weekly report modal ---

  function openWeeklyReportModal(report) {
    closeAllModals();
    renderWeeklyReport(report);
    $('report-modal').hidden = false;
  }

  function closeWeeklyReport() {
    $('report-modal').hidden = true;
  }

  function renderWeeklyReport(report) {
    $('report-title').textContent = 'Weekly Report — Week of ' + report.weekLabel;

    const summary = $('report-summary');
    summary.innerHTML = '';
    summary.appendChild(reportStat('Created this week', report.createdCount + ' notes'));
    summary.appendChild(reportStat('Completed this week', report.completedCount + ' notes'));
    summary.appendChild(reportStat('Currently in progress', report.inProgressCount + ' notes'));
    summary.appendChild(reportStat('Archived this week', report.archivedCount + ' notes'));

    const body = $('report-body');
    body.innerHTML = '';
    const completed = report.completed || [];
    const inProgress = report.inProgress || [];
    if (inProgress.length) {
      body.appendChild(reportSectionHeader('In progress', inProgress.length));
      inProgress.forEach((it) => body.appendChild(buildReportCard(it)));
    }
    if (completed.length) {
      body.appendChild(reportSectionHeader('Completed', completed.length));
      completed.forEach((it) => body.appendChild(buildReportCard(it)));
    }
    if (!completed.length && !inProgress.length) {
      const empty = document.createElement('div');
      empty.className = 'report-empty';
      empty.textContent = 'No completed or in-progress notes this week.';
      body.appendChild(empty);
    }
  }

  function reportStat(label, value) {
    const row = document.createElement('div');
    row.className = 'report-stat';
    const l = document.createElement('span');
    l.className = 'report-stat-label';
    l.textContent = label;
    const v = document.createElement('span');
    v.className = 'report-stat-value';
    v.textContent = value;
    row.appendChild(l);
    row.appendChild(v);
    return row;
  }

  function reportSectionHeader(label, count) {
    const h = document.createElement('div');
    h.className = 'report-section-header';
    h.textContent = label + ' (' + count + ')';
    return h;
  }

  function renderCategories(highlightId) {
    const listElC = $('categories-list');
    listElC.innerHTML = '';
    let highlightRow = null;
    let highlightBadge = null;

    for (const c of state.categories) {
      const row = document.createElement('div');
      row.className = 'category-row';

      const label = document.createElement('span');
      label.className = 'category-label';
      label.textContent = c.label;
      row.appendChild(label);

      const count = document.createElement('span');
      count.className = 'category-count';
      count.textContent = String(c.count || 0);
      row.appendChild(count);

      if (c.id === highlightId) {
        highlightRow = row;
        highlightBadge = document.createElement('span');
        highlightBadge.className = 'category-new-badge';
        highlightBadge.textContent = 'New';
        row.appendChild(highlightBadge);
      }

      if (c.isDefault) {
        const badge = document.createElement('span');
        badge.className = 'category-default-badge';
        badge.textContent = 'Default';
        row.appendChild(badge);
      }

      const spacer = document.createElement('span');
      spacer.className = 'spacer';
      row.appendChild(spacer);

      const editBtn = document.createElement('button');
      editBtn.className = 'icon-btn';
      editBtn.title = 'Rename';
      editBtn.innerHTML = '<span class="codicon codicon-edit"></span>';
      editBtn.addEventListener('click', () => startRenameCategory(c, label));
      row.appendChild(editBtn);

      if (!c.isDefault) {
        const delBtn = document.createElement('button');
        delBtn.className = 'icon-btn danger';
        delBtn.title = 'Delete';
        delBtn.innerHTML = '<span class="codicon codicon-trash"></span>';
        delBtn.addEventListener('click', () => {
          vscode.postMessage({ type: 'deleteCategory', id: c.id });
        });
        row.appendChild(delBtn);
      }

      listElC.appendChild(row);
    }

    if (highlightRow) {
      highlightRow.classList.add('just-added');
      requestAnimationFrame(() => {
        highlightRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
      setTimeout(() => {
        highlightRow.classList.remove('just-added');
        if (highlightBadge && highlightBadge.parentNode) {
          highlightBadge.remove();
        }
      }, 1700);
    }
  }

  function startRenameCategory(cat, labelEl) {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'category-rename-input';
    input.value = cat.label;
    labelEl.replaceWith(input);
    input.focus();
    input.select();

    let done = false;
    const finish = (rename) => {
      if (done) {
        return;
      }
      done = true;
      const value = input.value.trim();
      if (rename && value && value !== cat.label) {
        vscode.postMessage({ type: 'renameCategory', id: cat.id, label: value });
      } else {
        renderCategories();
      }
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.stopPropagation();
        finish(true);
      } else if (e.key === 'Escape') {
        e.stopPropagation();
        finish(false);
      }
    });
    input.addEventListener('blur', () => finish(true));
  }

  function addCategoryFromInput() {
    const input = $('f-category-name');
    const value = input.value.trim();
    if (!value) {
      return;
    }
    vscode.postMessage({ type: 'addCategory', label: value });
    input.value = '';
  }

  // --- Types management modal ---

  function openTypesModal() {
    closeAllModals();
    state.pendingTypeIcon = 'tag';
    state.iconsModalMode = null;
    renderTypes();
    renderTypeIconButton();
    $('types-modal').hidden = false;
    $('f-type-name').value = '';
    $('f-type-name').focus();
  }

  function closeTypesModal() {
    $('types-modal').hidden = true;
    $('icons-modal').hidden = true;
    state.iconsModalMode = null;
  }

  function renderTypeIconButton() {
    const glyph = $('btn-type-icon-glyph');
    glyph.className = 'codicon ' + (state.pendingTypeIcon ? 'codicon-' + state.pendingTypeIcon : 'codicon-tag');
  }

  function renderTypes(highlightId) {
    const listElT = $('types-list');
    listElT.innerHTML = '';
    let highlightRow = null;
    let highlightBadge = null;

    for (const t of state.types) {
      const row = document.createElement('div');
      row.className = 'type-row';

      const iconBtn = document.createElement('button');
      iconBtn.className = 'icon-btn type-icon-btn';
      iconBtn.title = 'Change icon';
      iconBtn.innerHTML = '<span class="' + iconClass(t.icon) + '" data-type-icon="' + esc(t.id) + '"></span>';
      iconBtn.addEventListener('click', () => {
        if (
          isIconsModalOpen() &&
          state.iconsModalMode &&
          state.iconsModalMode.mode === 'edit' &&
          state.iconsModalMode.typeId === t.id
        ) {
          closeIconsModal();
        } else {
          openIconsModal({ mode: 'edit', typeId: t.id });
        }
      });
      row.appendChild(iconBtn);

      const label = document.createElement('span');
      label.className = 'type-label';
      label.textContent = t.label;
      row.appendChild(label);

      const count = document.createElement('span');
      count.className = 'type-count';
      count.textContent = String(t.count || 0);
      row.appendChild(count);

      if (t.id === highlightId) {
        highlightRow = row;
        highlightBadge = document.createElement('span');
        highlightBadge.className = 'type-new-badge';
        highlightBadge.textContent = 'New';
        row.appendChild(highlightBadge);
      }

      const spacer = document.createElement('span');
      spacer.className = 'spacer';
      row.appendChild(spacer);

      const editBtn = document.createElement('button');
      editBtn.className = 'icon-btn';
      editBtn.title = 'Rename';
      editBtn.innerHTML = '<span class="codicon codicon-edit"></span>';
      editBtn.addEventListener('click', () => startRenameType(t, label));
      row.appendChild(editBtn);

      const delBtn = document.createElement('button');
      delBtn.className = 'icon-btn danger';
      delBtn.title = 'Delete';
      delBtn.innerHTML = '<span class="codicon codicon-trash"></span>';
      delBtn.addEventListener('click', () => {
        vscode.postMessage({ type: 'deleteType', id: t.id });
      });
      row.appendChild(delBtn);

      listElT.appendChild(row);
    }

    if (highlightRow) {
      highlightRow.classList.add('just-added');
      requestAnimationFrame(() => {
        highlightRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });
      setTimeout(() => {
        highlightRow.classList.remove('just-added');
        if (highlightBadge && highlightBadge.parentNode) {
          highlightBadge.remove();
        }
      }, 1700);
    }
  }

  function startRenameType(type, labelEl) {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'type-rename-input';
    input.value = type.label;
    labelEl.replaceWith(input);
    input.focus();
    input.select();

    let done = false;
    const finish = (rename) => {
      if (done) {
        return;
      }
      done = true;
      const value = input.value.trim();
      if (rename && value && value !== type.label) {
        vscode.postMessage({ type: 'renameType', id: type.id, label: value });
      } else {
        renderTypes();
      }
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.stopPropagation();
        finish(true);
      } else if (e.key === 'Escape') {
        e.stopPropagation();
        finish(false);
      }
    });
    input.addEventListener('blur', () => finish(true));
  }

  function addTypeFromInput() {
    const input = $('f-type-name');
    const value = input.value.trim();
    if (!value) {
      return;
    }
    vscode.postMessage({ type: 'addType', label: value, icon: state.pendingTypeIcon });
    input.value = '';
    state.pendingTypeIcon = 'tag';
    renderTypeIconButton();
  }

  // --- Icons picker (opens below the types modal like a dropdown) ---

  function isIconsModalOpen() {
    return !$('icons-modal').hidden;
  }

  function openIconsModal(mode) {
    state.iconsModalMode = mode;
    $('icons-modal').hidden = false;
    $('f-icon-filter').value = '';
    renderIcons('');
    $('f-icon-filter').focus();
  }

  function closeIconsModal() {
    $('icons-modal').hidden = true;
    state.iconsModalMode = null;
  }

  function renderIcons(filter) {
    const grid = $('icons-grid');
    grid.innerHTML = '';
    const term = (filter || '').trim().toLowerCase();
    let matched = 0;
    for (const name of AVAILABLE_ICONS) {
      if (term && name.toLowerCase().indexOf(term) === -1) {
        continue;
      }
      matched++;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'icon-pick';
      btn.title = name;
      btn.dataset.icon = name;
      btn.innerHTML = '<span class="codicon codicon-' + name + '"></span>';
      btn.addEventListener('click', () => commitIcon(name));
      if (state.iconsModalMode && state.iconsModalMode.mode === 'edit') {
        const typeId = state.iconsModalMode.typeId;
        const originalIcon = (state.types.find((x) => x.id === typeId) || {}).icon;
        btn.addEventListener('mouseenter', () => previewTypeIcon(typeId, name));
        btn.addEventListener('mouseleave', () => previewTypeIcon(typeId, originalIcon));
      }
      grid.appendChild(btn);
    }
    if (matched === 0) {
      const empty = document.createElement('div');
      empty.className = 'icons-empty';
      empty.textContent = 'No icons match this filter';
      grid.appendChild(empty);
    }
  }

  function previewTypeIcon(typeId, icon) {
    const el = document.querySelector('[data-type-icon="' + typeId + '"]');
    if (el) {
      el.className = 'codicon ' + (icon ? 'codicon-' + icon : 'codicon-tag');
    }
  }

  function commitIcon(icon) {
    if (!state.iconsModalMode) {
      closeIconsModal();
      return;
    }
    if (state.iconsModalMode.mode === 'new') {
      state.pendingTypeIcon = icon;
      renderTypeIconButton();
    } else if (state.iconsModalMode.mode === 'edit') {
      vscode.postMessage({ type: 'setTypeIcon', id: state.iconsModalMode.typeId, icon: icon });
    }
    closeIconsModal();
  }

  let prevStatusById = {};

  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (!msg) {
      return;
    }
    if (msg.type === 'openAddNote') {
      openAdd();
      return;
    }
    if (msg.type === 'openCategories') {
      openCategoriesModal();
      return;
    }
    if (msg.type === 'openTypes') {
      openTypesModal();
      return;
    }
    if (msg.type === 'openWeeklyReport') {
      openWeeklyReportModal(msg.report);
      return;
    }
    if (msg.type !== 'state') {
      return;
    }
    const newItems = msg.items || [];
    const changedIds = {};
    newItems.forEach((it) => {
      if (prevStatusById[it.id] !== undefined && prevStatusById[it.id] !== it.status) {
        changedIds[it.id] = true;
      }
    });

    const prevCategories = state.categories || [];
    const prevTypes = state.types || [];
    state.items = newItems;
    state.types = msg.types || [];
    state.categories = msg.categories || [];
    state.statusLabels = msg.statusLabels || {};
    state.includeArchived = !!msg.includeArchived;
    state.direction = msg.direction === 'rtl' ? 'rtl' : 'ltr';
    setArchiveVisible(state.includeArchived);
    populateCategoryFilter();
    if (!$('categories-modal').hidden) {
      let addedCategoryId = null;
      if (prevCategories.length) {
        const prevIds = new Set(prevCategories.map((p) => p.id));
        for (const c of state.categories) {
          if (!prevIds.has(c.id)) {
            addedCategoryId = c.id;
            break;
          }
        }
      }
      renderCategories(addedCategoryId);
    }
    if (!$('types-modal').hidden) {
      let addedTypeId = null;
      if (prevTypes.length) {
        const prevTypeIds = new Set(prevTypes.map((p) => p.id));
        for (const t of state.types) {
          if (!prevTypeIds.has(t.id)) {
            addedTypeId = t.id;
            break;
          }
        }
      }
      renderTypes(addedTypeId);
      if (!$('icons-modal').hidden) {
        renderIcons($('f-icon-filter').value);
      }
    }
    renderList(changedIds);

    prevStatusById = {};
    newItems.forEach((it) => {
      prevStatusById[it.id] = it.status;
    });
  });

  function populateCategoryFilter() {
    const current = state.categoryFilter;
    const totalCount = state.items.length;
    const options = [{ value: 'all', label: 'All Categories', badge: '(' + totalCount + ')' }].concat(
      state.categories.map(function (c) {
        const count = state.items.filter(function (it) {
          return it.categoryId === c.id;
        }).length;
        return { value: c.id, label: c.label, badge: '(' + count + ')' };
      })
    );
    state.categoryFilter = state.categories.some((c) => c.id === current) ? current : 'all';
    $('category-filter-container').innerHTML = renderCustomSelect(
      'category-filter-wrap',
      'category-filter-btn',
      'category-filter-menu',
      options,
      state.categoryFilter,
      'cs-btn-toolbar',
      false,
      ''
    );
    bindCustomSelect('category-filter-wrap', 'category-filter-btn', 'category-filter-menu', function (value) {
      state.categoryFilter = value;
      persist();
      renderList();
    });
  }

  function initViewModeSelect() {
    const options = [
      { value: 'auto', label: 'Auto Sort' },
      { value: 'fixed', label: 'Fixed Order' },
      { value: 'grouped', label: 'Grouped' }
    ];
    $('view-mode-container').innerHTML = renderCustomSelect(
      'view-mode-wrap',
      'view-mode-btn',
      'view-mode-menu',
      options,
      state.viewMode,
      'cs-btn-toolbar',
      false,
      ''
    );
    bindCustomSelect('view-mode-wrap', 'view-mode-btn', 'view-mode-menu', function (value) {
      state.viewMode = value;
      persist();
      renderList();
    });
  }

  $('btn-archive-toggle').addEventListener('click', () => {
    vscode.postMessage({ type: 'toggleArchiveView' });
  });
  $('modal-close').addEventListener('click', closeModal);
  $('modal-cancel').addEventListener('click', closeModal);
  $('modal-save').addEventListener('click', saveModal);
  $('view-close').addEventListener('click', closeView);
  $('view-close-btn').addEventListener('click', closeView);
  $('view-edit').addEventListener('click', () => {
    const item = viewingItem;
    closeView();
    if (item) {
      openEdit(item);
    }
  });

  $('categories-close').addEventListener('click', closeCategoriesModal);
  $('report-close').addEventListener('click', closeWeeklyReport);
  $('btn-add-category').addEventListener('click', addCategoryFromInput);
  $('f-category-name').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      addCategoryFromInput();
    }
  });

  $('types-close').addEventListener('click', closeTypesModal);
  $('btn-add-type').addEventListener('click', addTypeFromInput);
  $('btn-type-icon').addEventListener('click', () => {
    if (isIconsModalOpen() && state.iconsModalMode && state.iconsModalMode.mode === 'new') {
      closeIconsModal();
    } else {
      openIconsModal({ mode: 'new' });
    }
  });
  $('f-type-name').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      addTypeFromInput();
    }
  });
  $('f-icon-filter').addEventListener('input', (e) => {
    renderIcons(e.target.value);
  });

  // Close the icons picker when clicking or focusing anywhere outside it,
  // except on the type-icon controls (those toggle it themselves).
  document.addEventListener('mousedown', (e) => {
    if (!isIconsModalOpen()) return;
    if ($('icons-modal').contains(e.target)) return;
    if (e.target.closest && e.target.closest('.type-icon-btn')) return;
    closeIconsModal();
  });

  document.addEventListener('focusin', (e) => {
    if (!isIconsModalOpen()) return;
    if ($('icons-modal').contains(e.target)) return;
    if (e.target.closest && e.target.closest('.type-icon-btn')) return;
    closeIconsModal();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!modalEl.hidden) {
        closeModal();
      } else if (!viewModalEl.hidden) {
        closeView();
      } else if (!$('categories-modal').hidden) {
        closeCategoriesModal();
      } else if (!$('report-modal').hidden) {
        closeWeeklyReport();
      } else if (!$('icons-modal').hidden) {
        closeIconsModal();
      } else if (!$('types-modal').hidden) {
        closeTypesModal();
      }
    }
  });

  // Hide the status tooltip when the user scrolls. Scroll events do not bubble,
  // so listen in the capture phase to catch the list and any nested scroller;
  // otherwise a `position: fixed` tooltip stays stuck in place while content
  // scrolls beneath a stationary mouse cursor.
  window.addEventListener('scroll', hideStatusTooltip, true);

  // Initialize the custom dropdowns (view mode is static; category filter is
  // re-rendered whenever new state arrives, so render an initial empty set).
  initViewModeSelect();
  populateCategoryFilter();

  // Request the initial state on startup
  vscode.postMessage({ type: 'refresh' });
})();
