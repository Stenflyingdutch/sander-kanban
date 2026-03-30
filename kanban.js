const state = {
  board: {},
  statuses: [],
  updatedAt: '',
  sourcePath: '',
  priorityFilter: 'all',
  categoryFilter: 'all',
  search: '',
  compactMode: false,
  showDone: false,
  editing: null,
  saveTimer: null,
  dragging: null,
};

const boardEl = document.getElementById('board');
const updatedAtEl = document.getElementById('updatedAt');
const cardCountEl = document.getElementById('cardCount');
const syncStateEl = document.getElementById('syncState');
const searchInput = document.getElementById('searchInput');
const toggleDoneButton = document.getElementById('toggleDoneButton');
const viewMenuButton = document.getElementById('viewMenuButton');
const viewMenu = viewMenuButton.closest('.view-menu');
const categoryFiltersEl = document.getElementById('categoryFilters');
const priorityFiltersEl = document.getElementById('priorityFilters');
const mobileModeButton = document.getElementById('mobileModeButton');
const refreshButton = document.getElementById('refreshButton');
const addButton = document.getElementById('addButton');
const todoDialog = document.getElementById('todoDialog');
const todoForm = document.getElementById('todoForm');
const dialogTitle = document.getElementById('dialogTitle');
const closeDialogButton = document.getElementById('closeDialogButton');
const cancelButton = document.getElementById('cancelButton');
const deleteButton = document.getElementById('deleteButton');
const titleInput = document.getElementById('titleInput');
const statusInput = document.getElementById('statusInput');
const categoryInput = document.getElementById('categoryInput');
const priorityInput = document.getElementById('priorityInput');
const noteInput = document.getElementById('noteInput');
const cardTemplate = document.getElementById('cardTemplate');

const CATEGORY_FILTERS = ['all', '🌐 online', '🏠 offline'];
const PRIORITY_FILTERS = ['all', '🔴 hoch', '🟡 mittel', '🟢 niedrig'];
const COMPACT_MODE_KEY = 'kanban-compact-mode';
const SHOW_DONE_KEY = 'kanban-show-done';

