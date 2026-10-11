const { pageSize, tickerIntervalMs, tickerVisibleRows, storageKey } = window.APP_CONFIG;

const grid = document.getElementById('agents');
const searchInput = document.getElementById('search');
const resultsList = document.getElementById('results');
const resultsCount = document.getElementById('results-count');
const topbar = document.querySelector('.topbar');
const backToTop = document.getElementById('back-to-top');
const progress = document.getElementById('read-progress');
const tickerToggle = document.getElementById('ticker-toggle');
const preview = document.getElementById('row-preview');
const scrollContext = document.getElementById('scroll-context');

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatTime(iso) {
  return new Date(iso).toLocaleTimeString('en-GB', { hour12: false, timeZone: 'UTC' });
}

function countByAgent(events) {
  const counts = {};
  events.forEach((event) => {
    counts[event.agent] = (counts[event.agent] || 0) + 1;
  });
  return counts;
}

// Avatars are 96x96 webp (2x of the 48px CSS size); width/height reserve the space, and card
// heights are equalised by the grid itself (stretch + min-height in CSS), so there is no JS layout pass.
function renderAgents() {
  const counts = countByAgent(window.ACTIVITY);
  grid.innerHTML = window.AGENTS.map((agent, index) => {
    const image = 'assets/agents/agent-' + String((index % 12) + 1).padStart(2, '0') + '.webp';
    return (
      '<article class="agent-card">' +
      '<img class="agent-avatar" src="' + image + '" width="48" height="48" loading="lazy" decoding="async" alt="">' +
      '<h3>' + escapeHtml(agent.name) + '</h3>' +
      '<p class="agent-owner">' + escapeHtml(agent.owner) + '</p>' +
      '<p class="agent-description">' + escapeHtml(agent.description) + '</p>' +
      '<p class="agent-count">' + (counts[agent.name] || 0).toLocaleString() + ' calls today</p>' +
      '</article>'
    );
  }).join('');
}

function loadViewed() {
  try {
    return new Set(JSON.parse(localStorage.getItem(storageKey) || '[]'));
  } catch {
    return new Set();
  }
}

// One read-modify-write per render instead of one JSON.stringify + setItem per row.
function rememberViewed(viewed, items) {
  let changed = false;
  for (const item of items) {
    if (!viewed.has(item.id)) {
      viewed.add(item.id);
      changed = true;
    }
  }
  if (changed) {
    try {
      localStorage.setItem(storageKey, JSON.stringify([...viewed]));
    } catch {}
  }
}

// ---- search index: built once, instead of JSON.stringify + new Date() sort on every keystroke ----
let haystacks = null; // lower-cased JSON of each event, same order as window.ACTIVITY
let lastQuery = '';
let lastMatches = null; // indices into window.ACTIVITY matching lastQuery; null = everything

function ensureHaystacks() {
  const list = window.ACTIVITY;
  if (!haystacks) haystacks = new Array(list.length);
  for (let i = 0; i < list.length; i++) {
    if (haystacks[i] === undefined) haystacks[i] = JSON.stringify(list[i]).toLowerCase();
  }
  return haystacks;
}

// Build the index in idle slices so the first keystroke does not pay for 100k JSON.stringify calls.
function warmIndexInIdle() {
  const list = window.ACTIVITY;
  if (!haystacks) haystacks = new Array(list.length);
  let i = 0;
  const idle = window.requestIdleCallback || ((cb) => setTimeout(() => cb({ timeRemaining: () => 8 }), 50));
  const step = (deadline) => {
    const until = performance.now() + Math.max(2, Math.min(12, deadline.timeRemaining()));
    while (i < list.length && performance.now() < until) {
      for (let n = 0; n < 250 && i < list.length; n++, i++) {
        if (haystacks[i] === undefined) haystacks[i] = JSON.stringify(list[i]).toLowerCase();
      }
    }
    if (i < list.length) idle(step);
  };
  idle(step);
}

