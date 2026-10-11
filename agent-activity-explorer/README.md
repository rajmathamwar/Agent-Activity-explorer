# Agent Activity Explorer

Frontend take-home: a React explorer for the mock agent-activity API (Part A) and a performance clean-up of a vanilla-JS page (Part B).

| Path | What it is |
|---|---|
| `app/` | **Part A**, React + Vite + TypeScript |
| `perf-clinic/` | **Part B**, fixed page (framework-free) |
| `PERF.md` | Part B write-up: symptom, how found, root cause, fix, before/after |
| `perf-clinic-measure/` | Playwright/CDP script and raw results behind `PERF.md` |
| `NOTES.md` | Choices, tradeoffs, gaps, AI usage |
| `bin/`, `scripts/`, `ASSIGNMENT.md` | Provided by the assignment |

## Run it

```bash
npm install            # (root has no dependencies; this is a no-op)
npm run api            # mock API on http://localhost:4000

cd app && npm install
npm run dev            # Part A on http://localhost:5173
npm test               # 32 tests (Vitest)
npm run build          # type-check + production build

npm run perf-clinic    # Part B on http://localhost:5174 (from the repo root)
```

The app talks to `http://localhost:4000` by default; override with `VITE_API_URL`.

## Keyboard shortcuts (Part A)
`/` focus search · `↑ ↓` or `j k` move through the list · `PageUp/PageDown`, `Home/End` · `Enter` open details · `Esc` close details / popovers
