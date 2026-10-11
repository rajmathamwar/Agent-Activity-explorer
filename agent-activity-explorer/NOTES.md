# NOTES

## What I built
**Part A, Agent Activity Explorer** (`app/`, React 19 + Vite + TypeScript, no UI or routing library).
- **Core:** event table over the whole dataset (cursor pagination, prefetch as you scroll); search + status + multi-agent filters stored in the URL (refresh, back/forward and copied links all reproduce the view); detail panel at `?event=<id>` that closes with Esc, the close button or the scrim; loading, empty, error (with retry) and slow-network states for the list, the panel and the agent filter.
- **Polish:** keyboard navigation of the list (arrows / j / k / PageUp / PageDown / Home / End / Enter, `/` to focus search), tablet layout (side panel becomes a modal drawer below 1100px), semantic grid markup with `aria-activedescendant`, focus moved into the panel and handed back on close, status shown by icon + text (not colour alone), dark mode from the system setting, `prefers-reduced-motion`.
- **Stretch, two picked:** a **hand-written virtualized list** (`lib/virtual.ts` + `EventTable.tsx`, fixed row height, ~25 rows in the DOM however many pages are loaded) and **tests** (32, Vitest + Testing Library). I picked virtualization because the brief says the user must get through the whole dataset (50k rows), which otherwise means an ever-growing DOM. I skipped live mode and the histogram chart rather than do them halfway.

**Part B, Perf Clinic:** ten problems found, measured and fixed; see `PERF.md`.

**Why Vite:** a client-only tool talking to a separate API needs no SSR or server routing; Vite is the smaller, faster-to-iterate option.

## Decisions worth knowing
- **URL is the single source of truth** (a ~100-line history store, `lib/urlState.ts`) instead of a router. Typing in search replaces the history entry within a burst, but the first edit of a burst pushes one, so Back can undo a search without replaying every keystroke. Opening the panel pushes one entry and Esc/close pops it, unless the panel was deep-linked or filters changed meanwhile, in which case it rewrites the URL in place so Back never leaves the app.
- **Mock API is flaky on purpose** (about 10% random 500s, 0.2 to 1.3 s latency, an HTTP 500 on a bad cursor): GETs auto-retry twice with backoff, the UI says "trying again" and a slow-load notice appears after 3 s; only then an error with a button. 4xx and 404 are not retried. Stale responses are impossible: each filter change aborts in-flight requests.
- Invalid URL values (`status=bogus`, bad dates) are dropped client-side instead of sent to the API.

## Known gaps / what I'd do next
- No live mode and no histogram chart. The chart brush would be the best way to jump around a 50k-row, cursor-only dataset.
- The cursor API can't seek, so scrolling to the 40,000th row means loading everything before it (the footer shows progress). `from`/`to` work from the URL and show as a chip, but there is no date-picker UI.
- `total` can drift by a few while the server ingests new events; I trust the latest value.
- Tests use a mocked `fetch` and jsdom (no layout), so scrolling/virtualization is covered by unit tests on the maths plus a manual Chromium run, not by an automated browser test. I did not run axe or a screen reader; accessibility was checked by hand and by roles in tests. Only tried in Chromium.
- Detail JSON is plain text (no syntax highlighting); anything over 20k characters is cut off until "Show all".

## How I used AI
I used **Claude (via Claude Code)** for most of the work, and I want to be specific about it:
- It scaffolded the project, wrote the Part A code and tests from my brief, and I directed the structure and reviewed output. A Claude sub-agent did the Part B diagnosis and fixes, using Playwright and Chrome DevTools Protocol metrics for before/after numbers; the measurement script is in `perf-clinic-measure/` so you can re-run it.
- Claude probed the mock API (failure rate, bad-cursor 500, truncated previews, 50k rows) which shaped the retry and URL-validation logic.
- It drove the app in headless Chromium to check filters, URL sync, back/forward, keyboard and error states; that run caught a real bug (`Intl.DateTimeFormat` throws when `dateStyle` is combined with `fractionalSecondDigits`) before submission.
- The tradeoffs and limits above are Claude's write-up, which I have read and stand behind.