// Returns indices into window.ACTIVITY (null = every event).
function search(query) {
  const needle = query.trim().toLowerCase();
  if (needle === '') {
    lastQuery = needle;
    lastMatches = null;
    return null;
  }
  // Typing "bil" -> "bill" can only narrow the previous result set, so scan that instead of everything.
  const canNarrow = lastQuery !== '' && needle.startsWith(lastQuery);
  const hay = ensureHaystacks();
  const out = [];
  if (canNarrow) {
    for (const i of lastMatches) {
      if (hay[i].includes(needle)) out.push(i);
    }
  } else {
    for (let i = 0; i < hay.length; i++) {
      if (hay[i].includes(needle)) out.push(i);
    }
  }
  lastQuery = needle;
  lastMatches = out;
  return out;
}

// Newest `n` events among `indices` (null = all), without sorting all 100k. Ties keep original order,
// exactly like the old stable sort.
function newestFirst(indices, n) {
  const events = window.ACTIVITY;
  const cmp = (a, b) => {
    const ta = events[a].timestamp;
    const tb = events[b].timestamp;
    return ta < tb ? 1 : ta > tb ? -1 : a - b;
  };
  let buffer = [];
  const total = indices ? indices.length : events.length;
  for (let k = 0; k < total; k++) {
    buffer.push(indices ? indices[k] : k);
    if (buffer.length >= n * 4) {
      buffer.sort(cmp);
      buffer.length = n;
    }
  }
  buffer.sort(cmp);
  buffer.length = Math.min(buffer.length, n);
  return buffer.map((i) => events[i]);
}

function renderResults(query) {
  const matches = search(query);
  const total = matches ? matches.length : window.ACTIVITY.length;
  const page = newestFirst(matches, pageSize);
  const viewed = loadViewed();
  resultsCount.textContent = total.toLocaleString() + ' matching tool calls';
  resultsList.innerHTML = page.map((event) => {
    const isNew = !viewed.has(event.id);
    return (
      '<li class="result-row status-' + event.status + '" data-id="' + event.id + '" data-minute="' + event.timestamp.slice(11, 16) + '">' +
      '<span class="result-time">' + formatTime(event.timestamp) + '</span>' +
      '<span class="result-agent">' + escapeHtml(event.agent) + '</span>' +
      '<span class="result-tool">' + escapeHtml(event.tool) + '</span>' +
      '<span class="result-status">' + event.status + '</span>' +
      '<span class="result-latency">' + event.latencyMs + ' ms</span>' +
      '<span class="result-summary">' + escapeHtml(event.summary) + '</span>' +
      (isNew ? '<span class="badge-new">New</span>' : '') +
      '</li>'
    );
  }).join('');
  rows = resultsList.children;
  geometry = null;
  focusLo = focusHi = -1;
  fitSummaries();
  rememberViewed(viewed, page);
  scheduleScrollUpdate();
}

// Shrink long summaries to fit. Layout-friendly: measure every cell's natural width at 14px in one
// pass, jump straight to the estimated size, then verify/adjust in batched passes (all writes, then
// all reads), instead of a write/read pair per cell per 0.5px step.
function fitSummaries() {
  const cells = Array.from(resultsList.querySelectorAll('.result-summary'));
  if (!cells.length) return;
  for (const cell of cells) cell.style.fontSize = '14px';
  const sizes = cells.map((cell) => {
    const natural = cell.scrollWidth;
    const room = cell.clientWidth;
    if (natural <= room) return 14;
    return Math.max(11, Math.floor(((14 * room) / natural) * 2) / 2);
  });
  cells.forEach((cell, i) => {
    if (sizes[i] !== 14) cell.style.fontSize = sizes[i] + 'px';
  });
  let pending = cells.map((_, i) => i);
  while (pending.length) {
    const overflowing = pending.filter((i) => cells[i].scrollWidth > cells[i].clientWidth && sizes[i] > 11);
    for (const i of overflowing) {
      sizes[i] -= 0.5;
      cells[i].style.fontSize = sizes[i] + 'px';
    }
    pending = overflowing;
  }
}

