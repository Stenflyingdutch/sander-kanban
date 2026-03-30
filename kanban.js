const STORAGE_KEY = 'family-board-v2';
const DEFAULT_SOLL = 160;

const state = {
  currentUser: null,
  activeTab: 'chat',
  activeTopic: 'allgemeines',
  threadsByTopic: {},
  antonellaChanges: { 0: DEFAULT_SOLL },
};

const loginView = document.getElementById('loginView');
const appView = document.getElementById('appView');
const welcomeText = document.getElementById('welcomeText');
const tabsEl = document.getElementById('tabs');
const logoutButton = document.getElementById('logoutButton');
const chatPanel = document.getElementById('chatPanel');
const antonellaPanel = document.getElementById('antonellaPanel');
const topicSelect = document.getElementById('topicSelect');
const messagesEl = document.getElementById('messages');
const threadTitle = document.getElementById('threadTitle');
const messageForm = document.getElementById('messageForm');
const senderSelect = document.getElementById('senderSelect');
const messageInput = document.getElementById('messageInput');
const monthTableBody = document.getElementById('monthTableBody');
const loginError = document.getElementById('loginError');

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    state.threadsByTopic = parsed.threadsByTopic || {};
    state.antonellaChanges = parsed.antonellaChanges || { 0: DEFAULT_SOLL };
  } catch {
    // fallback defaults
  }
}

function persistState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    threadsByTopic: state.threadsByTopic,
    antonellaChanges: state.antonellaChanges,
  }));
}

function setUser(user) {
  state.currentUser = user;
  loginView.classList.add('hidden');
  appView.classList.remove('hidden');
  welcomeText.textContent = `Hallo ${user}`;
  renderTabs();
  if (user === 'Antonella') {
    state.activeTab = 'antonella';
  }
  renderActiveTab();
}

function logout() {
  state.currentUser = null;
  appView.classList.add('hidden');
  loginView.classList.remove('hidden');
}

function availableTabs() {
  if (state.currentUser === 'Antonella') return [{ key: 'antonella', label: 'Antonella' }];
  return [
    { key: 'chat', label: 'Chat' },
    { key: 'antonella', label: 'Antonella' },
  ];
}

function renderTabs() {
  tabsEl.innerHTML = '';
  availableTabs().forEach((tab) => {
    const button = document.createElement('button');
    button.className = `tab-btn ${state.activeTab === tab.key ? 'active' : ''}`;
    button.textContent = tab.label;
    button.addEventListener('click', () => {
      state.activeTab = tab.key;
      renderTabs();
      renderActiveTab();
    });
    tabsEl.appendChild(button);
  });
}

function ensureActiveThread(topic) {
  if (!state.threadsByTopic[topic]) state.threadsByTopic[topic] = [];
  let active = state.threadsByTopic[topic].find((thread) => thread.active);
  if (!active) {
    active = {
      id: `thread-${Date.now()}`,
      title: `${topic} #${state.threadsByTopic[topic].length + 1}`,
      active: true,
      messages: [],
      createdAt: new Date().toISOString(),
    };
    state.threadsByTopic[topic].forEach((thread) => { thread.active = false; });
    state.threadsByTopic[topic].push(active);
  }
  return active;
}

function getMonthSoll(monthIndex) {
  const indices = Object.keys(state.antonellaChanges).map(Number).sort((a, b) => a - b);
  let current = DEFAULT_SOLL;
  indices.forEach((idx) => {
    if (idx <= monthIndex) current = Number(state.antonellaChanges[idx]);
  });
  return current;
}

function updateSollFrom(monthIndex, value) {
  state.antonellaChanges[monthIndex] = Number(value);
  persistState();
  renderAntonellaTable();
}

function renderAntonellaTable() {
  monthTableBody.innerHTML = '';
  const formatter = new Intl.DateTimeFormat('de-DE', { month: 'long', year: 'numeric' });
  const year = new Date().getFullYear();

  for (let month = 0; month < 12; month += 1) {
    const tr = document.createElement('tr');
    const label = formatter.format(new Date(year, month, 1));
    const soll = getMonthSoll(month);

    tr.innerHTML = `
      <td>${label}</td>
      <td><span class="soll-label">${soll}</span></td>
      <td><button class="edit-btn" type="button" title="Sollstunden ändern">✏️</button></td>
    `;

    const editBtn = tr.querySelector('.edit-btn');
    editBtn.addEventListener('click', () => {
      const cell = tr.children[1];
      cell.innerHTML = `<input class="soll-input" type="number" min="0" value="${soll}">`;
      const input = cell.querySelector('input');
      input.focus();
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          updateSollFrom(month, Number(input.value || DEFAULT_SOLL));
        }
      });
      input.addEventListener('blur', () => updateSollFrom(month, Number(input.value || DEFAULT_SOLL)));
    });

    monthTableBody.appendChild(tr);
  }
}

function renderChat() {
  const topic = state.activeTopic;
  const thread = ensureActiveThread(topic);
  threadTitle.textContent = `Thread: ${thread.title}`;

  messagesEl.innerHTML = '';
  thread.messages.forEach((msg) => {
    const div = document.createElement('div');
    div.className = `msg ${msg.person === 'Sander' ? 'sander' : 'nata'}`;
    div.innerHTML = `<small>${msg.person} · ${new Date(msg.at).toLocaleString('de-DE')}</small>${msg.text}`;
    messagesEl.appendChild(div);
  });
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function renderActiveTab() {
  chatPanel.classList.toggle('hidden', state.activeTab !== 'chat');
  antonellaPanel.classList.toggle('hidden', state.activeTab !== 'antonella');
  if (state.activeTab === 'chat') renderChat();
  if (state.activeTab === 'antonella') renderAntonellaTable();
}

document.querySelectorAll('.person-btn[data-person]').forEach((btn) => {
  btn.addEventListener('click', () => setUser(btn.dataset.person));
});

document.getElementById('antonellaLoginForm').addEventListener('submit', (event) => {
  event.preventDefault();
  const pw = document.getElementById('antonellaPassword').value;
  if (pw === 'Liam') {
    loginError.hidden = true;
    setUser('Antonella');
    return;
  }
  loginError.hidden = false;
});

logoutButton.addEventListener('click', logout);

topicSelect.addEventListener('change', () => {
  state.activeTopic = topicSelect.value;
  renderChat();
  persistState();
});

messageForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const text = messageInput.value.trim();
  if (!text) return;

  const thread = ensureActiveThread(state.activeTopic);
  thread.messages.push({
    person: senderSelect.value,
    text,
    at: new Date().toISOString(),
  });

  messageInput.value = '';
  renderChat();
  persistState();
});

loadState();
