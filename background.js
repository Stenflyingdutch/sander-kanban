// Background service worker

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

let searchState = {
  status: 'idle',
  step: 0,
  total: 0,
  message: '',
  results: [],
  previouslyShownIds: [],
  error: ''
};

function shuffle(arr) {
  return [...arr].sort(() => Math.random() - 0.5);
}

function sampleRecipes(recipes, count, excludedIds = new Set()) {
  return shuffle(recipes.filter(recipe => !excludedIds.has(recipe.id))).slice(0, count);
}

function categorizeRecipe(recipe) {
  const t = (recipe.title || '').toLowerCase();
  const g = (recipe.gaCategory || '').toLowerCase();

  if (['hähnchen', 'huhn', 'chicken'].some(w => t.includes(w))) {
    recipe.category = 'haehnchen';
    recipe.categoryLabel = '🍗 Hähnchen';
  } else if (['rind', 'rindfleisch', 'beef', 'rinder'].some(w => t.includes(w))) {
    recipe.category = 'rindfleisch';
    recipe.categoryLabel = '🥩 Rindfleisch';
  } else if (['hack', 'hackfleisch', 'bolognese', 'frikadellen', 'hackbällchen'].some(w => t.includes(w))) {
    recipe.category = 'hackfleisch';
    recipe.categoryLabel = '🍝 Hackfleisch';
  } else if (['fisch', 'lachs', 'garnelen', 'kabeljau', 'forelle', 'thunfisch', 'dorade', 'zander'].some(w => t.includes(w))) {
    recipe.category = 'fisch';
    recipe.categoryLabel = '🐟 Fisch';
  } else if (g.includes('veggie') || g.includes('vegan') || t.includes('vegetarisch') || t.includes('vegan')) {
    recipe.category = 'vegetarisch';
    recipe.categoryLabel = '🥬 Vegetarisch';
  } else {
    recipe.category = 'vegetarisch';
    recipe.categoryLabel = '🥬 Vegetarisch';
  }
}

async function injectContentScript(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js']
    });
  } catch (e) {
    console.warn('Inject failed:', e);
  }
}

