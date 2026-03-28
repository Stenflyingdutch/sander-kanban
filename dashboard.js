/**
 * Einkaufsliste Dashboard
 * Pulls data from Cookidoo and Bring! tabs via content script injection.
 */

// ─── State ───────────────────────────────────────────────────
let cookidooItems = [];
let bringItems = [];
let consolidated = [];
let checkedKeys = new Set();
let activeFilter = 'all';
let searchTerm = '';

// ─── DOM refs ────────────────────────────────────────────────
const btnLoadCookidoo = document.getElementById('btn-load-cookidoo');
const btnLoadBring = document.getElementById('btn-load-bring');
const btnConsolidate = document.getElementById('btn-consolidate');
const btnCopy = document.getElementById('btn-copy');
const searchInput = document.getElementById('search');
const resultsEl = document.getElementById('results');
const listContainer = document.getElementById('list-container');
const statsBar = document.getElementById('stats-bar');
const filterChips = document.getElementById('filter-chips');

// ─── Parsing ─────────────────────────────────────────────────
function parseIngredient(raw, source) {
  const text = raw.trim().replace(/\s+/g, ' ');
  const m = text.match(
    /^(.+?)\s+(\d+[\d.,]*)\s*(kg|g|ml|l|EL|TL|Stk\.?|Stück|Dose[n]?|Bund|Scheibe[n]?|Prise[n]?|Pck\.?|Packung|Becher|Glas|Zehe[n]?)?$/i
  );
  if (m) {
    return { name: m[1].trim(), amount: parseFloat(m[2].replace(',', '.')), unit: m[3] || 'Stk', raw: text, source };
  }
  return { name: text, amount: 0, unit: '', raw: text, source };
}

function normalizeKey(name) {
  return name.toLowerCase()
    .replace(/[äÄ]/g, 'ae').replace(/[öÖ]/g, 'oe').replace(/[üÜ]/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]/g, '');
}

// ─── Categories ──────────────────────────────────────────────
const CATEGORIES = {
  '🥦 Gemüse': ['zwiebel','tomate','paprika','gurke','zucchini','brokkoli','karotte','möhre','spinat','salat','lauch','sellerie','pilz','champignon','aubergine','blumenkohl','kartoffel','süßkartoffel','knoblauch','ingwer','avocado','mais','erbse','bohne','kürbis','radieschen','kohlrabi','fenchel','rucola','mangold','kohl','rotkohl','weißkohl','frühlingszwiebel'],
  '🍎 Obst': ['apfel','birne','banane','orange','zitrone','limette','beere','erdbeere','himbeere','blaubeere','traube','kiwi','ananas','pfirsich','pflaume','melone','kirsche','mandarine','grapefruit','mango'],
  '🥩 Fleisch & Fisch': ['hähnchen','huhn','rind','schwein','hack','lamm','pute','schnitzel','wurst','schinken','speck','lachs','fisch','garnele','thunfisch','filet','steak','braten','chicken','salami','bacon'],
  '🧀 Milch & Eier': ['milch','käse','sahne','joghurt','butter','quark','schmand','frischkäse','parmesan','mozzarella','gouda','creme fraiche','mascarpone','ricotta','ei ','eier','creme'],
  '🍞 Backwaren': ['brot','brötchen','mehl','toast','semmel','ciabatta','tortilla','wrap','croissant','hefe','bagel'],
  '🫙 Vorräte': ['reis','nudel','pasta','spaghetti','penne','öl','olivenöl','essig','zucker','salz','pfeffer','dose','senf','ketchup','sojasauce','brühe','tomatenmark','passata','kokosmilch','linse','kichererbse','couscous','bulgur','nuss','mandel','honig','marmelade','müsli','haferflocke'],
  '🌿 Gewürze': ['basilikum','petersilie','schnittlauch','dill','rosmarin','thymian','oregano','koriander','minze','curry','paprikapulver','zimt','muskat','kreuzkümmel','chili','kurkuma','lorbeer'],
  '🧃 Getränke': ['wasser','saft','limonade','cola','bier','wein','tee','kaffee']
};

function categorize(name) {
  const lower = name.toLowerCase();
  for (const [cat, words] of Object.entries(CATEGORIES)) {
    if (words.some(w => lower.includes(w))) return cat;
  }
  return '📦 Sonstiges';
}

// ─── Consolidation ───────────────────────────────────────────
function consolidateAll() {
  const all = [
    ...cookidooItems.map(raw => parseIngredient(raw, 'cookidoo')),
    ...bringItems.map(raw => parseIngredient(raw, 'bring'))
  ];

  const map = new Map();
  all.forEach(item => {
    const key = normalizeKey(item.name);
    if (map.has(key)) {
      const ex = map.get(key);
      if (item.amount > 0) {
        if (ex.unit === item.unit || !ex.unit) {
          ex.amount += item.amount;
          ex.unit = ex.unit || item.unit;
        } else {
          ex.notes = (ex.notes || '') + ` + ${item.amount} ${item.unit}`;
        }
      }
      if (!ex.sources.includes(item.source)) ex.sources.push(item.source);
    } else {
      map.set(key, { ...item, sources: [item.source], notes: '', category: categorize(item.name) });
    }
  });

  consolidated = [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'de'));
  renderResults();
}

