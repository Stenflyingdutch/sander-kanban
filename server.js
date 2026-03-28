const http = require('http');
const fs = require('fs/promises');
const path = require('path');

const PORT = Number(process.env.PORT || 4173);
const TODOS_PATH = process.env.TODOS_MD_PATH || '/Users/henk/.openclaw/workspace/StenVault/01_denken/Todos.md';
const ROOT = __dirname;

const STATUS_CONFIG = [
  { key: 'ideen', title: '💡 Ideen', aliases: [], done: false },
  { key: 'lesen-schauen', title: '📺 Lesen & Schauen', aliases: [], done: false },
  { key: 'backlog', title: '🗂️ Backlog', aliases: ['🔵 Backlog'], done: false },
  { key: 'angriff', title: '🚀 Angriff', aliases: ['🔴 Angriff'], done: false },
  { key: 'warten', title: '⏸️ Warten', aliases: ['🟡 Warten'], done: false },
  { key: 'erledigt', title: '✅ Erledigt', aliases: [], done: true },
];

const STATUS_BY_TITLE = new Map(
  STATUS_CONFIG.flatMap((entry) => [entry.title, ...(entry.aliases || [])].map((title) => [title, entry])),
);
const TABLE_SEPARATOR_RE = /^\|(?:\s*:?-{3,}:?\s*\|)+\s*$/;

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 2_000_000) {
        reject(new Error('Request body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload, null, 2));
}

function escapeHtml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function splitTableRow(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) return null;
  return trimmed
    .slice(1, -1)
    .split('|')
    .map((cell) => cell.trim());
}

function slugify(text) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function safeCell(value) {
  return String(value || '')
    .replace(/\|/g, '\\|')
    .trim();
}

function formatTimestamp(date = new Date()) {
  const iso = new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString();
  return iso.slice(0, 16).replace('T', ' ');
}

function formatDoneDate(date = new Date()) {
  const iso = new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString();
  return iso.slice(0, 10);
}

function normalizeItem(rawItem, statusKey) {
  const status = STATUS_CONFIG.find((entry) => entry.key === statusKey);
  return {
    id: rawItem.id || `${statusKey}-${Math.random().toString(36).slice(2, 10)}`,
    title: String(rawItem.title || '').trim(),
    category: String(rawItem.category || '').trim(),
    priority: String(rawItem.priority || '').trim(),
    note: String(rawItem.note || '').trim(),
    date: status?.done ? String(rawItem.date || formatDoneDate()).trim() : '',
  };
}

function tableHeader(isDone) {
  return isDone
    ? ['Task', 'Kategorie', 'Priorität', 'Notiz', 'Datum']
    : ['Task', 'Kategorie', 'Priorität', 'Notiz'];
}

function tableDivider(isDone) {
  return isDone
    ? '|------|-----------|-----------|-------|-------|'
    : '|------|-----------|-----------|-------|';
}

function itemToRow(item, isDone) {
  const cells = [
    safeCell(item.title),
    safeCell(item.category),
    safeCell(item.priority),
    safeCell(item.note),
  ];
  if (isDone) cells.push(safeCell(item.date));
  return `| ${cells.join(' | ')} |`;
}

function extractTable(lines, startIndex) {
  let index = startIndex;
  while (index < lines.length && lines[index].trim() === '') index += 1;

  if (index + 1 >= lines.length) {
    return { tableStart: null, tableEnd: null, rows: [] };
  }

  const header = splitTableRow(lines[index]);
  if (!header || !lines[index + 1].trim().startsWith('|') || !TABLE_SEPARATOR_RE.test(lines[index + 1].trim())) {
    return { tableStart: null, tableEnd: null, rows: [] };
  }

  const rows = [];
  let cursor = index + 2;
  while (cursor < lines.length) {
    const cells = splitTableRow(lines[cursor]);
    if (!cells) break;
    rows.push(cells);
    cursor += 1;
  }

  return { tableStart: index, tableEnd: cursor, rows };
}

function parseMarkdown(markdown) {
  const lines = markdown.split(/\r?\n/);
  const headingIndices = [];

  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].startsWith('## ')) {
      headingIndices.push(i);
    }
  }

  const sections = [];
  for (let i = 0; i < headingIndices.length; i += 1) {
    const start = headingIndices[i];
    const end = i + 1 < headingIndices.length ? headingIndices[i + 1] : lines.length;
    const title = lines[start].slice(3).trim();
    sections.push({ title, start, end });
  }

  const managedSections = new Map();
  const board = {};

  for (const section of sections) {
    const config = STATUS_BY_TITLE.get(section.title);
    if (!config) continue;

    const bodyLines = lines.slice(section.start + 1, section.end);
    const table = extractTable(bodyLines, 0);
    const prefixLines = table.tableStart === null ? bodyLines : bodyLines.slice(0, table.tableStart);
    const suffixLines = table.tableEnd === null ? [] : bodyLines.slice(table.tableEnd);

    const items = table.rows.map((cells, index) => normalizeItem({
      id: `${config.key}-${slugify(cells[0] || `item-${index + 1}`)}-${index + 1}`,
      title: cells[0] || '',
      category: cells[1] || '',
      priority: cells[2] || '',
      note: config.done
        ? (cells.length >= 5 ? (cells[3] || '') : '')
        : (cells[3] || ''),
      date: config.done
        ? (cells.length >= 5 ? (cells[4] || '') : (cells[3] || ''))
        : '',
    }, config.key));

    board[config.key] = items;
    managedSections.set(config.key, {
      config,
      prefixLines,
      suffixLines,
    });
  }

  for (const config of STATUS_CONFIG) {
    if (!board[config.key]) board[config.key] = [];
  }

  const updatedAtMatch = markdown.match(/(\*\*Letzte Aktualisierung:\*\*\s*)(.+)/);

  return {
    board,
    meta: {
      sourcePath: TODOS_PATH,
      updatedAt: updatedAtMatch ? updatedAtMatch[2].trim() : '',
      managedSections,
      original: markdown,
    },
  };
}