function sendToContent(tabId, msg, retries = 2) {
  return new Promise((resolve, reject) => {
    const attempt = (n) => {
      chrome.tabs.sendMessage(tabId, msg, (resp) => {
        if (chrome.runtime.lastError) {
          if (n > 0) {
            injectContentScript(tabId).then(() => {
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

function navigateTab(tabId, url) {
  return new Promise((resolve) => {
    chrome.tabs.update(tabId, { url }, () => {
      const listener = (updatedTabId, info) => {
        if (updatedTabId === tabId && info.status === 'complete') {
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
  });
}

function updateSearchState(patch) {
  searchState = { ...searchState, ...patch };
}

async function runRecipeSearch(tabId, previousIds) {
  const pool = [];
  const previouslyShownIds = new Set(previousIds || []);
  const plan = Object.entries(SEARCH_QUERIES).flatMap(([cat, queries]) =>
    shuffle(queries).map(q => ({ q, cat }))
  );

  updateSearchState({
    status: 'running',
    step: 0,
    total: plan.length,
    message: 'Starte Suche...',
    results: [],
    error: ''
  });

  for (let i = 0; i < plan.length; i++) {
    const { q, cat } = plan[i];
    updateSearchState({
      step: i + 1,
      total: plan.length,
      message: `Suche "${q}"...`
    });

    try {
      const searchUrl = `https://cookidoo.de/search/de-DE?query=${encodeURIComponent(q)}&context=recipes`;
      await navigateTab(tabId, searchUrl);
      await injectContentScript(tabId);
      await new Promise(r => setTimeout(r, 1000));
      const resp = await sendToContent(tabId, { action: 'scrapePage' });

      if (resp?.recipes) {
        resp.recipes.forEach(recipe => {
          categorizeRecipe(recipe);
          if (cat !== 'vegetarisch' && recipe.category === 'vegetarisch') {
            recipe.category = cat;
            recipe.categoryLabel = {
              haehnchen: '🍗 Hähnchen',
              rindfleisch: '🥩 Rindfleisch',
              hackfleisch: '🍝 Hackfleisch',
              fisch: '🐟 Fisch',
              vegetarisch: '🥬 Vegetarisch'
            }[cat];
          }
        });
        pool.push(...resp.recipes);
      }
    } catch (e) {
      console.warn(`Search "${q}" failed:`, e);
    }
  }

  updateSearchState({
    step: plan.length,
    total: plan.length,
    message: 'Ergebnisse werden aufbereitet...'
  });

  try {
    await navigateTab(tabId, 'https://cookidoo.de/foundation/de-DE/for-you');
  } catch (e) {}

  const filtered = pool.filter(r => r.totalMinutes <= MAX_TIME && r.rating >= MIN_RATING);
  const seen = new Set();
  const unique = filtered.filter(r => {
    if (seen.has(r.id)) return false;
    seen.add(r.id);
    return true;
  });

  const groups = {
    haehnchen: [],
    rindfleisch: [],
    hackfleisch: [],
    fisch: [],
    vegetarisch: []
  };
  unique.forEach(r => {
    if (groups[r.category]) groups[r.category].push(r);
  });

  const results = [];
  const selectedIds = new Set();

  Object.keys(groups).forEach(category => {
    const unseen = sampleRecipes(groups[category], TARGET_RESULTS_PER_GROUP, new Set([
      ...selectedIds,
      ...previouslyShownIds
    ]));

    unseen.forEach(recipe => {
      results.push(recipe);
      selectedIds.add(recipe.id);
    });

    if (unseen.length < TARGET_RESULTS_PER_GROUP) {
      const fallback = sampleRecipes(groups[category], TARGET_RESULTS_PER_GROUP - unseen.length, selectedIds);
      fallback.forEach(recipe => {
        results.push(recipe);
        selectedIds.add(recipe.id);
      });
    }
  });

  if (results.length === 0) {
    updateSearchState({
      status: 'no_results',
      message: 'Keine passenden Rezepte gefunden.',
      results: []
    });
    return;
  }

  results.forEach(recipe => previouslyShownIds.add(recipe.id));
  updateSearchState({
    status: 'complete',
    message: 'Suche abgeschlossen.',
    results,
    previouslyShownIds: [...previouslyShownIds]
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'checkCookidoo') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      const isCookidoo = tab?.url?.includes('cookidoo.de') || tab?.url?.includes('cookidoo.vorwerk.de');
      sendResponse({ isCookidoo, tabId: tab?.id });
    });
    return true;
  }

  if (message.action === 'executeOnTab') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tabId = tabs[0]?.id;
      if (tabId) {
        chrome.tabs.sendMessage(tabId, message.data, sendResponse);
      }
    });
    return true;
  }

  if (message.action === 'startRecipeSearch') {
    if (searchState.status === 'running') {
      sendResponse({ ok: true, state: searchState });
      return true;
    }

    updateSearchState({
      status: 'running',
      step: 0,
      total: 0,
      message: 'Starte Suche...',
      results: [],
      previouslyShownIds: message.previouslyShownIds || [],
      error: ''
    });

    runRecipeSearch(message.tabId, message.previouslyShownIds || []).catch(err => {
      updateSearchState({
        status: 'error',
        error: err.message,
        message: `Fehler: ${err.message}`
      });
    });

    sendResponse({ ok: true, state: searchState });
    return true;
  }

  if (message.action === 'getRecipeSearchStatus') {
    sendResponse({ ok: true, state: searchState });
    return true;
  }

  if (message.action === 'clearRecipeSearch') {
    updateSearchState({
      status: 'idle',
      step: 0,
      total: 0,
      message: '',
      results: [],
      previouslyShownIds: [],
      error: ''
    });
    sendResponse({ ok: true });
    return true;
  }
});
