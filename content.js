/**
 * Cookidoo Recipe Finder - Content Script v3
 * 
 * Simple job: scrape tiles from whatever page it's on.
 * Navigation is handled by popup.js via chrome.tabs.update().
 * After each navigation, popup re-injects this script and asks to scrape.
 */

(() => {
  // ─── Helpers ────────────────────────────────────────────────
  function parseTileText(text) {
    if (!text) return null;
    const m = text.match(/^(.+?)(\d\.\d)\(([^)]+)\)(.+)$/);
    if (!m) return null;
    const title = m[1].trim();
    const rating = parseFloat(m[2]);
    const rcRaw = m[3].trim();
    const timeStr = m[4].trim();

    let reviewCount = 0;
    const km = rcRaw.match(/([\d.,]+)\s*K/i);
    if (km) reviewCount = Math.round(parseFloat(km[1].replace(',', '.')) * 1000);
    else reviewCount = parseInt(rcRaw.replace(/\D/g, '')) || 0;

    let mins = 0;
    const hm = timeStr.match(/(\d+)\s*Std/i);
    const mm = timeStr.match(/(\d+)\s*Min/i);
    if (hm) mins += parseInt(hm[1]) * 60;
    if (mm) mins += parseInt(mm[1]);
    if (!mins && !hm && !mm) mins = Infinity;

    return { title, rating, reviewCount, totalMinutes: mins, timeStr };
  }

  function scrapeTiles() {
    const recipes = [];
    document.querySelectorAll('a.link--alt[href*="/recipes/recipe/de-DE/"]').forEach(link => {
      try {
        const href = link.getAttribute('href');
        const idM = href.match(/recipe\/de-DE\/(r\d+)/);
        if (!idM) return;
        const fullText = link.textContent.trim().replace(/\s+/g, ' ');
        const parsed = parseTileText(fullText);
        if (!parsed) return;
        const img = link.querySelector('img');
        recipes.push({
          id: idM[1],
          title: parsed.title || img?.alt || '',
          url: `https://cookidoo.de${href}`,
          rating: parsed.rating,
          reviewCount: parsed.reviewCount,
          totalMinutes: parsed.totalMinutes,
          timeText: parsed.timeStr,
          image: img?.src || '',
          gaCategory: link.getAttribute('data-ga-event-category') || ''
        });
      } catch (e) {}
    });
    return recipes;
  }

  function addToShoppingList(recipeId) {
    return new Promise((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', 'https://cookidoo.de/shopping/de-DE/add-recipes', true);
      xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.withCredentials = true;
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve({ success: true, method: 'api' });
        } else {
          resolve({ success: false, error: `HTTP ${xhr.status}`, fallback: 'navigate',
            url: `https://cookidoo.de/recipes/recipe/de-DE/${recipeId}` });
        }
      };
      xhr.onerror = () => resolve({ success: false, fallback: 'navigate',
        url: `https://cookidoo.de/recipes/recipe/de-DE/${recipeId}` });
      xhr.send(JSON.stringify({ recipeIDs: [recipeId] }));
    });
  }

  function isElementVisible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
      return false;
    }
    if (el.getAttribute('aria-hidden') === 'true') return false;
    return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  }

  // ─── Message listener ───────────────────────────────────────
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'ping') {
      sendResponse({ alive: true, page: 'cookidoo' });
      return true;
    }

    if (message.action === 'scrapePage') {
      const recipes = scrapeTiles();
      sendResponse({ success: true, recipes });
      return true;
    }

    if (message.action === 'scrapeShoppingList') {
      const items = [];
      const seen = new Set();
      // Ingredients are in elements with class "pm-check-group__list-item"
      document.querySelectorAll('.pm-check-group__list-item').forEach(el => {
        if (!isElementVisible(el)) return;
        const text = (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ');
        if (text.length > 0 && !seen.has(text)) {
          seen.add(text);
          items.push(text);
        }
      });
      sendResponse({ success: true, items });
      return true;
    }

    if (message.action === 'addToShoppingList') {
      addToShoppingList(message.recipeId)
        .then(r => sendResponse(r))
        .catch(e => sendResponse({ success: false, error: e.message }));
      return true;
    }

    if (message.action === 'addMultipleToShoppingList') {
      (async () => {
        const results = [];
        for (const id of message.recipeIds) {
          results.push({ recipeId: id, ...(await addToShoppingList(id)) });
          await new Promise(r => setTimeout(r, 600));
        }
        sendResponse({ success: true, results });
      })();
      return true;
    }
  });
})();