// ---- scroll: one rAF-coalesced pass, no per-row layout reads ----
let rows = resultsList.children;
let geometry = null; // { firstTop, rowH } in page coordinates, re-measured only when layout changes
let focusLo = -1;
let focusHi = -1;
let minuteCounts = null;
let scrollQueued = false;
let topbarRaised = false;
let topbarCompact = false;
let backVisible = false;

function measureGeometry() {
  const n = rows.length;
  if (!n) return null;
  const first = rows[0].getBoundingClientRect();
  const firstTop = first.top + window.scrollY;
  let rowH = first.height;
  if (n > 1) rowH = (rows[n - 1].getBoundingClientRect().top + window.scrollY - firstTop) / (n - 1);
  return { firstTop, rowH };
}

function minuteCount(minute) {
  if (!minuteCounts) {
    minuteCounts = new Map();
    for (const event of window.ACTIVITY) {
      const m = event.timestamp.slice(11, 16);
      minuteCounts.set(m, (minuteCounts.get(m) || 0) + 1);
    }
  }
  return minuteCounts.get(minute) || 0;
}

function updateOnScroll() {
  scrollQueued = false;
  // reads first
  const scrolled = window.scrollY;
  const viewport = window.innerHeight;
  const max = document.documentElement.scrollHeight - viewport;
  if (!geometry) geometry = measureGeometry();
  // writes
  progress.style.transform = 'scaleX(' + (max > 0 ? scrolled / max : 0) + ')';
  const raised = scrolled > 8;
  if (raised !== topbarRaised) {
    topbarRaised = raised;
    topbar.classList.toggle('topbar-raised', raised);
  }
  const compact = scrolled > 60;
  if (compact !== topbarCompact) {
    topbarCompact = compact;
    topbar.classList.toggle('topbar-compact', compact);
  }
  const showBack = scrolled > viewport;
  if (showBack !== backVisible) {
    backVisible = showBack;
    backToTop.classList.toggle('visible', showBack);
  }

  let lo = -1;
  let hi = -1;
  if (geometry) {
    const n = rows.length;
    // rows whose viewport-top lies strictly between 30% and 60% of the viewport height
    lo = Math.max(0, Math.floor((viewport * 0.3 + scrolled - geometry.firstTop) / geometry.rowH) + 1);
    hi = Math.min(n - 1, Math.ceil((viewport * 0.6 + scrolled - geometry.firstTop) / geometry.rowH) - 1);
    if (lo > hi) lo = hi = -1;
  }
  if (lo !== focusLo || hi !== focusHi) {
    for (let i = focusLo; i >= 0 && i <= focusHi; i++) rows[i] && rows[i].classList.remove('in-focus');
    for (let i = lo; i >= 0 && i <= hi; i++) rows[i].classList.add('in-focus');
    focusLo = lo;
    focusHi = hi;
    if (lo >= 0) {
      const minute = rows[lo].dataset.minute;
      scrollContext.textContent = minute + ' UTC · ' + minuteCount(minute) + ' calls that minute';
    } else {
      scrollContext.textContent = '';
    }
  }
}

function scheduleScrollUpdate() {
  if (scrollQueued) return;
  scrollQueued = true;
  requestAnimationFrame(updateOnScroll);
}

// ---- hover preview: rAF-coalesced, text read from the row instead of a 100k-item find() ----
let pendingMove = null;
let previewRow = null;

function flushPreview() {
  const event = pendingMove;
  pendingMove = null;
  if (!event) return;
  const row = event.target.closest('.result-row');
  if (!row) return;
  if (row !== previewRow) {
    const cell = row.querySelector('.result-summary');
    if (!cell) return;
    preview.textContent = cell.textContent;
    previewRow = row;
  }
  preview.style.top = event.clientY + 12 + 'px';
  preview.style.left = event.clientX + 12 + 'px';
  preview.hidden = false;
}