// ─── Find tab ────────────────────────────────────────────────
async function findTab(urlPattern) {
  const tabs = await chrome.tabs.query({ url: urlPattern });
  return tabs[0] || null;
}

async function injectAndSend(tabId, scriptFile, message) {
  // Inject content script
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: [scriptFile] });
  } catch (e) {
    console.warn('Inject error:', e);
  }
  await new Promise(r => setTimeout(r, 500));

  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, resp => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(resp);
    });
  });
}

// ─── Load from Cookidoo ──────────────────────────────────────
btnLoadCookidoo.addEventListener('click', async () => {
  const statusEl = document.getElementById('cookidoo-status');
  btnLoadCookidoo.classList.add('loading');
  btnLoadCookidoo.textContent = '⏳ Lade...';
  statusEl.innerHTML = '';

  try {
    // Find Cookidoo tab
    let tab = await findTab('https://cookidoo.de/*');
    if (!tab) tab = await findTab('https://cookidoo.vorwerk.de/*');

    if (!tab) {
      statusEl.innerHTML = '<div class="status-msg error">Kein Cookidoo-Tab gefunden. Bitte öffne cookidoo.de/shopping/de-DE/list</div>';
      btnLoadCookidoo.classList.remove('loading');
      btnLoadCookidoo.textContent = '⬇️ Von Cookidoo laden';
      return;
    }

    // Navigate to shopping list if not already there
    if (!tab.url.includes('/shopping/')) {
      await chrome.tabs.update(tab.id, { url: 'https://cookidoo.de/shopping/de-DE/list' });
      await new Promise(r => setTimeout(r, 4000));
    }

    const resp = await injectAndSend(tab.id, 'content.js', { action: 'scrapeShoppingList' });

    if (resp?.success && resp.items?.length > 0) {
      cookidooItems = resp.items;
      showPreview('cookidoo', cookidooItems);
      statusEl.innerHTML = `<div class="status-msg success">✅ ${cookidooItems.length} Zutaten geladen</div>`;
    } else {
      statusEl.innerHTML = '<div class="status-msg info">Keine Zutaten gefunden. Ist die Einkaufsliste leer?</div>';
    }
  } catch (e) {
    statusEl.innerHTML = `<div class="status-msg error">Fehler: ${e.message}</div>`;
  }

  btnLoadCookidoo.classList.remove('loading');
  btnLoadCookidoo.textContent = '🔄 Neu laden';
  updateConsolidateBtn();
});

// ─── Load from Bring ─────────────────────────────────────────
btnLoadBring.addEventListener('click', async () => {
  const statusEl = document.getElementById('bring-status');
  btnLoadBring.classList.add('loading');
  btnLoadBring.textContent = '⏳ Lade...';
  statusEl.innerHTML = '';

  try {
    const tab = await findTab('https://web.getbring.com/*');

    if (!tab) {
      statusEl.innerHTML = '<div class="status-msg error">Kein Bring-Tab gefunden. Bitte öffne web.getbring.com</div>';
      btnLoadBring.classList.remove('loading');
      btnLoadBring.textContent = '⬇️ Von Bring! laden';
      return;
    }

    const resp = await injectAndSend(tab.id, 'bring_content.js', { action: 'scrapeBringList' });

    if (resp?.success && resp.items?.length > 0) {
      bringItems = resp.items;
      showPreview('bring', bringItems);
      statusEl.innerHTML = `<div class="status-msg success">✅ ${bringItems.length} Items geladen</div>`;
    } else {
      statusEl.innerHTML = '<div class="status-msg info">Keine Items gefunden. Ist die Liste leer?</div>';
    }
  } catch (e) {
    statusEl.innerHTML = `<div class="status-msg error">Fehler: ${e.message}</div>`;
  }

  btnLoadBring.classList.remove('loading');
  btnLoadBring.textContent = '🔄 Neu laden';
  updateConsolidateBtn();
});

// ─── Preview ─────────────────────────────────────────────────
function showPreview(source, items) {
  const countEl = document.getElementById(`${source}-count`);
  const previewEl = document.getElementById(`${source}-preview`);
  countEl.style.display = 'block';
  countEl.textContent = `${items.length} ${source === 'cookidoo' ? 'Zutaten' : 'Items'}`;
  previewEl.style.display = 'block';
  previewEl.innerHTML = items.map(i => `<div class="item-preview-line">${escHtml(i)}</div>`).join('');
}

function escHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function updateConsolidateBtn() {
  btnConsolidate.disabled = (cookidooItems.length === 0 && bringItems.length === 0);
}

// ─── Consolidate ─────────────────────────────────────────────
btnConsolidate.addEventListener('click', () => {
  consolidateAll();
});

// ─── Render ──────────────────────────────────────────────────
function renderResults() {
  resultsEl.style.display = 'block';

  // Stats
  const stats = {
    total: consolidated.length,
    checked: checkedKeys.size,
    cookidoo: consolidated.filter(i => i.sources.includes('cookidoo')).length,
    bring: consolidated.filter(i => i.sources.includes('bring')).length,
    merged: consolidated.filter(i => i.sources.length > 1).length
  };

  statsBar.innerHTML = `
    <div class="stat"><span class="stat-num">${stats.total}</span><span class="stat-label">Gesamt</span></div>
    <div class="stat"><span class="stat-num">${stats.merged}</span><span class="stat-label">Zusammengeführt</span></div>
    <div class="stat"><span class="stat-num" style="color:var(--cookidoo)">${stats.cookidoo}</span><span class="stat-label">Cookidoo</span></div>
    <div class="stat"><span class="stat-num" style="color:var(--bring)">${stats.bring}</span><span class="stat-label">Bring!</span></div>
    <div class="stat"><span class="stat-num" style="color:#888">${stats.checked}/${stats.total}</span><span class="stat-label">Erledigt</span></div>
  `;

  // Filter chips
  const cats = ['all', ...new Set(consolidated.map(i => i.category))].sort();
  filterChips.innerHTML = cats.map(c =>
    `<button class="chip ${activeFilter === c ? 'active' : ''}" data-cat="${c}">${c === 'all' ? 'Alle' : c}</button>`
  ).join('');

  filterChips.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
      activeFilter = chip.dataset.cat;
      renderList();
      // Update active chip
      filterChips.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
    });
  });

  renderList();
}

function renderList() {
  const filtered = consolidated.filter(item => {
    if (activeFilter !== 'all' && item.category !== activeFilter) return false;
    if (searchTerm && !item.name.toLowerCase().includes(searchTerm.toLowerCase())) return false;
    return true;
  });

  // Group by category
  const grouped = {};
  filtered.forEach(item => {
    if (!grouped[item.category]) grouped[item.category] = [];
    grouped[item.category].push(item);
  });

  if (filtered.length === 0) {
    listContainer.innerHTML = '<div class="empty-state"><p>Keine Items gefunden</p></div>';
    return;
  }

  listContainer.innerHTML = Object.entries(grouped)
    .sort(([a], [b]) => a.localeCompare(b, 'de'))
    .map(([cat, items]) => `
      <div class="category-group">
        <div class="category-header">
          <span>${cat}</span>
          <span class="cat-count">${items.length}</span>
        </div>
        ${items.map(item => {
          const key = normalizeKey(item.name);
          const isChecked = checkedKeys.has(key);
          return `
            <div class="list-item ${isChecked ? 'checked' : ''}" data-key="${key}">
              <div class="check ${isChecked ? 'on' : ''}">${isChecked ? '✓' : ''}</div>
              <div class="item-info">
                <div class="item-name ${isChecked ? 'struck' : ''}">${escHtml(item.name)}</div>
                ${item.notes ? `<div class="item-notes">${escHtml(item.notes)}</div>` : ''}
              </div>
              <div class="item-right">
                ${item.amount > 0
                  ? `<span class="item-amount">${item.amount % 1 === 0 ? item.amount : item.amount.toFixed(1)} ${item.unit}</span>`
                  : ''}
                <div style="display:flex;gap:3px">
                  ${item.sources.includes('cookidoo') ? '<span class="tag tag-c">C</span>' : ''}
                  ${item.sources.includes('bring') ? '<span class="tag tag-b">B</span>' : ''}
                </div>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `).join('');

  // Add click handlers for checking items
  listContainer.querySelectorAll('.list-item').forEach(el => {
    el.addEventListener('click', () => {
      const key = el.dataset.key;
      if (checkedKeys.has(key)) checkedKeys.delete(key);
      else checkedKeys.add(key);
      renderResults();
    });
  });
}

// ─── Search ──────────────────────────────────────────────────
searchInput.addEventListener('input', (e) => {
  searchTerm = e.target.value;
  renderList();
});

// ─── Copy ────────────────────────────────────────────────────
btnCopy.addEventListener('click', () => {
  const lines = consolidated
    .filter(i => !checkedKeys.has(normalizeKey(i.name)))
    .map(i => `${i.name}${i.amount ? ' ' + i.amount : ''}${i.unit ? ' ' + i.unit : ''}`);
  navigator.clipboard.writeText(lines.join('\n'));
  btnCopy.textContent = '✅ Kopiert!';
  setTimeout(() => { btnCopy.textContent = '📋 Kopieren'; }, 2000);
});