function uid() {
  return `todo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function formatUpdatedAt(value) {
  if (!value) return '-';
  return value;
}

function loadCompactModePreference() {
  try {
    return window.localStorage.getItem(COMPACT_MODE_KEY) === 'true';
  } catch {
    return false;
  }
}

function loadShowDonePreference() {
  try {
    return window.localStorage.getItem(SHOW_DONE_KEY) === 'true';
  } catch {
    return false;
  }
}

function persistCompactModePreference() {
  try {
    window.localStorage.setItem(COMPACT_MODE_KEY, String(state.compactMode));
  } catch {
    // Ignore storage issues and keep the UI working.
  }
}

function persistShowDonePreference() {
  try {
    window.localStorage.setItem(SHOW_DONE_KEY, String(state.showDone));
  } catch {
    // Ignore storage issues and keep the UI working.
  }
}

function renderCompactMode() {
  document.body.classList.toggle('compact-mode', state.compactMode);
  mobileModeButton.textContent = state.compactMode ? 'Standardansicht aktiv' : 'iPhone-Minimodus';
  mobileModeButton.setAttribute('aria-pressed', String(state.compactMode));
  addButton.textContent = state.compactMode ? '+ Todo' : 'Todo anlegen';
  refreshButton.textContent = state.compactMode ? '↻' : 'Neu laden';
  viewMenuButton.textContent = state.compactMode ? 'Filter' : 'Ansicht';
  searchInput.placeholder = state.compactMode ? 'Suchen' : 'Titel, Kategorie oder Priorität';
}

function visibleStatuses() {
  if (!state.compactMode) {
    return state.statuses.filter((status) => state.showDone || !status.done);
  }

  const compactOrder = ['angriff', 'backlog', 'warten', 'ideen', 'lesen-schauen'];
  const statusMap = new Map(state.statuses.map((status) => [status.key, status]));
  return compactOrder.map((key) => statusMap.get(key)).filter(Boolean);
}

function renderDoneToggle() {
  const doneCount = (state.board.erledigt || []).length;
  toggleDoneButton.textContent = state.showDone ? `Erledigt ausblenden (${doneCount})` : `Erledigt anzeigen (${doneCount})`;
  toggleDoneButton.setAttribute('aria-pressed', String(state.showDone));
}

function setPendingChanges() {
  setSyncState('Ungespeicherte Änderungen...', 'pending');
}

function closeViewMenu() {
  viewMenu?.removeAttribute('open');
}

function closeCardMenus(except = null) {
  document.querySelectorAll('.card-menu[open]').forEach((menu) => {
    if (menu !== except) menu.removeAttribute('open');
  });
}

function columnEmptyText(statusKey) {
  const byStatus = {
    ideen: 'Noch keine Idee notiert',
    'lesen-schauen': 'Noch nichts zum Lesen oder Schauen',
    backlog: 'Noch nichts im Backlog',
    angriff: 'Noch nichts im Fokus',
    warten: 'Hier wartet gerade nichts',
    erledigt: 'Noch nichts erledigt',
  };
  if (state.search || state.priorityFilter !== 'all' || state.categoryFilter !== 'all') return 'Kein Treffer in dieser Spalte';
  return byStatus[statusKey] || 'Noch keine Karten';
}

function setSyncState(text, type = 'idle') {
  syncStateEl.textContent = text;
  syncStateEl.parentElement.dataset.state = type;
}

function totalCards() {
  return Object.values(state.board).reduce((sum, items) => sum + items.length, 0);
}

function metaChips(item, statusKey) {
  const chips = [];

  if (item.category === '🌐 online') {
    chips.push({ kind: 'category', icon: '🌐', label: 'online' });
  } else if (item.category === '🏠 offline') {
    chips.push({ kind: 'category', icon: '🏠', label: 'offline' });
  } else if (item.category) {
    chips.push({ kind: 'category', icon: '•', label: item.category });
  }

  if (item.priority === '🔴 hoch') {
    chips.push({ kind: 'priority high', icon: '🔴', label: 'hoch' });
  } else if (item.priority === '🟡 mittel') {
    chips.push({ kind: 'priority medium', icon: '🟡', label: 'mittel' });
  } else if (item.priority === '🟢 niedrig') {
    chips.push({ kind: 'priority low', icon: '🟢', label: 'niedrig' });
  } else if (item.priority) {
    chips.push({ kind: 'priority', icon: '•', label: item.priority });
  }

  if (statusKey === 'erledigt' && item.date) {
    chips.push({ kind: 'date', icon: '🗓️', label: item.date });
  }

  return chips;
}

function notePreview(note) {
  const clean = String(note || '').trim().replace(/\s+/g, ' ');
  if (!clean) return '';
  return clean.length > 110 ? `${clean.slice(0, 107)}...` : clean;
}

function filteredItems(statusKey) {
  const items = state.board[statusKey] || [];
  return items.filter((item) => {
    if (state.priorityFilter !== 'all' && item.priority !== state.priorityFilter) return false;
    if (state.categoryFilter !== 'all' && item.category !== state.categoryFilter) return false;
    if (!state.search) return true;
    const haystack = `${item.title} ${item.category} ${item.priority}`.toLowerCase();
    return haystack.includes(state.search.toLowerCase());
  });
}

function renderFilters() {
  categoryFiltersEl.innerHTML = '';
  CATEGORY_FILTERS.forEach((filter) => {
    const button = document.createElement('button');
    button.className = `segment-button${state.categoryFilter === filter ? ' active' : ''}`;
    button.type = 'button';
    button.textContent = filter === 'all' ? 'Alle Orte' : filter;
    button.addEventListener('click', () => {
      state.categoryFilter = filter;
      renderBoard();
      renderFilters();
    });
    categoryFiltersEl.appendChild(button);
  });

  priorityFiltersEl.innerHTML = '';
  PRIORITY_FILTERS.forEach((filter) => {
    const button = document.createElement('button');
    button.className = `segment-button${state.priorityFilter === filter ? ' active' : ''}`;
    button.type = 'button';
    button.textContent = filter === 'all' ? 'Alle Prioritäten' : filter;
    button.addEventListener('click', () => {
      state.priorityFilter = filter;
      renderBoard();
      renderFilters();
    });
    priorityFiltersEl.appendChild(button);
  });
}

function renderBoard() {
  const statuses = visibleStatuses();
  updatedAtEl.textContent = formatUpdatedAt(state.updatedAt);
  cardCountEl.textContent = String(totalCards());
  boardEl.innerHTML = '';
  boardEl.style.setProperty('--visible-columns', String(Math.max(statuses.length, 1)));
  renderDoneToggle();

  statuses.forEach((status) => {
    const column = document.createElement('section');
    column.className = 'column';
    column.dataset.status = status.key;

    const visibleItems = filteredItems(status.key);

    const statusTitle = state.compactMode && status.key === 'lesen-schauen'
      ? '🎬 Filme'
      : status.title;

    const head = document.createElement('div');
    head.className = 'column-head';
    head.innerHTML = `
      <div>
        <h2 class="column-title">${statusTitle}</h2>
      </div>
      <div class="column-head-actions">
        <button class="column-add-button" type="button" data-status="${status.key}" aria-label="Neue Aufgabe in ${statusTitle}">+</button>
        <span class="column-count">${visibleItems.length}</span>
      </div>
    `;

    const list = document.createElement('div');
    list.className = 'column-list';
    list.dataset.status = status.key;

    if (visibleItems.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty-column';
      empty.textContent = columnEmptyText(status.key);
      list.appendChild(empty);
    } else {
      visibleItems.forEach((item) => {
        list.appendChild(createCard(item, status.key));
      });
    }

    column.append(head, list);
    boardEl.appendChild(column);
  });

  boardEl.querySelectorAll('.column-add-button').forEach((button) => {
    button.addEventListener('click', () => openDialog(null, button.dataset.status));
  });
}

function createCard(item, statusKey) {
  const fragment = cardTemplate.content.cloneNode(true);
  const card = fragment.querySelector('.todo-card');
  const dragHandle = fragment.querySelector('.drag-handle');
  const mainButton = fragment.querySelector('.todo-main');
  const title = fragment.querySelector('.todo-title');
  const meta = fragment.querySelector('.todo-meta');
  const note = fragment.querySelector('.todo-note');
  const completeButton = fragment.querySelector('.complete-button');
  const cardMenu = fragment.querySelector('.card-menu');
  const cardMenuPanel = fragment.querySelector('.card-menu-panel');

  card.dataset.id = item.id;
  card.dataset.status = statusKey;
  title.textContent = item.title;
  meta.innerHTML = '';
  const chips = metaChips(item, statusKey);
  meta.hidden = chips.length === 0;
  chips.forEach((chip) => {
    const element = document.createElement('span');
    element.className = `meta-chip ${chip.kind}`;
    element.setAttribute('aria-label', chip.label);
    element.title = chip.label;
    element.innerHTML = `${chip.icon ? `<span class="meta-chip-icon">${chip.icon}</span>` : ''}`;
    meta.appendChild(element);
  });
  const noteText = notePreview(item.note);
  note.textContent = noteText;
  note.hidden = !noteText;

  mainButton.addEventListener('click', () => openDialog(item.id, statusKey));
  dragHandle.addEventListener('pointerdown', (event) => startDrag(event, item.id, statusKey));

  if (statusKey === 'erledigt') {
    completeButton.textContent = '↺';
    completeButton.setAttribute('aria-label', 'Reaktivieren');
    completeButton.title = 'Reaktivieren';
    completeButton.addEventListener('click', () => moveToStatus(item.id, 'erledigt', state.statuses.find((entry) => !entry.done)?.key || 'backlog'));
  } else {
    completeButton.textContent = '✓';
    completeButton.setAttribute('aria-label', 'Erledigen');
    completeButton.title = 'Erledigen';
    completeButton.addEventListener('click', () => completeItem(item.id, statusKey));
  }

  cardMenu.addEventListener('toggle', () => {
    if (cardMenu.open) closeCardMenus(cardMenu);
  });

  state.statuses
    .filter((status) => status.key !== statusKey)
    .forEach((status) => {
      const button = document.createElement('button');
      button.className = 'card-menu-action';
      button.type = 'button';
      button.textContent = status.title;
      button.addEventListener('click', () => {
        cardMenu.removeAttribute('open');
        moveToStatus(item.id, statusKey, status.key, status.done ? { date: new Date().toISOString().slice(0, 10) } : {});
      });
      cardMenuPanel.appendChild(button);
    });

  return fragment;
}

function findItem(id) {
  for (const status of state.statuses) {
    const index = (state.board[status.key] || []).findIndex((item) => item.id === id);
    if (index >= 0) {
      return { statusKey: status.key, index, item: state.board[status.key][index] };
    }
  }
  return null;
}

function openDialog(id = null, statusKey = null) {
  const isEdit = Boolean(id);
  state.editing = isEdit ? { id, statusKey } : null;
  dialogTitle.textContent = isEdit ? 'Karte bearbeiten' : 'Neue Karte';
  deleteButton.hidden = !isEdit;

  statusInput.innerHTML = '';
  state.statuses.forEach((status) => {
    const option = document.createElement('option');
    option.value = status.key;
    option.textContent = status.title;
    statusInput.appendChild(option);
  });

  if (isEdit) {
    const result = findItem(id);
    if (!result) return;
    titleInput.value = result.item.title;
    statusInput.value = result.statusKey;
    categoryInput.value = result.item.category || '';
    priorityInput.value = result.item.priority || '';
    noteInput.value = result.item.note || '';
  } else {
    titleInput.value = '';
    statusInput.value = statusKey || 'backlog';
    categoryInput.value = '';
    priorityInput.value = '';
    noteInput.value = '';
  }

  todoDialog.showModal();
  titleInput.focus();
}

function closeDialog() {
  todoDialog.close();
}

function upsertItem(data) {
  const statusKey = data.status;
  const normalized = {
    id: data.id || uid(),
    title: data.title.trim(),
    category: data.category,
    priority: data.priority,
    note: data.note.trim(),
    date: statusKey === 'erledigt' ? (data.date || new Date().toISOString().slice(0, 10)) : '',
  };

  if (state.editing) {
    const current = findItem(state.editing.id);
    if (!current) return;
    state.board[current.statusKey].splice(current.index, 1);
  }

  const target = state.board[statusKey];
  target.unshift(normalized);
}

function deleteItem() {
  if (!state.editing) return;
  const current = findItem(state.editing.id);
  if (!current) return;
  state.board[current.statusKey].splice(current.index, 1);
  closeDialog();
  renderBoard();
  queueSave();
}

function completeItem(id, fromStatus) {
  moveToStatus(id, fromStatus, 'erledigt', { date: new Date().toISOString().slice(0, 10) });
}

function moveToStatus(id, fromStatus, toStatus, extra = {}) {
  const source = state.board[fromStatus] || [];
  const index = source.findIndex((item) => item.id === id);
  if (index < 0) return;

  const [item] = source.splice(index, 1);
  const moved = { ...item, ...extra };
  if (toStatus !== 'erledigt') moved.date = '';
  state.board[toStatus].unshift(moved);
  renderBoard();
  queueSave();
}

async function fetchBoard() {
  setSyncState('Lade Board...', 'loading');
  const response = await fetch('/api/todos');
  if (!response.ok) {
    const payload = await response.json().catch(() => ({ error: 'Unbekannter Fehler' }));
    throw new Error(payload.error || 'Board konnte nicht geladen werden');
  }
  const payload = await response.json();
  state.board = payload.board;
  state.statuses = payload.statuses;
  state.updatedAt = payload.updatedAt;
  state.sourcePath = payload.sourcePath;
  renderFilters();
  renderBoard();
  setSyncState('Alle Änderungen gespeichert', 'success');
}

async function saveBoard() {
  clearTimeout(state.saveTimer);
  state.saveTimer = null;
  setSyncState('Speichere Änderungen...', 'loading');

  const response = await fetch('/api/todos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ board: state.board }),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({ error: 'Speichern fehlgeschlagen' }));
    throw new Error(payload.error || 'Speichern fehlgeschlagen');
  }

  const payload = await response.json();
  state.board = payload.board;
  state.statuses = payload.statuses;
  state.updatedAt = payload.updatedAt;
  renderBoard();
  setSyncState('Alle Änderungen gespeichert', 'success');
}

function queueSave() {
  clearTimeout(state.saveTimer);
  setPendingChanges();
  state.saveTimer = setTimeout(() => {
    saveBoard().catch((error) => setSyncState(error.message, 'error'));
  }, 250);
}

function pointerPosition(event) {
  return { x: event.clientX, y: event.clientY };
}

function startDrag(event, id, statusKey) {
  event.preventDefault();
  const card = event.currentTarget.closest('.todo-card');
  const list = card.closest('.column-list');
  if (!card || !list) return;

  const rect = card.getBoundingClientRect();
  const clone = card.cloneNode(true);
  clone.classList.add('floating-card');
  document.body.appendChild(clone);

  state.dragging = {
    id,
    fromStatus: statusKey,
    originList: list,
    card,
    clone,
    overStatus: statusKey,
    beforeId: null,
  };

  card.classList.add('is-dragging');
  moveFloatingCard(pointerPosition(event));
  updateDragTarget(pointerPosition(event));

  window.addEventListener('pointermove', handlePointerMove);
  window.addEventListener('pointerup', handlePointerUp, { once: true });
}

function moveFloatingCard(point) {
  if (!state.dragging) return;
  state.dragging.clone.style.left = `${point.x}px`;
  state.dragging.clone.style.top = `${point.y}px`;
}

function clearDragIndicators() {
  document.querySelectorAll('.column-list').forEach((list) => list.classList.remove('drag-over'));
}

function updateDragTarget(point) {
  if (!state.dragging) return;
  clearDragIndicators();
  const element = document.elementFromPoint(point.x, point.y);
  const list = element?.closest('.column-list');
  if (!list) return;

  list.classList.add('drag-over');
  const statusKey = list.dataset.status;
  const cards = Array.from(list.querySelectorAll('.todo-card:not(.is-dragging)'));

  let beforeId = null;
  for (const card of cards) {
    const rect = card.getBoundingClientRect();
    if (point.y < rect.top + rect.height / 2) {
      beforeId = card.dataset.id;
      break;
    }
  }

  state.dragging.overStatus = statusKey;
  state.dragging.beforeId = beforeId;
}

function handlePointerMove(event) {
  const point = pointerPosition(event);
  moveFloatingCard(point);
  updateDragTarget(point);
}

function reorderItem(id, fromStatus, toStatus, beforeId) {
  const source = state.board[fromStatus];
  const fromIndex = source.findIndex((item) => item.id === id);
  if (fromIndex < 0) return false;

  const [item] = source.splice(fromIndex, 1);
  if (toStatus === 'erledigt' && !item.date) item.date = new Date().toISOString().slice(0, 10);
  if (toStatus !== 'erledigt') item.date = '';

  const target = state.board[toStatus];
  const targetIndex = beforeId ? target.findIndex((entry) => entry.id === beforeId) : -1;
  if (targetIndex >= 0) target.splice(targetIndex, 0, item);
  else target.push(item);
  return true;
}

function handlePointerUp() {
  if (!state.dragging) return;

  const { id, fromStatus, overStatus, beforeId, card, clone } = state.dragging;
  window.removeEventListener('pointermove', handlePointerMove);
  clearDragIndicators();
  card.classList.remove('is-dragging');
  clone.remove();

  const changed = reorderItem(id, fromStatus, overStatus || fromStatus, beforeId);
  state.dragging = null;
  renderBoard();
  if (changed) queueSave();
}

refreshButton.addEventListener('click', () => {
  fetchBoard().catch((error) => setSyncState(error.message, 'error'));
});

mobileModeButton.addEventListener('click', () => {
  state.compactMode = !state.compactMode;
  persistCompactModePreference();
  renderCompactMode();
  closeViewMenu();
});

toggleDoneButton.addEventListener('click', () => {
  state.showDone = !state.showDone;
  persistShowDonePreference();
  renderDoneToggle();
  renderBoard();
  closeViewMenu();
});

addButton.addEventListener('click', () => openDialog());

searchInput.addEventListener('input', () => {
  state.search = searchInput.value.trim();
  renderBoard();
});

todoForm.addEventListener('submit', (event) => {
  event.preventDefault();
  upsertItem({
    id: state.editing?.id,
    title: titleInput.value,
    status: statusInput.value,
    category: categoryInput.value,
    priority: priorityInput.value,
    note: noteInput.value,
    date: state.editing ? findItem(state.editing.id)?.item?.date : '',
  });
  closeDialog();
  renderBoard();
  queueSave();
});

deleteButton.addEventListener('click', deleteItem);
closeDialogButton.addEventListener('click', closeDialog);
cancelButton.addEventListener('click', closeDialog);

document.addEventListener('click', (event) => {
  if (!viewMenu.contains(event.target)) closeViewMenu();
  if (!event.target.closest('.card-menu')) closeCardMenus();
});

state.compactMode = loadCompactModePreference();
state.showDone = loadShowDonePreference();
renderCompactMode();
renderDoneToggle();

fetchBoard().catch((error) => {
  setSyncState(error.message, 'error');
});
