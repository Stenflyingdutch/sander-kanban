/**
 * Cookidoo Rezept-Finder - Popup Script v3
 * 
 * The popup orchestrates everything:
 * 1. Navigate tab to search pages via chrome.tabs.update()
 * 2. Wait for page load, inject content script
 * 3. Ask content script to scrape tiles
 * 4. Collect results across multiple searches
 * 5. Filter, categorize, balance, display
 */

document.addEventListener('DOMContentLoaded', () => {
  // DOM
  const statusEl = document.getElementById('status');
  const statusText = statusEl.querySelector('.status-text');
  const notCookidooEl = document.getElementById('not-cookidoo');
  const searchSection = document.getElementById('search-section');
  const btnSearch = document.getElementById('btn-search');
  const btnLoadCurrentIngredients = document.getElementById('btn-load-current-ingredients');
  const progressEl = document.getElementById('progress');
  const progressFill = document.getElementById('progress-fill');
  const progressTextEl = document.getElementById('progress-text');
  const resultsEl = document.getElementById('results');
  const recipeList = document.getElementById('recipe-list');
  const btnSelectAll = document.getElementById('btn-select-all');
  const btnDeselectAll = document.getElementById('btn-deselect-all');
  const btnRefresh = document.getElementById('btn-refresh');
  const btnAddToList = document.getElementById('btn-add-to-list');
  const selectedCountEl = document.getElementById('selected-count');
  const addingProgressEl = document.getElementById('adding-progress');
  const addingText = document.getElementById('adding-text');
  const ingredientReviewEl = document.getElementById('ingredient-review');
  const ingredientCategoryList = document.getElementById('ingredient-category-list');
  const ingredientSelectedCountEl = document.getElementById('ingredient-selected-count');
  const btnIngredientsReload = document.getElementById('btn-ingredients-reload');
  const btnIngredientsClear = document.getElementById('btn-ingredients-clear');
  const btnIngredientsSelectAll = document.getElementById('btn-ingredients-select-all');
  const btnIngredientsDeselectAll = document.getElementById('btn-ingredients-deselect-all');
  const btnSendSelectedToBring = document.getElementById('btn-send-selected-to-bring');
  const btnIngredientBack = document.getElementById('btn-ingredient-back');
  const doneEl = document.getElementById('done');
  const doneTextEl = document.getElementById('done-text');
  const btnDoneSendToBring = document.getElementById('btn-done-send-to-bring');
  const btnOpenList = document.getElementById('btn-open-list');
  const btnRestart = document.getElementById('btn-restart');
  const noResultsEl = document.getElementById('no-results');
  const btnRetry = document.getElementById('btn-retry');
  const fallbackInfoEl = document.getElementById('fallback-info');
  const fallbackLinks = document.getElementById('fallback-links');
  const POPUP_STATE_KEY = 'popupStateV1';

  let currentTabId = null;
  let foundRecipes = [];
  let selectedRecipeIds = new Set();
  let previouslyShownIds = new Set();
  let pendingBringIngredients = [];
  let selectedBringIngredientIds = new Set();
  let currentView = 'search';
  let searchStatusPoller = null;
  let doneCanSendToBring = false;

  // ─── Search config ─────────────────────────────────────────
  const SEARCH_QUERIES = {
    haehnchen: ['Hähnchen', 'Huhn', 'Chicken', 'Hähnchenbrust', 'Hähnchenschenkel'],
    rindfleisch: ['Rindfleisch', 'Rind', 'Beef', 'Rinderfilet', 'Rindergeschnetzeltes'],
    hackfleisch: ['Hackfleisch', 'Hack', 'Bolognese', 'Frikadellen', 'Hackbällchen'],
    fisch: ['Lachs', 'Fisch', 'Kabeljau', 'Forelle', 'Thunfisch', 'Dorade', 'Zander'],
    vegetarisch: ['vegetarisch', 'Gemüse', 'Risotto', 'Linsen', 'Tofu', 'Couscous', 'Kürbis']
  };
  const TARGET_RESULTS_PER_GROUP = 10;

  const MAX_TIME = 45;
  const MIN_RATING = 4.0;
  const INGREDIENT_CATEGORIES = {
    '🥦 Gemüse': ['zwiebel','tomate','paprika','gurke','zucchini','brokkoli','karotte','möhre','spinat','salat','lauch','sellerie','pilz','champignon','aubergine','blumenkohl','kartoffel','süßkartoffel','knoblauch','ingwer','avocado','mais','erbse','bohne','kürbis','radieschen','kohlrabi','fenchel','rucola','mangold','kohl','rotkohl','weißkohl','frühlingszwiebel'],
    '🍎 Obst': ['apfel','birne','banane','orange','zitrone','limette','beere','erdbeere','himbeere','blaubeere','traube','kiwi','ananas','pfirsich','pflaume','melone','kirsche','mandarine','grapefruit','mango'],
    '🥩 Fleisch & Fisch': ['hähnchen','huhn','rind','schwein','hack','lamm','pute','schnitzel','wurst','schinken','speck','lachs','fisch','garnele','thunfisch','filet','steak','braten','chicken','salami','bacon'],
    '🧀 Milch & Eier': ['milch','käse','sahne','joghurt','butter','quark','schmand','frischkäse','parmesan','mozzarella','gouda','creme fraiche','mascarpone','ricotta','ei ','eier','creme'],
    '🍞 Backwaren': ['brot','brötchen','mehl','toast','semmel','ciabatta','tortilla','wrap','croissant','hefe','bagel'],
    '🫙 Vorräte': ['reis','nudel','pasta','spaghetti','penne','öl','olivenöl','essig','zucker','salz','pfeffer','dose','senf','ketchup','sojasauce','brühe','tomatenmark','passata','kokosmilch','linse','kichererbse','couscous','bulgur','nuss','mandel','honig','marmelade','müsli','haferflocke'],
    '🌿 Gewürze': ['basilikum','petersilie','schnittlauch','dill','rosmarin','thymian','oregano','koriander','minze','curry','paprikapulver','zimt','muskat','kreuzkümmel','chili','kurkuma','lorbeer'],
    '🧃 Getränke': ['wasser','saft','limonade','cola','bier','wein','tee','kaffee']
  };

  function randomPick(arr, n) {
    return [...arr].sort(() => Math.random() - 0.5).slice(0, n);
  }

  function shuffle(arr) {
    return [...arr].sort(() => Math.random() - 0.5);
  }

  function sampleRecipes(recipes, count, excludedIds = new Set()) {
    return shuffle(recipes.filter(recipe => !excludedIds.has(recipe.id))).slice(0, count);
  }

  function stopSearchPolling() {
    if (searchStatusPoller) {
      clearInterval(searchStatusPoller);
      searchStatusPoller = null;
    }
  }

  function startSearchPolling() {
    stopSearchPolling();
    searchStatusPoller = setInterval(syncSearchStatus, 1000);
  }

  function parseAmountValue(amountText) {
    if (!amountText) return 0;
    const fractionMap = {
      '¼': 0.25,
      '½': 0.5,
      '¾': 0.75,
      '⅓': 1 / 3,
      '⅔': 2 / 3,
      '⅛': 0.125,
      '⅜': 0.375,
      '⅝': 0.625,
      '⅞': 0.875
    };

    const normalized = String(amountText).trim().replace(',', '.');
    if (fractionMap[normalized] != null) return fractionMap[normalized];

    if (/^\d+\s+[¼½¾⅓⅔⅛⅜⅝⅞]$/.test(normalized)) {
      const [whole, fraction] = normalized.split(/\s+/);
      return parseInt(whole, 10) + (fractionMap[fraction] || 0);
    }

    if (/^\d+\/\d+$/.test(normalized)) {
      const [num, den] = normalized.split('/');
      return parseInt(num, 10) / parseInt(den, 10);
    }

    return parseFloat(normalized);
  }

  function parseIngredient(raw) {
    const text = (raw || '').trim().replace(/\s+/g, ' ');
    const m = text.match(
      /^(.+?)\s+((?:\d+[\d.,]*|\d+\s+[¼½¾⅓⅔⅛⅜⅝⅞]|[¼½¾⅓⅔⅛⅜⅝⅞]|\d+\/\d+)(?:\s*-\s*(?:\d+[\d.,]*|\d+\s+[¼½¾⅓⅔⅛⅜⅝⅞]|[¼½¾⅓⅔⅛⅜⅝⅞]|\d+\/\d+))?)\s*(kg|g|ml|l|EL|TL|Stk\.?|Stück|Dose[n]?|Bund|Scheibe[n]?|Prise[n]?|Pck\.?|Packung|Becher|Glas|Zehe[n]?)?$/i
    );
    if (m) {
      return {
        name: m[1].trim(),
        amount: m[2],
        unit: m[3] || '',
        raw: text
      };
    }
    return { name: text, amount: '', unit: '', raw: text };
  }

  function normalizeIngredientUnit(unit) {
    const normalized = (unit || '').toLowerCase().replace(/\.$/, '');
    const unitMap = {
      stk: 'Stk',
      stueck: 'Stk',
      stück: 'Stk',
      dose: 'Dose',
      dosen: 'Dose',
      zehe: 'Zehe',
      zehen: 'Zehe',
      scheibe: 'Scheibe',
      scheiben: 'Scheibe',
      prise: 'Prise',
      prisen: 'Prise',
      pck: 'Pck',
      packung: 'Pck',
      becher: 'Becher',
      glas: 'Glas',
      bund: 'Bund',
      el: 'EL',
      tl: 'TL',
      g: 'g',
      kg: 'kg',
      ml: 'ml',
      l: 'l'
    };
    return unitMap[normalized] || unit || '';
  }

  function normalizeIngredientName(name) {
    return (name || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\([^)]*\)/g, ' ')
      .replace(/\b(frisch|frische|gehackt|gewuerfelt|gewürfelt|klein|gross|groß|fein|optional)\b/g, ' ')
      .replace(/[%,]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/\bzwiebeln\b/g, 'zwiebel')
      .replace(/\bknoblauchzehen\b/g, 'knoblauchzehe')
      .replace(/\bkarotten\b/g, 'karotte')
      .replace(/\btomaten\b/g, 'tomate')
      .replace(/\bkartoffeln\b/g, 'kartoffel')
      .replace(/\bpaprikaschoten\b/g, 'paprika');
  }

  function formatIngredientAmount(amount, unit) {
    if (!amount) return '';
    const rounded = Math.round((amount + Number.EPSILON) * 100) / 100;
    const amountText = Number.isInteger(rounded) ? String(rounded) : String(rounded).replace('.', ',');
    return unit ? `${amountText} ${unit}` : amountText;
  }

  function buildIngredientLabel(item) {
    const amountText = formatIngredientAmount(item.amount, item.unit);
    return amountText ? `${item.name} ${amountText}` : item.name;
  }

  function buildBringSearchName(name) {
    return String(name || '')
      .replace(/\([^)]*\)/g, ' ')
      .replace(/,\s*(frisch|frische|ohne.*|mit.*|granuliert|gemahlen|gehackt|gewürfelt).*$/i, '')
      .replace(/\bfilets?\b/gi, '')
      .replace(/\boberschenkel\b/gi, 'Hähnchen')
      .replace(/\bknoblauch,\s*granuliert\b/gi, 'Knoblauch')
      .replace(/\bingwer,\s*frisch\b/gi, 'Ingwer')
      .replace(/\bkabeljaufilets?\b/gi, 'Kabeljau')
      .replace(/\bhähnchen-oberschenkel\b/gi, 'Hähnchen')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function buildIngredientIdentity(item) {
    return `${item.normalizedName || normalizeIngredientName(item.name)}__${item.unit || ''}__${item.amount || 0}`;
  }

  function categorizeIngredient(name) {
    const lower = (name || '').toLowerCase();
    for (const [category, words] of Object.entries(INGREDIENT_CATEGORIES)) {
      if (words.some(word => lower.includes(word))) return category;
    }
    return '📦 Sonstiges';
  }

  function prepareIngredients(items) {
    const merged = new Map();
    const seenSourceItems = new Set();
    const uniqueItems = items
      .map(item => String(item || '').trim().replace(/\s+/g, ' '))
      .filter(Boolean)
      .filter(item => {
        const parsed = parseIngredient(item);
        const normalizedUnit = normalizeIngredientUnit(parsed.unit);
        const normalizedName = normalizeIngredientName(parsed.name || item);
        const normalizedAmount = parsed.amount ? parseAmountValue(parsed.amount) : 0;
        const identity = `${normalizedName}__${normalizedUnit}__${normalizedAmount}`;
        if (seenSourceItems.has(identity)) return false;
        seenSourceItems.add(identity);
        return true;
      });

    uniqueItems.forEach((raw, index) => {
        const parsed = parseIngredient(raw);
        const originalName = parsed.name || raw;
        if (!raw || !originalName) return;

        const unit = normalizeIngredientUnit(parsed.unit);
        const amount = parsed.amount ? parseAmountValue(parsed.amount) : 0;
        const normalizedName = normalizeIngredientName(originalName);
        const key = `${normalizedName}__${unit || 'none'}`;

        if (!merged.has(key)) {
          merged.set(key, {
            id: `ingredient-${index}`,
            name: originalName,
            normalizedName,
            amount: Number.isFinite(amount) ? amount : 0,
            unit,
            rawVariants: [String(raw).trim()],
            category: categorizeIngredient(originalName)
          });
          return;
        }

        const existing = merged.get(key);
        if (amount > 0 && existing.amount >= 0) {
          existing.amount += amount;
        }
        existing.rawVariants.push(String(raw).trim());
        if (originalName.length < existing.name.length) {
          existing.name = originalName;
        }
      });

    return [...merged.values()]
      .map(item => ({
        ...item,
        raw: buildIngredientLabel(item),
        details: [...new Set(item.rawVariants)].join(' · ')
      }))
      .filter(item => item.name);
  }

  async function saveState(overrides = {}) {
    const state = {
      view: currentView,
      foundRecipes,
      selectedRecipeIds: [...selectedRecipeIds],
      previouslyShownIds: [...previouslyShownIds],
      pendingBringIngredients,
      selectedBringIngredientIds: [...selectedBringIngredientIds],
      doneText: doneTextEl.textContent || '',
      doneCanSendToBring,
      fallbackHtml: fallbackLinks.innerHTML || '',
      ...overrides
    };
    await chrome.storage.local.set({ [POPUP_STATE_KEY]: state });
  }

  async function clearState() {
    await chrome.storage.local.remove(POPUP_STATE_KEY);
  }

  async function restoreState() {
    const stored = await chrome.storage.local.get(POPUP_STATE_KEY);
    const state = stored?.[POPUP_STATE_KEY];
    if (!state) return false;

    foundRecipes = Array.isArray(state.foundRecipes) ? state.foundRecipes : [];
    selectedRecipeIds = new Set(Array.isArray(state.selectedRecipeIds) ? state.selectedRecipeIds : []);
    previouslyShownIds = new Set(Array.isArray(state.previouslyShownIds) ? state.previouslyShownIds : []);
    pendingBringIngredients = Array.isArray(state.pendingBringIngredients) ? state.pendingBringIngredients : [];
    selectedBringIngredientIds = new Set(Array.isArray(state.selectedBringIngredientIds) ? state.selectedBringIngredientIds : []);
    currentView = state.view || 'search';
    doneCanSendToBring = Boolean(state.doneCanSendToBring);

    if (currentView === 'results' && foundRecipes.length > 0) {
      showResults(foundRecipes, { preserveSelection: true, persist: false });
      return true;
    }

    if (currentView === 'ingredient-review' && pendingBringIngredients.length > 0) {
      renderIngredientReview(false);
      return true;
    }

    if (currentView === 'done' && state.doneText) {
      hideAll();
      doneEl.classList.remove('hidden');
      doneTextEl.textContent = state.doneText;
      btnDoneSendToBring.classList.toggle('hidden', !doneCanSendToBring);
      fallbackLinks.innerHTML = state.fallbackHtml || '';
      if (state.fallbackHtml) fallbackInfoEl.classList.remove('hidden');
      return true;
    }

    currentView = 'search';
    return false;
  }

  // ─── Init ──────────────────────────────────────────────────
  checkConnection();

  async function checkConnection() {
    showStatus('Prüfe Verbindung zu Cookidoo...');
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tab = tabs[0];
      if (!tab?.url?.match(/cookidoo\.(de|vorwerk\.de)/)) {
        hideAll();
        notCookidooEl.classList.remove('hidden');
        return;
      }
      currentTabId = tab.id;
      await injectContentScript();
      hideStatus();
      const restored = await restoreState();
      const searchResp = await chrome.runtime.sendMessage({ action: 'getRecipeSearchStatus' });
      if (searchResp?.state?.status === 'running') {
        currentView = 'progress';
        hideAll();
        progressEl.classList.remove('hidden');
        updateProgress(searchResp.state.step || 0, searchResp.state.total || 1, searchResp.state.message || 'Suche läuft...');
        startSearchPolling();
      } else if (!restored) {
        currentView = 'search';
        searchSection.classList.remove('hidden');
      }
    } catch (err) {
      showStatus('❌ Verbindungsfehler: ' + err.message);
    }
  }

  // ─── Inject content script into tab ────────────────────────
  async function injectContentScript() {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: currentTabId },
        files: ['content.js']
      });
    } catch (e) {
      console.warn('Inject failed:', e);
    }
  }

  // ─── Send message to content script ────────────────────────
  function sendToContent(msg, retries = 2) {
    return new Promise(async (resolve, reject) => {
      const attempt = (n) => {
        chrome.tabs.sendMessage(currentTabId, msg, (resp) => {
          if (chrome.runtime.lastError) {
            if (n > 0) {
              // Re-inject and retry
              injectContentScript().then(() => {
                setTimeout(() => attempt(n - 1), 500);
              });
            } else {
              reject(new Error(chrome.runtime.lastError.message));
            }
          } else {
            resolve(resp);
          }
        });
      };
      attempt(retries);
    });
  }

  function sendMessageToTab(tabId, msg, retries = 2) {
    return new Promise((resolve, reject) => {
      const attempt = (n) => {
        chrome.tabs.sendMessage(tabId, msg, (resp) => {
          if (chrome.runtime.lastError) {
            if (n > 0) {
              setTimeout(() => attempt(n - 1), 500);
            } else {
              reject(new Error(chrome.runtime.lastError.message));
            }
          } else {
            resolve(resp);
          }
        });
      };
      attempt(retries);
    });
  }

  // ─── Navigate tab and wait for load ────────────────────────
  function navigateTab(url) {
    return new Promise((resolve) => {
      chrome.tabs.update(currentTabId, { url }, () => {
        // Wait for tab to finish loading
        const listener = (tabId, info) => {
          if (tabId === currentTabId && info.status === 'complete') {
            chrome.tabs.onUpdated.removeListener(listener);
            // Extra delay for SPA rendering
            setTimeout(resolve, 3000);
          }
        };
        chrome.tabs.onUpdated.addListener(listener);

        // Timeout safety
        setTimeout(() => {
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }, 15000);
      });
    });
  }

  // ─── Categorize recipe ─────────────────────────────────────
  function categorize(r) {
    const t = r.title.toLowerCase();
    const g = (r.gaCategory || '').toLowerCase();

    if (['hähnchen','huhn','chicken'].some(w => t.includes(w))) {
      r.category = 'haehnchen'; r.categoryLabel = '🍗 Hähnchen';
    } else if (['rind','rindfleisch','beef','rinder'].some(w => t.includes(w))) {
      r.category = 'rindfleisch'; r.categoryLabel = '🥩 Rindfleisch';
    } else if (['hack','hackfleisch','bolognese','frikadellen','hackbällchen'].some(w => t.includes(w))) {
      r.category = 'hackfleisch'; r.categoryLabel = '🍝 Hackfleisch';
    } else if (['fisch','lachs','garnelen','kabeljau','forelle','thunfisch','dorade','zander'].some(w => t.includes(w))) {
      r.category = 'fisch'; r.categoryLabel = '🐟 Fisch';
    } else if (g.includes('veggie') || g.includes('vegan') || t.includes('vegetarisch') || t.includes('vegan')) {
      r.category = 'vegetarisch'; r.categoryLabel = '🥬 Vegetarisch';
    } else {
      r.category = 'vegetarisch'; r.categoryLabel = '🥬 Vegetarisch';
    }
  }

  // ─── Main search flow ──────────────────────────────────────
  btnSearch.addEventListener('click', startSearch);
  btnLoadCurrentIngredients?.addEventListener('click', loadCurrentShoppingIngredients);
  btnRetry?.addEventListener('click', startSearch);
  btnRefresh?.addEventListener('click', startSearch);

  async function startSearch() {
    hideAll();
    currentView = 'progress';
    progressEl.classList.remove('hidden');
    progressFill.style.width = '0%';
    progressTextEl.textContent = 'Starte Suche...';
    await clearState();
    await chrome.runtime.sendMessage({
      action: 'startRecipeSearch',
      tabId: currentTabId,
      previouslyShownIds: [...previouslyShownIds]
    });
    startSearchPolling();
  }

  async function syncSearchStatus() {
    try {
      const resp = await chrome.runtime.sendMessage({ action: 'getRecipeSearchStatus' });
      const state = resp?.state;
      if (!state) return;

      if (state.status === 'running') {
        hideAll();
        currentView = 'progress';
        progressEl.classList.remove('hidden');
        updateProgress(state.step || 0, state.total || 1, state.message || 'Suche läuft...');
        return;
      }

      if (state.status === 'complete') {
        stopSearchPolling();
        previouslyShownIds = new Set(state.previouslyShownIds || []);
        foundRecipes = state.results || [];
        showResults(foundRecipes);
        await chrome.runtime.sendMessage({ action: 'clearRecipeSearch' });
        return;
      }

      if (state.status === 'no_results') {
        stopSearchPolling();
        hideAll();
        currentView = 'no-results';
        noResultsEl.classList.remove('hidden');
        await chrome.runtime.sendMessage({ action: 'clearRecipeSearch' });
        return;
      }

      if (state.status === 'error') {
        stopSearchPolling();
        showStatus(`❌ ${state.message || state.error || 'Fehler bei der Suche'}`);
        currentView = 'search';
        searchSection.classList.remove('hidden');
        await chrome.runtime.sendMessage({ action: 'clearRecipeSearch' });
      }
    } catch (e) {
      console.warn('Search status sync failed:', e);
    }
  }

  async function loadCurrentShoppingIngredients() {
    hideAll();
    currentView = 'progress';
    addingProgressEl.classList.remove('hidden');
    addingText.textContent = 'Lese aktuelle Zutaten aus der Cookidoo-Einkaufsliste...';

    try {
      const tab = await chrome.tabs.get(currentTabId);
      if (!tab?.url?.includes('/shopping/')) {
        await navigateTab('https://cookidoo.de/shopping/de-DE/list');
      }

      await injectContentScript();
      await new Promise(r => setTimeout(r, 1200));

      const resp = await sendToContent({ action: 'scrapeShoppingList' });
      const ingredients = resp?.items || [];

      if (ingredients.length === 0) {
        hideAll();
        currentView = 'done';
        doneEl.classList.remove('hidden');
        doneTextEl.textContent = 'Keine Zutaten gefunden. Bitte prüfe die Cookidoo-Einkaufsliste.';
        await saveState();
        return;
      }

      pendingBringIngredients = prepareIngredients(ingredients);
      selectedBringIngredientIds = new Set(pendingBringIngredients.map(item => item.id));
      renderIngredientReview();
    } catch (e) {
      hideAll();
      currentView = 'done';
      doneEl.classList.remove('hidden');
      doneTextEl.textContent = `Fehler beim Laden der Einkaufsliste: ${e.message}`;
      await saveState();
    }
  }

  function updateProgress(step, total, msg) {
    progressFill.style.width = Math.round((step / total) * 100) + '%';
    progressTextEl.textContent = msg;
  }

  // ─── Show Results ──────────────────────────────────────────
  function showResults(recipes, options = {}) {
    const { preserveSelection = false, persist = true } = options;
    hideAll();
    currentView = 'results';
    resultsEl.classList.remove('hidden');
    recipeList.innerHTML = '';
    if (!preserveSelection) selectedRecipeIds.clear();

    recipes.forEach((recipe) => {
      const card = document.createElement('div');
      card.className = 'recipe-card';
      card.dataset.id = recipe.id;
      const catClass = `cat-${recipe.category}`;

      card.innerHTML = `
        <input type="checkbox" class="recipe-checkbox" data-id="${recipe.id}" ${selectedRecipeIds.has(recipe.id) ? 'checked' : ''} />
        ${recipe.image ? `<img class="recipe-image" src="${recipe.image}" alt="" onerror="this.style.display='none'" />` : ''}
        <div class="recipe-info">
          <div class="recipe-title">
            <a href="${recipe.url}" target="_blank" title="In Cookidoo öffnen">${recipe.title}</a>
          </div>
          <div class="recipe-meta">
            <span>⏱️ ${recipe.timeText || recipe.totalMinutes + ' Min.'}</span>
            <span>⭐ ${recipe.rating.toFixed(1)}</span>
            <span class="recipe-category ${catClass}">${recipe.categoryLabel}</span>
          </div>
        </div>
      `;

      if (selectedRecipeIds.has(recipe.id)) {
        card.classList.add('selected');
      }

      card.addEventListener('click', (e) => {
        if (e.target.closest('a')) return;
        if (e.target.classList.contains('recipe-checkbox')) return;
        const cb = card.querySelector('.recipe-checkbox');
        cb.checked = !cb.checked;
        card.classList.toggle('selected', cb.checked);
        if (cb.checked) selectedRecipeIds.add(recipe.id);
        else selectedRecipeIds.delete(recipe.id);
        updateSelectedCount();
        saveState();
      });

      card.querySelector('.recipe-checkbox').addEventListener('click', (e) => {
        e.stopPropagation();
        const cb = e.target;
        card.classList.toggle('selected', cb.checked);
        if (cb.checked) selectedRecipeIds.add(recipe.id);
        else selectedRecipeIds.delete(recipe.id);
        updateSelectedCount();
        saveState();
      });

      recipeList.appendChild(card);
    });

    updateSelectedCount();
    if (persist) saveState();
  }

  function updateSelectedCount() {
    selectedCountEl.textContent = selectedRecipeIds.size;
    btnAddToList.disabled = selectedRecipeIds.size === 0;
    const btnBring = document.getElementById('btn-add-to-bring');
    if (btnBring) btnBring.disabled = selectedRecipeIds.size === 0;
  }

  function updateIngredientSelectedCount() {
    ingredientSelectedCountEl.textContent = selectedBringIngredientIds.size;
    btnSendSelectedToBring.disabled = selectedBringIngredientIds.size === 0;
  }

  function renderIngredientReview(persist = true) {
    hideAll();
    currentView = 'ingredient-review';
    ingredientReviewEl.classList.remove('hidden');
    ingredientCategoryList.innerHTML = '';

    const grouped = new Map();
    pendingBringIngredients.forEach(item => {
      if (!grouped.has(item.category)) grouped.set(item.category, []);
      grouped.get(item.category).push(item);
    });

    [...grouped.keys()].sort((a, b) => a.localeCompare(b, 'de')).forEach(category => {
      const items = grouped.get(category);
      const groupEl = document.createElement('div');
      groupEl.className = 'ingredient-group';

        const groupHeader = document.createElement('div');
      groupHeader.className = 'ingredient-group-header';
      groupHeader.innerHTML = `
        <div class="ingredient-group-title">
          <span>${category}</span>
          <span class="ingredient-group-count">${items.length}</span>
        </div>
        <div class="ingredient-group-actions">
          <button class="btn btn-tiny btn-group-select" data-category="${category}">Alle</button>
          <button class="btn btn-tiny btn-group-deselect" data-category="${category}">Keine</button>
        </div>
      `;
      groupEl.appendChild(groupHeader);

      groupHeader.querySelector('.btn-group-select')?.addEventListener('click', (e) => {
        e.stopPropagation();
        items.forEach(item => selectedBringIngredientIds.add(item.id));
        renderIngredientReview();
      });

      groupHeader.querySelector('.btn-group-deselect')?.addEventListener('click', (e) => {
        e.stopPropagation();
        items.forEach(item => selectedBringIngredientIds.delete(item.id));
        renderIngredientReview();
      });

      items.forEach(item => {
        const itemEl = document.createElement('label');
        itemEl.className = 'ingredient-item';
        itemEl.dataset.id = item.id;
        const isSelected = selectedBringIngredientIds.has(item.id);
        if (isSelected) itemEl.classList.add('selected');

        itemEl.innerHTML = `
          <input type="checkbox" class="ingredient-checkbox" data-id="${item.id}" ${isSelected ? 'checked' : ''} />
          <div class="ingredient-info">
            <div class="ingredient-name">${item.raw}</div>
            <div class="ingredient-raw">${item.details}</div>
          </div>
        `;

        const checkbox = itemEl.querySelector('.ingredient-checkbox');
        checkbox.addEventListener('click', (e) => {
          e.stopPropagation();
          syncIngredientSelection(item.id, checkbox.checked, itemEl);
        });

        itemEl.addEventListener('click', (e) => {
          if (e.target.classList.contains('ingredient-checkbox')) return;
          checkbox.checked = !checkbox.checked;
          syncIngredientSelection(item.id, checkbox.checked, itemEl);
        });

        groupEl.appendChild(itemEl);
      });

      ingredientCategoryList.appendChild(groupEl);
    });

    updateIngredientSelectedCount();
    if (persist) saveState();
  }

  function syncIngredientSelection(id, checked, itemEl) {
    if (checked) selectedBringIngredientIds.add(id);
    else selectedBringIngredientIds.delete(id);
    itemEl.classList.toggle('selected', checked);
    updateIngredientSelectedCount();
    saveState();
  }

  // ─── Select All / Deselect ─────────────────────────────────
  btnSelectAll.addEventListener('click', () => {
    document.querySelectorAll('.recipe-checkbox').forEach(cb => {
      cb.checked = true;
      cb.closest('.recipe-card').classList.add('selected');
    });
    selectedRecipeIds = new Set(foundRecipes.map(r => r.id));
    updateSelectedCount();
    saveState();
  });

  btnDeselectAll.addEventListener('click', () => {
    document.querySelectorAll('.recipe-checkbox').forEach(cb => {
      cb.checked = false;
      cb.closest('.recipe-card').classList.remove('selected');
    });
    selectedRecipeIds.clear();
    updateSelectedCount();
    saveState();
  });

  // ─── Add to Cookidoo Shopping List ─────────────────────────
  btnAddToList.addEventListener('click', addSelectedToList);

  async function addSelectedToList() {
    if (selectedRecipeIds.size === 0) return;
    hideAll();
    currentView = 'progress';
    addingProgressEl.classList.remove('hidden');

    const ids = [...selectedRecipeIds];
    const results = [];
    const failed = [];

    await injectContentScript();

    for (let i = 0; i < ids.length; i++) {
      const recipeId = ids[i];
      const recipe = foundRecipes.find(r => r.id === recipeId);
      addingText.textContent = `Füge hinzu (${i + 1}/${ids.length}): ${recipe?.title || recipeId}...`;

      try {
        const result = await sendToContent({ action: 'addToShoppingList', recipeId });
        if (result?.success) {
          results.push({ recipeId, success: true });
        } else {
          failed.push({ recipeId, url: recipe?.url, title: recipe?.title });
        }
      } catch (err) {
        failed.push({ recipeId, url: recipe?.url, title: recipe?.title });
      }

      await new Promise(r => setTimeout(r, 400));
    }

    hideAll();
    currentView = 'done';
    doneEl.classList.remove('hidden');
    doneCanSendToBring = results.length > 0;
    btnDoneSendToBring.classList.toggle('hidden', !doneCanSendToBring);

    if (failed.length === 0) {
      doneTextEl.textContent = `${results.length} Rezept${results.length > 1 ? 'e' : ''} zur Cookidoo-Einkaufsliste hinzugefügt!`;
    } else if (results.length > 0) {
      doneTextEl.textContent = `${results.length} hinzugefügt. ${failed.length} manuell:`;
      showFallbackLinks(failed);
    } else {
      doneTextEl.textContent = 'Bitte manuell hinzufügen:';
      showFallbackLinks(failed);
    }
    await saveState();
  }

  // ─── Add to Bring! ─────────────────────────────────────────
  const btnAddToBring = document.getElementById('btn-add-to-bring');
  if (btnAddToBring) btnAddToBring.addEventListener('click', addSelectedToBring);
  btnIngredientsSelectAll?.addEventListener('click', () => {
    selectedBringIngredientIds = new Set(pendingBringIngredients.map(item => item.id));
    renderIngredientReview();
  });
  btnIngredientsReload?.addEventListener('click', loadCurrentShoppingIngredients);
  btnIngredientsClear?.addEventListener('click', async () => {
    pendingBringIngredients = [];
    selectedBringIngredientIds.clear();
    foundRecipes = [];
    selectedRecipeIds.clear();
    previouslyShownIds.clear();
    currentView = 'search';
    hideAll();
    searchSection.classList.remove('hidden');
    await clearState();
  });
  btnIngredientsDeselectAll?.addEventListener('click', () => {
    selectedBringIngredientIds.clear();
    renderIngredientReview();
  });
  btnDoneSendToBring?.addEventListener('click', loadCurrentShoppingIngredients);
  btnIngredientBack?.addEventListener('click', () => {
    showResults(foundRecipes, { preserveSelection: true });
  });
  btnSendSelectedToBring?.addEventListener('click', sendSelectedIngredientsToBring);

  async function addSelectedToBring() {
    if (selectedRecipeIds.size === 0) return;
    hideAll();
    currentView = 'progress';
    addingProgressEl.classList.remove('hidden');

    const ids = [...selectedRecipeIds];

    // Step 1: Add recipes to Cookidoo shopping list first
    addingText.textContent = 'Füge Rezepte zur Cookidoo-Einkaufsliste hinzu...';
    await injectContentScript();

    for (let i = 0; i < ids.length; i++) {
      const recipeId = ids[i];
      try {
        await sendToContent({ action: 'addToShoppingList', recipeId });
      } catch (e) {}
      await new Promise(r => setTimeout(r, 300));
    }

    // Step 2: Navigate to Cookidoo shopping list page to read ingredients
    addingText.textContent = 'Lese Zutaten aus Cookidoo-Einkaufsliste...';
    await navigateTab('https://cookidoo.de/shopping/de-DE/list');
    await injectContentScript();
    await new Promise(r => setTimeout(r, 1500));

    let ingredients = [];
    try {
      const resp = await sendToContent({ action: 'scrapeShoppingList' });
      if (resp?.items) {
        ingredients = resp.items;
      }
    } catch (e) {
      console.warn('Failed to scrape shopping list:', e);
    }

    if (ingredients.length === 0) {
      hideAll();
      currentView = 'done';
      doneEl.classList.remove('hidden');
      doneCanSendToBring = false;
      btnDoneSendToBring.classList.add('hidden');
      doneTextEl.textContent = 'Keine Zutaten gefunden. Bitte prüfe die Cookidoo-Einkaufsliste.';
      await saveState();
      return;
    }

    pendingBringIngredients = prepareIngredients(ingredients);
    selectedBringIngredientIds = new Set(pendingBringIngredients.map(item => item.id));
    renderIngredientReview();
  }

  async function sendSelectedIngredientsToBring() {
    const selectedIngredients = pendingBringIngredients.filter(item => selectedBringIngredientIds.has(item.id));
    if (selectedIngredients.length === 0) return;

    hideAll();
    currentView = 'progress';
    addingProgressEl.classList.remove('hidden');

    // Step 3: Open Bring in a new tab and inject content script
    addingText.textContent = `${selectedIngredients.length} Zutaten ausgewählt. Öffne Bring!...`;

    let bringTabId = null;
    try {
      // Check if Bring is already open
      const tabs = await chrome.tabs.query({ url: 'https://web.getbring.com/*' });
      if (tabs.length > 0) {
        bringTabId = tabs[0].id;
        await chrome.tabs.update(bringTabId, { active: false });
      } else {
        const newTab = await chrome.tabs.create({ url: 'https://web.getbring.com/app/lists', active: false });
        bringTabId = newTab.id;
      }

      // Wait for Bring to load
      await new Promise((resolve) => {
        const listener = (tabId, info) => {
          if (tabId === bringTabId && info.status === 'complete') {
            chrome.tabs.onUpdated.removeListener(listener);
            setTimeout(resolve, 3000);
          }
        };
        chrome.tabs.onUpdated.addListener(listener);
        setTimeout(() => {
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }, 15000);
      });

      // Inject Bring content script
      await chrome.scripting.executeScript({
        target: { tabId: bringTabId },
        files: ['bring_content.js']
      });
      await new Promise(r => setTimeout(r, 1000));

      const items = selectedIngredients.map(item => ({
        name: item.name,
        searchName: buildBringSearchName(item.name),
        detail: formatIngredientAmount(item.amount, item.unit)
      }));
      addingText.textContent = `Übertrage ${items.length} Zutaten an Bring...`;

      const response = await sendMessageToTab(bringTabId, { action: 'addItemsToBring', items });
      if (!response?.success) {
        throw new Error(response?.error || 'Bring-Übertragung fehlgeschlagen');
      }

      const failedItems = Array.isArray(response.results)
        ? response.results.filter(result => !result?.success)
        : [];

      await chrome.tabs.update(bringTabId, { active: true });

      if (failedItems.length > 0) {
        hideAll();
        currentView = 'done';
        doneEl.classList.remove('hidden');
        doneCanSendToBring = false;
        btnDoneSendToBring.classList.add('hidden');
        doneTextEl.textContent = `${items.length - failedItems.length} von ${items.length} Zutaten wurden an Bring! übertragen.`;
        fallbackInfoEl.classList.remove('hidden');
        fallbackLinks.innerHTML = failedItems
          .map(result => {
            const failedName = result?.item?.name || 'Unbekannte Zutat';
            const reason = result?.error || result?.detail?.error || result?.activation?.error || 'Übertragung fehlgeschlagen';
            return `<div>${failedName}: ${reason}</div>`;
          })
          .join('');
        await saveState();
        return;
      }

      pendingBringIngredients = [];
      selectedBringIngredientIds.clear();
      doneCanSendToBring = false;
      await clearState();
      window.close();

    } catch (e) {
      hideAll();
      currentView = 'done';
      doneEl.classList.remove('hidden');
      doneCanSendToBring = false;
      btnDoneSendToBring.classList.add('hidden');
      doneTextEl.textContent = `Fehler: ${e.message}. Bitte öffne web.getbring.com und versuche es erneut.`;
      await saveState();
    }
  }

  function showFallbackLinks(recipes) {
    fallbackInfoEl.classList.remove('hidden');
    fallbackLinks.innerHTML = recipes.map(r =>
      `<a href="${r.url}" target="_blank">📖 ${r.title || r.recipeId}</a>`
    ).join('');
  }

  // ─── Open Shopping List ────────────────────────────────────
  btnOpenList.addEventListener('click', () => {
    chrome.tabs.update(currentTabId, { url: 'https://cookidoo.de/shopping/de-DE/list' });
    window.close();
  });

  btnRestart.addEventListener('click', () => {
    stopSearchPolling();
    hideAll();
    currentView = 'search';
    doneCanSendToBring = false;
    btnDoneSendToBring.classList.add('hidden');
    searchSection.classList.remove('hidden');
    clearState();
  });

  // ─── Helpers ───────────────────────────────────────────────
  function hideAll() {
    [statusEl, notCookidooEl, searchSection, progressEl, resultsEl,
     ingredientReviewEl,
     addingProgressEl, doneEl, noResultsEl, fallbackInfoEl].forEach(el => {
      el.classList.add('hidden');
    });
  }

  function showStatus(text) {
    statusEl.classList.remove('hidden');
    statusText.textContent = text;
  }

  function hideStatus() {
    statusEl.classList.add('hidden');
  }

  window.addEventListener('beforeunload', () => {
    if (currentView === 'results' || currentView === 'ingredient-review' || currentView === 'done') {
      saveState();
    }
  });
});
