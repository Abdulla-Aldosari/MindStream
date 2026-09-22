/* global acquireVsCodeApi */
(function () {
  const vscode = acquireVsCodeApi();

  const STATUS_CYCLE = ['pending', 'in-progress', 'done'];
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

  const state = {
    items: [],
    types: [],
    statusLabels: {},
    includeArchived: false,
    editingId: null
  };

  const $ = (id) => document.getElementById(id);
  const listEl = $('list');
  const emptyEl = $('empty');
  const modalEl = $('modal');

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

  function renderList() {
    listEl.innerHTML = '';
    emptyEl.hidden = state.items.length > 0;

    for (const item of state.items) {
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
      status.title = 'Change status';
      status.addEventListener('click', () => cycleStatus(item));
      footer.appendChild(status);

      const spacer = document.createElement('span');
      spacer.className = 'spacer';
      footer.appendChild(spacer);

      footer.appendChild(btnIcon('codicon-edit', 'Edit', () => openEdit(item)));
      footer.appendChild(btnIcon('codicon-archive', item.archived ? 'Unarchive' : 'Archive', () => toggleArchive(item)));
      footer.appendChild(btnIcon('codicon-trash', 'Delete permanently', () => deleteItem(item), true));

      card.appendChild(footer);
      listEl.appendChild(card);
    }
  }

  function btnIcon(codicon, title, onClick, danger) {
    const b = document.createElement('button');
    b.className = 'icon-btn' + (danger ? ' danger' : '');
    b.title = title;
    b.innerHTML = '<span class="codicon ' + codicon + '"></span>';
    b.addEventListener('click', onClick);
    return b;
  }

  function cycleStatus(item) {
    const i = STATUS_CYCLE.indexOf(item.status);
    const next = STATUS_CYCLE[(i + 1) % STATUS_CYCLE.length];
    vscode.postMessage({ type: 'changeStatus', id: item.id, status: next });
  }

  function toggleArchive(item) {
    vscode.postMessage({ type: 'toggleArchive', id: item.id, archived: !item.archived });
  }

  function deleteItem(item) {
    if (window.confirm('Delete this note permanently?\n"' + item.title + '"')) {
      vscode.postMessage({ type: 'deleteItem', id: item.id });
    }
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

  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (!msg || msg.type !== 'state') {
      return;
    }
    state.items = msg.items || [];
    state.types = msg.types || [];
    state.statusLabels = msg.statusLabels || {};
    state.includeArchived = !!msg.includeArchived;
    if (msg.direction === 'rtl' || msg.direction === 'ltr') {
      document.documentElement.setAttribute('dir', msg.direction);
    }
    setArchiveVisible(state.includeArchived);
    renderList();
  });

  $('btn-add').addEventListener('click', openAdd);
  $('btn-archive-toggle').addEventListener('click', () => {
    vscode.postMessage({ type: 'toggleArchiveView' });
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
