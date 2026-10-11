# Part B: Perf Clinic

All numbers come from `perf-clinic-measure/measure.js` (Playwright + CDP `Performance.getMetrics`, PerformanceObserver for long tasks / LCP / CLS), run against the original code and the fixed code under identical conditions: headless Chromium, 1280x800, **4x CPU throttle, 10 Mbit/s + 40 ms RTT, cache off**. Raw output is in `perf-clinic-measure/results-before.json`, `results-before-search.json` and `results-after.json`. "Layouts" is the CDP `LayoutCount` delta, "task" is `TaskDuration` (main-thread busy time).

The two "before" files are the same original code. `results-before.json` is the first run (used for transfer sizes, since it still had `theme.css`); `results-before-search.json` is a re-run from a scratch copy of the original code (with `theme.css` stubbed) after I fixed the search test to type a query that actually matches rows. Use it for everything except transfer sizes.

Summary (before -> after): first contentful paint 8.1 s -> 0.3 s, LCP 10.2 s -> 0.3 s, transferred bytes 6.4 MB -> 109 KB, one keystroke in search 6.5 s -> 12 ms of input latency, scroll average frame 102 ms -> 20 ms.

### 1. Page is blank for ~8 s: the whole app is built synchronously before first paint
- **Symptom:** On load the page shows nothing for about 8 seconds (4x throttled CPU), then everything appears at once. The tab is unresponsive in the meantime.
- **How I found it:** Performance metrics + `longtask` observer on a throttled load. 3 long tasks totalling 7.3 s (TBT 7.1 s), 6.3 s of script time and 2,142 forced layouts before `load`. Reading the code shows the cause: `config.js` is a synchronous `<script>` in `<head>` that generates 100,000 events, and `app.js` then renders the first page by calling `renderResults('')`, which stringifies and date-sorts all 100,000 events, rebuilds the list with `innerHTML` and then runs `fitSummaries` and `equalizeCardHeights`, both of which read layout inside loops.
- **Root cause:** Parser-blocking script that does a large amount of CPU work before the browser is allowed to paint, plus layout thrash (alternating style writes and `scrollWidth` / `offsetTop` reads on 200 rows and 24 cards, so one layout per cell per step).
- **Fix:** `config.js` and `app.js` are now `defer`red. `config.js` only defines a generator (`createActivityBuilder`, same seed and same output); `app.js` starts it after the first frame and generates in 5,000-event slices that yield to the event loop, so topbar and hero paint first and input stays live. Only the newest 200 rows are picked (see #2) instead of sorting 100k. `fitSummaries` was rewritten to measure all cells once, jump to the estimated font size, and verify in batched passes (writes first, then reads). Card heights are equalised by CSS (see #6). The 100k-event index is built in idle time.
- **Before / after:** FCP 8,148 ms -> 296 ms (about 280-340 ms over runs). Layouts during load 2,142 -> 6 (layout time 1,135 ms -> 296 ms). TBT 7,122 ms -> about 590-750 ms (the remaining long tasks are the 100k generation slices and first render, which now happen after paint).

### 2. Typing in the search box freezes the page (seconds per keystroke)
- **Symptom:** Every keystroke locks the UI. Typing "billing-assistant" (17 characters) kept the main thread busy for 34 s at 4x throttle, with one task of 6.1 s; a single keystroke took 6.5 s to reach the next frame.
- **How I found it:** Typed into the input with Playwright and recorded long tasks and `Performance.getMetrics`: 17 long tasks (32 s), 20,558 layouts, 16 s of script. Code reading explains why: `search()` runs `JSON.stringify(event).toLowerCase()` on all 100,000 events and then sorts the matches with `new Date(a) - new Date(b)`; then `renderResults` rebuilds 200 rows and `fitSummaries` and `rememberViewed` do per-row layout reads and `localStorage` writes. None of it is debounced.
- **Root cause:** O(N) allocation-heavy work per keystroke (100k stringifies and Date objects), no debounce, and O(rows x steps) forced layouts afterwards.
- **Fix:** (a) The lower-cased JSON of each event is computed once (in idle slices after first render) and reused, so the matching semantics are unchanged (still substring of the event JSON). (b) Extending the previous query ("bil" -> "bill") only scans the previous matches. (c) No full sort: the newest 200 are selected with a bounded buffer (ties keep original order, like the old stable sort). (d) Input is debounced by 120 ms. (e) `fitSummaries` is batched (see #1), and `rememberViewed` writes once (see #9).
- **Before / after:** Typing "billing-assistant": task 34.0 s -> 1.0 s, long tasks 17 (32.1 s) -> 1 (0.3 s, the first keystroke), layouts 20,558 -> 20, script 16.4 s -> 0.16 s. Single keystroke to next paint 6,543 ms -> 12 ms.

### 3. Scrolling is janky: layout thrash and a 100k-item scan on every scroll event
- **Symptom:** Scrolling the results list stutters badly; the frame rate collapses to a few frames per second.
- **How I found it:** Recorded rAF frame deltas while wheel-scrolling 80 steps: 272 frames, average 102 ms, p95 400 ms, max 567 ms, 62 long tasks, 944 layouts, 22.9 s of script. The scroll handler is the culprit: for each of the 200 rows it calls `classList.remove`, then `getBoundingClientRect()` (a forced layout, since the previous row's class change invalidated style), then adds the class; it then runs `window.ACTIVITY.filter(...)` with `new Date(...).toISOString()` over 100,000 events for the "calls that minute" label. It also writes `topbar.style.paddingBlock` (a layout) and reads `scrollHeight` after that write. The handler is not passive and not throttled.
- **Root cause:** Layout-reading loop in a per-event handler, O(100k) work per event, and write-then-read ordering.
- **Fix:** Scroll events only schedule one `requestAnimationFrame` pass. In that pass the "in focus" rows are computed arithmetically from cached row geometry (re-measured only when a `ResizeObserver` on `main` or a resize says layout changed), and only rows entering or leaving the band get a class change. Minute counts come from a `Map` built once. Reads happen before writes. The progress bar uses `transform: scaleX()` (compositor) instead of `width`. The top bar shrink is a two-state class toggle (written only when it changes) instead of a continuously recomputed padding. The listener is `passive`. I checked that the in-focus rows, the label text and the progress ratio match the original at six scroll positions (one position differs by one row at the very bottom because of a sub-pixel boundary).
- **Before / after:** Average frame 102.4 ms -> 19.8 ms, p95 400 ms -> 33 ms, max 567 ms -> 83 ms, frames over 50 ms 63 -> 1, layouts 944 -> 64, script 22.9 s -> 0.10 s.

### 4. Hero image is a 4.2 MB PNG with no dimensions
- **Symptom:** Slow first load; the hero (the largest content on screen) arrives last. On the throttled connection LCP was 10.2 s.
- **How I found it:** Network transfer sizes: `hero.png` is 4,270,977 bytes (1700x950 with film grain), 66% of the 6.4 MB page weight; no `width`/`height`, no `srcset`, no preload or priority hint.
- **Root cause:** Unoptimised lossless PNG displayed at 1216 px max, in a format that handles the grain poorly, with no way for the browser to reserve space or prioritise it.
- **Fix:** Re-encoded with sharp to AVIF (12.6 KB at 1700 px, 1.8 KB at 850 px) and a WebP fallback (170 KB / 5.8 KB), served through `<picture>` with `srcset`/`sizes`, `width`/`height` 1700x950 plus `aspect-ratio` (no layout shift when it decodes), `fetchpriority="high"`, `decoding="async"` and a matching `<link rel="preload">`. The AVIF is smoother than the grainy original (it drops the noise), which is a visible-but-subtle difference; the WebP fallback keeps more of it. `assets/hero.png` was removed.
- **Before / after:** Hero 4,171 KB -> 12.6 KB (AVIF). LCP 10,220 ms -> about 300 ms. Total transferred 6,464 KB -> 109 KB. CLS was 0 in my harness both before and after, because the old page did not paint anything until everything had loaded, so the reserved dimensions are a guard rather than a measured improvement.

### 5. Hovering rows scans 100,000 events on every mouse move
- **Symptom:** The row preview tooltip lags behind the cursor and the page feels sluggish while the mouse moves over the list.
- **How I found it:** Dispatched 150 mouse moves over the list: 4.9 s of script, 7.3 s of main-thread time, 304 layouts. `showPreview` does `window.ACTIVITY.find(...)` (linear scan of 100k) on every `mousemove`, then sets `top`/`left` and toggles `hidden`.
- **Root cause:** Linear lookup per high-frequency event with no coalescing, for text that is already in the row's DOM.
- **Fix:** The preview text is read from the row's `.result-summary` cell (and only re-set when the row changes), and mouse moves are coalesced to one update per animation frame. Listeners are passive.
- **Before / after:** 150 moves: script 4,885 ms -> 42 ms; main-thread time 7.3 s -> 1.2 s; layouts 304 -> 150.

### 6. Agent cards: oversized avatars and a quadratic layout loop
- **Symptom:** Avatars pop in late and the cards jump around while images load; resizing the window is slow.
- **How I found it:** Network: 12 avatar PNGs of 150-168 KB each (1.9 MB, 320x320 source for a 48 px image, no `width`/`height`, no lazy loading). Layout counters: `equalizeCardHeights` runs on every image `load` and on every resize, and for each of the 24 cards it reads `offsetTop` and `offsetHeight` of every other card after writing `style.height` (24 x 24 forced layouts per call). A 3-step window resize cost 3,195 layouts and 2.4 s of main-thread time.
- **Root cause:** Unoptimised images without reserved space, and JavaScript doing what CSS grid does natively, with an O(n^2) read/write interleave.
- **Fix:** Avatars resized to 96x96 (2x of the 48 px display size), WebP, `width`/`height` set, `loading="lazy"` and `decoding="async"`. The JS equaliser is gone: the grid now stretches cards to the row height and `.agent-card` has `min-height: 220px`, which reproduces the same heights (I compared all 24 card heights against the original: identical). Resize now only re-fits the summaries, debounced.
- **Before / after:** Avatar bytes about 1,890 KB -> 4.4 KB. 3-step resize: layouts 3,195 -> 15, task 2,364 ms -> 737 ms. Card heights identical (268/247/226 px as before).

### 7. Live ticker leaks timers, listeners and nodes every time it is opened
- **Symptom:** After opening and closing "Show live calls" a few times the page gets steadily slower, even with the panel closed.
- **How I found it:** Opened and closed the ticker 10 times and counted live intervals (wrapping `setInterval`/`clearInterval`), CDP `JSEventListeners`, `Nodes` and heap after forced GC: 10 live intervals, +24 listeners, +716-814 nodes, +846 KB. With the panel closed the page still did 190 layouts and 1.5 s of main-thread time per 3 s. With it open for 10 s: 611 layouts, 5.3 s of task time. Code: `openTicker` calls `setInterval` and never clears it (`closeTicker` only removes the panel), adds a new `resize` and `keydown` listener each time, and `renderedTickerRows` is a `Map` that caches a DOM node per event id forever (it grows by up to 2 entries per second).
- **Root cause:** Resources acquired in `openTicker` are never released in `closeTicker`; each interval keeps detached panel nodes alive and keeps prepending rows into them.
- **Fix:** The interval id is stored and cleared on close. The `resize` and `keydown` listeners are registered once at startup. The node cache (clone of a cached node) was dropped; rows are created directly.
- **Before / after:** After 10 open/close cycles: live intervals 10 -> 0, listeners +24 -> 0, nodes +716..814 -> +4 (the 4 are the page's own rows after the deferred render finished), heap +846 KB -> +129 KB (index warm-up noise). Closed-panel work per 3 s: 190 layouts / 1.5 s -> 0 layouts / 1 ms. Ticker open for 10 s: layouts 611 -> 20, task 5.3 s -> 0.46 s.

### 8. The alert marquee animates `left`, forcing layout every frame, forever
- **Symptom:** The page is never idle: constant CPU use and battery drain even when nothing is happening, and every other animation competes with it.
- **How I found it:** 3 s of idle with no interaction: 180 layouts and 180 style recalcs (one of each per frame, 60 fps) and about 1.0-1.2 s of main-thread time. `@keyframes alerts-scroll` animates `left`.
- **Root cause:** Animating a layout property runs layout and paint on the main thread every frame, indefinitely.
- **Fix:** The track now animates `transform: translateX()` with `will-change: transform`, and `.alerts` is a size container (`container-type: inline-size`) so the same start/end positions (100% and -120% of the strip width) are expressed as `100cqw` / `-120cqw`. The motion is identical but runs on the compositor.
- **Before / after:** Idle 3 s: layouts 180 -> 0, style recalcs 180 -> 1, task time 1,042-1,206 ms -> 6-12 ms.

### 9. Render-blocking, unused CSS and a font without a loading strategy
- **Symptom:** First paint waits for a 327 KB stylesheet that contributes nothing, and text can be invisible until the font arrives.
- **How I found it:** Network panel (`css/theme.css` is 325 KB of the 6.4 MB) and a check of every selector in `index.html`/`app.js` against the file: it is a utility-class library (`.m-1`, `.2xl:w-64`, ...) of which no class is used. The `@font-face` has no `font-display`, and the font is discovered only after CSS has been parsed.
- **Root cause:** A render-blocking `<link>` for CSS the page never uses; font loaded late with the browser default of blocking text.
- **Fix:** Removed the `theme.css` link and file. Added `<link rel="preload" as="font" crossorigin>` for the woff2 and `font-display: swap`; the summaries are re-fitted when `document.fonts.ready` fires so the text-fit does not use fallback-font widths.
- **Before / after:** CSS transferred 325 KB -> 6 KB (one fewer render-blocking request). I did not isolate a separate timing for the font change; it is a standard fix and is included in the FCP number in #1.

### 10. "New" badge bookkeeping rewrites localStorage 200 times per render
- **Symptom:** Small but constant extra cost on every render and keystroke; localStorage writes are synchronous.
- **How I found it:** Code reading plus a micro-benchmark in the page: the original `rememberViewed` calls `JSON.stringify(viewed)` and `localStorage.setItem` inside the loop (once per row), and `loadViewed`/`includes` is an O(n) array scan per row, so a render is O(rows x stored ids).
- **Root cause:** The write is inside the loop, and the lookup structure is an array.
- **Fix:** The viewed ids are loaded into a `Set` once per render (with a try/catch around storage) and written back once, only if something was added.
- **Before / after:** 200 ids: 10.7 ms -> 0.5 ms per render (unthrottled, starting from an empty store; it grows with the size of the stored list, which is 391-416 ids after the test run).

## Not fixed / caveats
- The first render still has to generate 100,000 mock events in the browser (about 240 ms unthrottled, spread over small slices after first paint); if this were real data it would come from the API with paging. Long tasks during load are down from 7.3 s to roughly 0.9-1.0 s total at 4x throttle, but not zero.
- 100k lower-cased JSON strings for the search index use roughly 20-30 MB of heap (built in idle time). A server-side search (the real API has `q`) would remove it.
- The static dev server (`scripts/serve-perf-clinic.js`) sends no cache headers or compression; I did not change it (outside `perf-clinic/`). With long-lived caching and gzip the numbers would improve further.
- The top bar's padding shrink was previously continuous over the first 120 px of scroll; it is now a single step at 60 px (a deliberate trade to avoid a layout per scroll event).
- All measurements are on headless Chromium under CPU/network throttling in a sandbox; absolute numbers will differ on real devices but the before/after ratios come from the same script and conditions. No screenshots/DevTools UI captures were taken; `perf-clinic-measure/screenshot-*.png` show before/after pages.
