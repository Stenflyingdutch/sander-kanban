/**
 * Bring! Content Script
 * Injected into web.getbring.com
 * Types ingredients into the search bar and adds them to the list.
 */

(() => {
  function delay(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  function getDebugPanel() {
    let panel = document.getElementById('cookidoo-bring-debug');
    if (panel) return panel;

    panel = document.createElement('div');
    panel.id = 'cookidoo-bring-debug';
    panel.style.cssText = [
      'position:fixed',
      'right:12px',
      'bottom:12px',
      'z-index:2147483647',
      'width:320px',
      'max-height:45vh',
      'overflow:auto',
      'padding:10px',
      'background:rgba(15,23,32,0.96)',
      'color:#e8f1f2',
      'font:12px/1.4 monospace',
      'border:1px solid rgba(255,255,255,0.16)',
      'border-radius:10px',
      'box-shadow:0 8px 24px rgba(0,0,0,0.35)'
    ].join(';');
    panel.innerHTML = '<div style="font-weight:700;margin-bottom:6px">Bring Debug</div><div id="cookidoo-bring-debug-lines"></div>';
    document.body.appendChild(panel);
    return panel;
  }

  function debugLog(message) {
    const panel = getDebugPanel();
    const lines = panel.querySelector('#cookidoo-bring-debug-lines');
    const line = document.createElement('div');
    line.textContent = `${new Date().toLocaleTimeString()} ${message}`;
    line.style.marginBottom = '4px';
    lines.prepend(line);
  }

  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;

  function setInputValue(input, value) {
    if (nativeInputValueSetter) {
      nativeInputValueSetter.call(input, value);
    } else {
      input.value = value;
    }
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function normalizeBringItemText(itemText) {
    return String(itemText || '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function normalizeBringItem(item) {
    if (typeof item === 'string') {
      return { name: normalizeBringItemText(item), searchName: normalizeBringItemText(item), detail: '' };
    }
    return {
      name: normalizeBringItemText(item?.name || ''),
      searchName: normalizeBringItemText(item?.searchName || item?.name || ''),
      detail: normalizeBringItemText(item?.detail || '')
    };
  }

  function normalizeLookupText(text) {
    return normalizeBringItemText(text)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[¼]/g, ' 1/4 ')
      .replace(/[½]/g, ' 1/2 ')
      .replace(/[¾]/g, ' 3/4 ')
      .replace(/[⅓]/g, ' 1/3 ')
      .replace(/[⅔]/g, ' 2/3 ')
      .replace(/[⅛]/g, ' 1/8 ')
      .replace(/[⅜]/g, ' 3/8 ')
      .replace(/[⅝]/g, ' 5/8 ')
      .replace(/[⅞]/g, ' 7/8 ')
      .replace(/[.,]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function findBringItemByName(name) {
    const wanted = normalizeLookupText(name);
    if (!wanted) return null;

    const items = [...document.querySelectorAll('bring-list-item')];
    let bestMatch = null;

    for (const item of items) {
      const nameEl = item.querySelector('.bring-list-item-name');
      const itemName = normalizeLookupText(nameEl?.textContent || '');
      if (!itemName) continue;
      if (itemName === wanted || itemName.includes(wanted) || wanted.includes(itemName)) {
        bestMatch = item;
      }
    }

    return bestMatch;
  }

  function getActiveBringItem() {
    return [...document.querySelectorAll('bring-list-item')].find(isBringItemActive) || null;
  }

  function isBringItemActive(item) {
    const content = item?.querySelector('.bring-list-item-content');
    return !!(content && content.classList.contains('selected'));
  }

  function findSearchResultByName(name) {
    const wanted = normalizeLookupText(name);
    if (!wanted) return null;

    const candidates = [
      ...document.querySelectorAll(
        '.bring-list-search-bar-suggestions button, ' +
        '.bring-list-search-bar-suggestions li, ' +
        '[class*="suggestion"] button, ' +
        '[class*="suggestion"] li, ' +
        '[class*="search-result"] button, ' +
        '[class*="search-result"] li'
      )
    ];

    for (const candidate of candidates) {
      const text = normalizeLookupText(candidate.textContent || '');
      if (!text) continue;
      if (text === wanted || text.includes(wanted) || wanted.includes(text)) {
        return candidate;
      }
    }

    return candidates[0] || null;
  }

  function findRecentTileByName(name) {
    const wanted = normalizeLookupText(name);
    if (!wanted) return null;

    const candidates = [
      ...document.querySelectorAll(
        'section *[class*="recent"] button, ' +
        'section *[class*="recent"] li, ' +
        '[class*="recent"] button, ' +
        '[class*="recent"] li, ' +
        '[class*="recently"] button, ' +
        '[class*="recently"] li, ' +
        '[class*="used"] button, ' +
        '[class*="used"] li, ' +
        '[class*="history"] button, ' +
        '[class*="history"] li'
      )
    ];

    for (const candidate of candidates) {
      const text = normalizeLookupText(candidate.textContent || '');
      if (!text) continue;
      if (text === wanted || text.includes(wanted) || wanted.includes(text)) {
        return candidate;
      }
    }

    return null;
  }

  function clickSearchResultAddTarget(searchResult) {
    if (!searchResult) return false;

    const addTarget =
      searchResult.querySelector('button[aria-label*="Add" i]') ||
      searchResult.querySelector('button[aria-label*="Zur Liste" i]') ||
      searchResult.querySelector('button[title*="Add" i]') ||
      searchResult.querySelector('button[title*="Zur Liste" i]') ||
      searchResult.querySelector('[class*="add"] button') ||
      searchResult.querySelector('button[class*="add"]') ||
      searchResult.querySelector('button[class*="plus"]') ||
      searchResult.querySelector('[class*="plus"]') ||
      searchResult.querySelector('svg[class*="plus"]')?.closest('button') ||
      searchResult.querySelector('i[class*="plus"]')?.closest('button');

    (addTarget || searchResult).click();
    debugLog(`search click: ${(searchResult.textContent || '').trim().slice(0, 80)}`);
    return true;
  }

  async function ensureBringItemActive(name) {
    let bringItem = findBringItemByName(name);
    if (bringItem && isBringItemActive(bringItem)) {
      debugLog(`active already: ${name}`);
      return { success: true, method: 'already-active' };
    }

    const searchResult = findSearchResultByName(name);
    if (searchResult) {
      clickSearchResultAddTarget(searchResult);
      await delay(500);
      bringItem = findBringItemByName(name);
      if (bringItem && isBringItemActive(bringItem)) {
        debugLog(`activated via search: ${name}`);
        return { success: true, method: 'search-result-click' };
      }
    }

    const recentTile = findRecentTileByName(name);
    if (recentTile) {
      debugLog(`recent tile found: ${(recentTile.textContent || '').trim().slice(0, 80)}`);
      recentTile.click();
      await delay(600);
      bringItem = findBringItemByName(name);
      if (bringItem && isBringItemActive(bringItem)) {
        debugLog(`activated via recent: ${name}`);
        return { success: true, method: 'recent-tile-click' };
      }
    }

    if (bringItem) {
      const clickable =
        bringItem.querySelector('.bring-list-item-content') ||
        bringItem.querySelector('.bring-list-item-name') ||
        bringItem;
      clickable.click();
      await delay(400);
      if (isBringItemActive(bringItem)) {
        debugLog(`activated via list click: ${name}`);
        return { success: true, method: 'list-item-click' };
      }
    }

    debugLog(`failed to activate: ${name}`);
    return { success: false, error: 'Bring-Item wurde nicht aktiv' };
  }

  async function addDetailsToBringItem(name, detail) {
    if (!detail) return { success: true, method: 'no-detail' };

    let bringItem = getActiveBringItem() || findBringItemByName(name);
    if (!bringItem) {
      debugLog(`detail failed, no item: ${name}`);
      return { success: false, error: 'Bring-Item nicht gefunden' };
    }

    if (!isBringItemActive(bringItem)) {
      const clickable =
        bringItem.querySelector('.bring-list-item-content') ||
        bringItem.querySelector('.bring-list-item-name') ||
        bringItem;
      clickable.click();
      await delay(300);
    }

    const existingSpec =
      bringItem.querySelector('.bring-list-item-specification-label') ||
      bringItem.querySelector('[class*="specification"]') ||
      bringItem.querySelector('[class*="detail"]');
    existingSpec?.click();
    await delay(300);

    const detailInput = document.querySelector(
      '.cdk-overlay-container input[class*="specification"], ' +
      '.cdk-overlay-container textarea[class*="specification"], ' +
      '.cdk-overlay-container input[placeholder*="Menge"], ' +
      '.cdk-overlay-container input[placeholder*="Detail"], ' +
      '.cdk-overlay-container input[placeholder*="Details"], ' +
      '.cdk-overlay-container input[placeholder*="Notiz"], ' +
      '.cdk-overlay-container textarea[placeholder*="Menge"], ' +
      '.cdk-overlay-container textarea[placeholder*="Detail"], ' +
      '.cdk-overlay-container textarea[placeholder*="Notiz"], ' +
      'input[class*="specification"], ' +
      'textarea[class*="specification"], ' +
      'input[placeholder*="Menge"], ' +
      'input[placeholder*="Detail"], ' +
      'input[placeholder*="Details"], ' +
      'input[placeholder*="Notiz"], ' +
      'textarea[placeholder*="Menge"], ' +
      'textarea[placeholder*="Detail"], ' +
      'textarea[placeholder*="Notiz"], ' +
      '[contenteditable="true"]'
    );

    if (!detailInput) {
      debugLog(`detail field missing: ${name}`);
      return { success: false, error: 'Detailfeld nicht gefunden' };
    }

    detailInput.focus();
    detailInput.click();
    await delay(150);

    if ('value' in detailInput) {
      setInputValue(detailInput, detail);
    } else {
      detailInput.textContent = detail;
      detailInput.dispatchEvent(new Event('input', { bubbles: true }));
    }

    detailInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
    detailInput.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
    detailInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', code: 'Tab', keyCode: 9, bubbles: true }));
    detailInput.dispatchEvent(new KeyboardEvent('keyup', { key: 'Tab', code: 'Tab', keyCode: 9, bubbles: true }));
    detailInput.blur?.();
    document.body.click();
    await delay(500);

    bringItem = getActiveBringItem() || findBringItemByName(name);
    const savedSpec = bringItem?.querySelector('.bring-list-item-specification-label');
    const savedText = normalizeBringItemText(savedSpec?.textContent || '');

    return {
      success: !detail || savedText.includes(detail) || savedText === detail,
      method: 'detail',
      savedText
    };
  }

  /**
   * Type text into the Bring search input and submit.
   * Simulates real user input so Angular picks it up.
   */
  async function addItemToBring(item) {
    const normalizedItem = normalizeBringItem(item);
    const normalizedText = normalizedItem.searchName || normalizedItem.name;
    if (!normalizedText) {
      return { success: false, error: 'Leerer Eintrag' };
    }

    const input = document.querySelector('input.bring-list-search-bar-input, input[placeholder*="einkaufen"], input[placeholder*="kaufen"], input[type="text"]');
    if (!input) {
      return { success: false, error: 'Suchfeld nicht gefunden' };
    }

    debugLog(`start: ${normalizedText}${normalizedItem.detail ? ` (${normalizedItem.detail})` : ''}`);

    // Focus the input
    input.focus();
    input.click();
    await delay(200);

    // Clear existing text more reliably so consecutive items do not get concatenated.
    input.select?.();
    setInputValue(input, '');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', code: 'Backspace', bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Backspace', code: 'Backspace', bubbles: true }));
    await delay(250);

    // Type text character by character (Angular needs this)
    for (const char of normalizedText) {
      const nextValue = `${input.value}${char}`;
      setInputValue(input, nextValue);
      input.dispatchEvent(new KeyboardEvent('keydown', { key: char, bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keyup', { key: char, bubbles: true }));
      await delay(25);
    }
    await delay(700);

    // Try to find and click the first suggestion / add button
    // Bring shows suggestions as you type
    const suggestions = document.querySelectorAll(
      '.bring-list-search-bar-suggestions button, ' +
      '.bring-list-search-bar-suggestions li, ' +
      '[class*="suggestion"] button, ' +
      '[class*="suggestion"] li, ' +
      '[class*="search-result"] button, ' +
      '[class*="search-result"] li'
    );

    if (suggestions.length > 0) {
      // Click first suggestion
      const preferredSuggestion = findSearchResultByName(normalizedText) || suggestions[0];
      clickSearchResultAddTarget(preferredSuggestion);
      await delay(600);
      const activationResult = await ensureBringItemActive(normalizedText);
      setInputValue(input, '');
      const detailResult = await addDetailsToBringItem(normalizedItem.name, normalizedItem.detail);
      debugLog(`result: ${normalizedText} | active=${activationResult.success} | detail=${detailResult.success}`);
      return { success: activationResult.success, method: 'suggestion', activation: activationResult, detail: detailResult };
    }

    // Fallback: press Enter to add
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
    // Also try submitting via form
    const form = input.closest('form');
    if (form) {
      form.dispatchEvent(new Event('submit', { bubbles: true }));
    }
    await delay(600);

    // Clear the input after adding
    setInputValue(input, '');

    const activationResult = await ensureBringItemActive(normalizedText);
    const detailResult = await addDetailsToBringItem(normalizedItem.name, normalizedItem.detail);
    debugLog(`result: ${normalizedText} | active=${activationResult.success} | detail=${detailResult.success}`);
    return { success: activationResult.success, method: 'enter', activation: activationResult, detail: detailResult };
  }

  /**
   * Add multiple items one by one.
   */
  async function addMultipleItems(items) {
    const results = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      try {
        const result = await addItemToBring(item);
        results.push({ item, ...result });
      } catch (e) {
        results.push({ item, success: false, error: e.message });
      }
      await delay(900);
    }
    return results;
  }

  // Message listener
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'ping') {
      sendResponse({ alive: true, page: 'bring' });
      return true;
    }

    if (message.action === 'scrapeBringList') {
      const items = [];
      // Only scrape items that are "selected" (red background = active on list)
      document.querySelectorAll('bring-list-item').forEach(el => {
        const content = el.querySelector('.bring-list-item-content');
        // Check if item is selected/active (red background)
        if (!content || !content.classList.contains('selected')) return;

        const nameEl = el.querySelector('.bring-list-item-name');
        const specEl = el.querySelector('.bring-list-item-specification-label');
        if (nameEl) {
          const name = nameEl.textContent.trim();
          // Skip empty spec labels
          const spec = specEl && !specEl.classList.contains('empty') ? specEl.textContent.trim() : '';
          if (name) {
            items.push(spec ? `${name} ${spec}` : name);
          }
        }
      });
      sendResponse({ success: true, items });
      return true;
    }

    if (message.action === 'addItemToBring') {
      addItemToBring(message.item)
        .then(r => sendResponse(r))
        .catch(e => sendResponse({ success: false, error: e.message }));
      return true;
    }

    if (message.action === 'addItemsToBring') {
      addMultipleItems(message.items)
        .then(results => sendResponse({ success: true, results }))
        .catch(e => sendResponse({ success: false, error: e.message }));
      return true;
    }
  });
})();