function showPreview(event) {
  const queued = pendingMove !== null;
  pendingMove = event;
  if (!queued) requestAnimationFrame(flushPreview);
}

function hidePreview() {
  pendingMove = null;
  previewRow = null;
  preview.hidden = true;
}

// ---- live ticker: one interval, cleared on close; no unbounded row cache ----
let tickerPanel = null;
let tickerTimer = 0;

function tickerRow(event) {
  const row = document.createElement('li');
  row.className = 'ticker-row status-' + event.status;
  row.innerHTML =
    '<span class="ticker-time">' + formatTime(event.timestamp) + '</span>' +
    '<span class="ticker-agent">' + escapeHtml(event.agent) + '</span>' +
    '<span class="ticker-tool">' + escapeHtml(event.tool) + '</span>';
  return row;
}

function positionTicker() {
  if (!tickerPanel) return;
  tickerPanel.style.maxHeight = window.innerHeight - 120 + 'px';
}

function openTicker() {
  const panel = document.createElement('aside');
  panel.className = 'ticker';
  panel.innerHTML = '<header class="ticker-header">Live tool calls</header><ul class="ticker-list"></ul>';
  document.body.appendChild(panel);
  tickerPanel = panel;
  const list = panel.querySelector('.ticker-list');

  tickerTimer = setInterval(() => {
    if (!ready) return;
    const event = window.ACTIVITY[Math.floor(Math.random() * window.ACTIVITY.length)];
    list.prepend(tickerRow(event));
    while (list.children.length > tickerVisibleRows) {
      list.lastElementChild.remove();
    }
  }, tickerIntervalMs);

  positionTicker();
  tickerToggle.setAttribute('aria-pressed', 'true');
  tickerToggle.textContent = 'Hide live calls';
}

function closeTicker() {
  if (!tickerPanel) return;
  clearInterval(tickerTimer);
  tickerTimer = 0;
  tickerPanel.remove();
  tickerPanel = null;
  tickerToggle.setAttribute('aria-pressed', 'false');
  tickerToggle.textContent = 'Show live calls';
}

function debounce(fn, ms) {
  let t = 0;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

// Registered once (they used to be re-added on every ticker open and never removed).
window.addEventListener('resize', positionTicker);
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeTicker();
});

const refit = debounce(() => {
  if (!ready) return;
  fitSummaries();
  geometry = null;
  scheduleScrollUpdate();
}, 100);

searchInput.addEventListener('input', debounce(() => ready && renderResults(searchInput.value), 120));
window.addEventListener('scroll', scheduleScrollUpdate, { passive: true });
window.addEventListener('resize', refit);
resultsList.addEventListener('mousemove', showPreview, { passive: true });
resultsList.addEventListener('mouseleave', hidePreview);
resultsList.addEventListener('wheel', hidePreview, { passive: true });
resultsList.addEventListener('touchstart', hidePreview, { passive: true });
backToTop.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
tickerToggle.addEventListener('click', () => (tickerPanel ? closeTicker() : openTicker()));

// Anything above the list changing height (images, fonts) moves it; re-measure lazily.
new ResizeObserver(() => {
  geometry = null;
  scheduleScrollUpdate();
}).observe(document.querySelector('main'));

// Generate the 100k mock events and render only after the shell (topbar, hero) has painted.
let ready = false;
function start() {
  const builder = window.createActivityBuilder(100000);
  const next = () => {
    if (!builder.step(5000)) return setTimeout(next, 0); // yield between slices so input stays responsive
    window.ACTIVITY = builder.events;
    ready = true;
    renderAgents();
    renderResults(searchInput.value);
    warmIndexInIdle();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(refit);
  };
  next();
}
requestAnimationFrame(() => setTimeout(start, 0));