function renderManagedSection(section, items) {
  const { config, prefixLines, suffixLines } = section;
  const output = [`## ${config.title}`];

  if (prefixLines.length > 0) output.push(...prefixLines);
  else output.push('');

  output.push(`| ${tableHeader(config.done).join(' | ')} |`);
  output.push(tableDivider(config.done));

  if (items.length > 0) {
    for (const item of items) {
      output.push(itemToRow(item, config.done));
    }
  }

  if (suffixLines.length > 0) output.push(...suffixLines);

  return output.join('\n');
}

function serializeMarkdown(meta, board) {
  const original = meta.original;
  const parts = [];
  const lines = original.split(/\r?\n/);

  const sectionPositions = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (!lines[i].startsWith('## ')) continue;
    const title = lines[i].slice(3).trim();
    const config = STATUS_BY_TITLE.get(title);
    if (!config) continue;
    const nextIndex = lines.findIndex((line, idx) => idx > i && line.startsWith('## '));
    sectionPositions.push({
      key: config.key,
      start: i,
      end: nextIndex === -1 ? lines.length : nextIndex,
    });
  }

  let cursor = 0;
  for (const position of sectionPositions) {
    parts.push(lines.slice(cursor, position.start).join('\n'));
    const section = meta.managedSections.get(position.key);
    parts.push(renderManagedSection(section, board[position.key] || []));
    cursor = position.end;
  }
  parts.push(lines.slice(cursor).join('\n'));

  let rendered = parts.join('\n');
  rendered = rendered.replace(
    /(\*\*Letzte Aktualisierung:\*\*\s*)(.+)/,
    `$1${formatTimestamp()}`
  );

  return rendered.replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

async function loadBoard() {
  const markdown = await fs.readFile(TODOS_PATH, 'utf8');
  return parseMarkdown(markdown);
}

async function saveBoard(payload) {
  const current = await loadBoard();
  const nextBoard = {};

  for (const status of STATUS_CONFIG) {
    const items = Array.isArray(payload.board?.[status.key]) ? payload.board[status.key] : [];
    nextBoard[status.key] = items
      .map((item) => normalizeItem(item, status.key))
      .filter((item) => item.title);
  }

  const markdown = serializeMarkdown(current.meta, nextBoard);
  await fs.writeFile(TODOS_PATH, markdown, 'utf8');
  return parseMarkdown(markdown);
}

function serveFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
  };

  fs.readFile(filePath)
    .then((data) => {
      res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
      res.end(data);
    })
    .catch(() => {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
    });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'GET' && url.pathname === '/api/todos') {
    try {
      const data = await loadBoard();
      sendJson(res, 200, {
        board: data.board,
        statuses: STATUS_CONFIG,
        sourcePath: TODOS_PATH,
        updatedAt: data.meta.updatedAt,
      });
    } catch (error) {
      sendJson(res, 500, { error: error.message });
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/todos') {
    try {
      const payload = await readJson(req);
      const data = await saveBoard(payload);
      sendJson(res, 200, {
        ok: true,
        board: data.board,
        statuses: STATUS_CONFIG,
        sourcePath: TODOS_PATH,
        updatedAt: formatTimestamp(),
      });
    } catch (error) {
      sendJson(res, 500, { error: error.message });
    }
    return;
  }

  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/kanban.html')) {
    serveFile(res, path.join(ROOT, 'kanban.html'));
    return;
  }

  if (req.method === 'GET' && (url.pathname === '/kanban.css' || url.pathname === '/kanban.js')) {
    serveFile(res, path.join(ROOT, url.pathname.slice(1)));
    return;
  }

  if (req.method === 'GET' && url.pathname.startsWith('/icons/')) {
    serveFile(res, path.join(ROOT, url.pathname));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(escapeHtml('Not found'));
});

server.listen(PORT, () => {
  console.log(`Kanban app running on http://localhost:${PORT}`);
  console.log(`Using todos file: ${TODOS_PATH}`);
});
