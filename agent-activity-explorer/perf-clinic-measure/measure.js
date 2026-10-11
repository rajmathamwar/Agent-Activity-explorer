// Usage: NODE_PATH=<dir with playwright-core> node measure.js <label> [url]
// Needs the perf-clinic server on :5174 (npm run perf-clinic). Writes results-<label>.json next to this file.
const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');

const label = process.argv[2] || 'run';
const url = process.argv[3] || 'http://localhost:5174/';
const exe = process.env.CHROMIUM_PATH || undefined;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const r1 = (n) => Math.round(n * 10) / 10;

async function metrics(cdp) {
  const { metrics } = await cdp.send('Performance.getMetrics');
  return Object.fromEntries(metrics.map((m) => [m.name, m.value]));
}
function diff(a, b) {
  const d = {};
  for (const k of ['LayoutCount', 'RecalcStyleCount', 'LayoutDuration', 'RecalcStyleDuration', 'ScriptDuration', 'TaskDuration']) d[k] = r1((b[k] - a[k]) * (k.endsWith('Duration') ? 1000 : 1));
  return d; // durations in ms
}

(async () => {
  const browser = await chromium.launch({ executablePath: exe, args: ['--enable-precise-memory-info', '--js-flags=--expose-gc'] });
  const out = { label };

  async function fresh() {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Performance.enable');
    // same conditions before/after: 4x CPU slowdown, ~10 Mbit/s, 40 ms RTT
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 40, downloadThroughput: (10e6 / 8), uploadThroughput: (10e6 / 8) });
    await page.addInitScript(() => {
      window.__lt = []; window.__cls = 0; window.__lcp = 0; window.__fcp = 0;
      new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__lt.push(e.duration))).observe({ type: 'longtask', buffered: true });
      new PerformanceObserver((l) => l.getEntries().forEach((e) => { if (!e.hadRecentInput) window.__cls += e.value; })).observe({ type: 'layout-shift', buffered: true });
      new PerformanceObserver((l) => l.getEntries().forEach((e) => { window.__lcp = e.startTime; })).observe({ type: 'largest-contentful-paint', buffered: true });
      new PerformanceObserver((l) => l.getEntries().forEach((e) => { if (e.name === 'first-contentful-paint') window.__fcp = e.startTime; })).observe({ type: 'paint', buffered: true });
      // count live intervals
      const si = window.setInterval, ci = window.clearInterval; window.__intervals = new Set();
      window.setInterval = function (...a) { const id = si.apply(this, a); window.__intervals.add(id); return id; };
      window.clearInterval = function (id) { window.__intervals.delete(id); return ci.call(this, id); };
    });
    return { ctx, page, cdp };
  }

  // ---------- 1. Load ----------
  {
    const { ctx, page, cdp } = await fresh();
    const reqs = [];
    page.on('response', async (res) => { try { const h = res.headers(); reqs.push({ url: res.url().replace(url, ''), type: res.request().resourceType(), bytes: Number(h['content-length'] || 0) }); } catch {} });
    const t0 = Date.now();
    await page.goto(url, { waitUntil: 'load' });
    out.loadEventMs = Date.now() - t0;
    await sleep(4000);
    const m = await metrics(cdp);
    const nav = await page.evaluate(() => {
      const n = performance.getEntriesByType('navigation')[0];
      const lt = window.__lt;
      return {
        fcp: window.__fcp, lcp: window.__lcp, cls: window.__cls, domContentLoaded: n.domContentLoadedEventEnd, load: n.loadEventEnd,
        longTasks: lt.length, longTaskTotalMs: lt.reduce((a, b) => a + b, 0), tbtMs: lt.reduce((a, b) => a + Math.max(0, b - 50), 0),
        domNodes: document.getElementsByTagName('*').length,
        configScriptMs: (performance.getEntriesByType('resource').find((e) => e.name.includes('config.js')) || {}).responseEnd,
      };
    });
    out.load = { ...nav, domNodesMetric: m.Nodes, scriptMs: r1(m.ScriptDuration * 1000), layoutCount: m.LayoutCount, layoutMs: r1(m.LayoutDuration * 1000) };
    const sum = (f) => reqs.filter(f).reduce((a, b) => a + b.bytes, 0);
    out.transfer = { totalKB: Math.round(sum(() => true) / 1024), imagesKB: Math.round(sum((r) => r.type === 'image') / 1024), cssKB: Math.round(sum((r) => r.type === 'stylesheet') / 1024), fontKB: Math.round(sum((r) => r.type === 'font') / 1024), jsKB: Math.round(sum((r) => r.type === 'script') / 1024), requests: reqs.length };
    await page.screenshot({ path: path.join(__dirname, `screenshot-${label}.png`) });

    // ---------- 2. Idle (alerts marquee) ----------
    const a = await metrics(cdp); await sleep(3000); const b = await metrics(cdp);
    out.idle3s = diff(a, b);

    // ---------- 3. Scroll ----------
    await page.evaluate(() => {
      window.__frames = []; let last = performance.now();
      const tick = (t) => { window.__frames.push(t - last); last = t; requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    });
    await page.mouse.move(640, 500);
    const s0 = await metrics(cdp); 
    await page.evaluate(() => { window.__frames.length = 0; window.__lt.length = 0; });
    for (let i = 0; i < 80; i++) { await page.mouse.wheel(0, 120); await sleep(16); }
    await sleep(300);
    const s1 = await metrics(cdp);
    const fr = await page.evaluate(() => ({ frames: window.__frames.slice(), lt: window.__lt.slice() }));
    const sorted = fr.frames.slice().sort((x, y) => x - y);
    out.scroll = { ...diff(s0, s1), frames: fr.frames.length, avgFrameMs: r1(fr.frames.reduce((a, b) => a + b, 0) / fr.frames.length), p95FrameMs: r1(sorted[Math.floor(sorted.length * 0.95)]), maxFrameMs: r1(sorted[sorted.length - 1]), framesOver50ms: fr.frames.filter((f) => f > 50).length, longTasks: fr.lt.length };

    // ---------- 4. Hover preview ----------
    const h0 = await metrics(cdp);
    for (let i = 0; i < 150; i++) { await page.mouse.move(300 + (i % 50) * 10, 300 + (i % 7) * 20); await sleep(8); }
    out.hover150moves = diff(h0, await metrics(cdp));
    await page.evaluate(() => window.scrollTo(0, 0)); await sleep(300);

    // ---------- 5. Search typing ----------
    const q0 = await metrics(cdp);
    await page.evaluate(() => { window.__lt.length = 0; });
    const tt = Date.now();
    await page.locator('#search').click();
    await page.keyboard.type('billing-assistant', { delay: 40 });
    await page.waitForFunction(() => /matching/.test(document.getElementById('results-count').textContent));
    await sleep(1200);
    const q1 = await metrics(cdp);
    const lt = await page.evaluate(() => window.__lt.slice());
    out.searchTyping17chars = { ...diff(q0, q1), longTasks: lt.length, longTaskTotalMs: r1(lt.reduce((a, b) => a + b, 0)), maxLongTaskMs: r1(Math.max(0, ...lt)), count: await page.textContent('#results-count'), rows: await page.locator('.result-row').count() };
    // single-keystroke latency (input event -> next paint)
    await page.fill('#search', '');
    await sleep(800);
    out.keystrokeMs = await page.evaluate(() => new Promise((res) => {
      const el = document.getElementById('search'); const t = performance.now(); el.value = 's';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      requestAnimationFrame(() => setTimeout(() => res(Math.round(performance.now() - t)), 0));
    }));
    await sleep(800);

    // ---------- 6. Resize ----------
    const z0 = await metrics(cdp);
    for (const w of [1100, 900, 1280]) { await page.setViewportSize({ width: w, height: 800 }); await sleep(250); }
    out.resize3 = diff(z0, await metrics(cdp));
    out.localStorageWrites = await page.evaluate(() => JSON.parse(localStorage.getItem('activity:viewed') || '[]').length);
    await ctx.close();
  }

  // ---------- 7. Ticker leak ----------
  {
    const { ctx, page, cdp } = await fresh();
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForSelector('.result-row'); await sleep(6000); // let deferred rendering + idle index warm-up settle
    const gc = async () => { await cdp.send('HeapProfiler.collectGarbage'); await cdp.send('HeapProfiler.collectGarbage'); };
    await gc(); const base = await metrics(cdp);
    for (let i = 0; i < 10; i++) { await page.click('#ticker-toggle'); await sleep(300); await page.keyboard.press('Escape'); await sleep(100); }
    await gc();
    const after = await metrics(cdp);
    const live = await page.evaluate(() => window.__intervals.size);
    const t0 = await metrics(cdp); await sleep(3000); const t1 = await metrics(cdp);
    out.tickerAfter10OpenClose = { liveIntervals: live, tickerPanelsInDom: await page.locator('.ticker').count(), jsListenersDelta: after.JSEventListeners - base.JSEventListeners, nodesDelta: after.Nodes - base.Nodes, heapDeltaKB: Math.round((after.JSHeapUsedSize - base.JSHeapUsedSize) / 1024), closedPanelWork3s: diff(t0, t1) };
    // open ticker and watch for 60 s equivalent? 10 s sample for growth
    await page.click('#ticker-toggle'); await sleep(500);
    await gc(); const o0 = await metrics(cdp); await sleep(10000); await gc(); const o1 = await metrics(cdp);
    out.tickerOpen10s = { ...diff(o0, o1), heapDeltaKB: Math.round((o1.JSHeapUsedSize - o0.JSHeapUsedSize) / 1024), rows: await page.locator('.ticker-row').count() };
    await ctx.close();
  }

  await browser.close();
  fs.writeFileSync(path.join(__dirname, `results-${label}.json`), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
})();
