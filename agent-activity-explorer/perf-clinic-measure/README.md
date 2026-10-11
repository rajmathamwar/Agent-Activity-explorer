# perf-clinic measurements

Reproduce: start the page (`npm run perf-clinic`, port 5174), then
`cd perf-clinic-measure && npm i --no-save playwright-core && node measure.js <label> [url]`
(or `NODE_PATH=/dir/with/node_modules node measure.js <label>`; set `CHROMIUM_PATH` to a Chromium binary if Playwright's own browser is not installed). It writes `results-<label>.json` and `screenshot-<label>.png`. To compare against the original code, serve a copy of the pre-fix `perf-clinic/` on another port and pass its URL. Runs take about 3 minutes (4x CPU throttle, 10 Mbit/s + 40 ms RTT, cache off, 1280x800). `results-before*.json` and `results-after.json` are the numbers quoted in `../PERF.md`.
