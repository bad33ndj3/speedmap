const VERSION = '1.17.0';
const URL = `https://cdn.jsdelivr.net/npm/@cloudflare/speedtest@${VERSION}/dist/speedtest.js`;

// Injection keeps the engine contract testable without transferring data.
export function createSpeedTestController({
  load = () => import(URL).then(module => module.default),
  target = window,
  confirm = () => window.confirm('This test sends and receives potentially hundreds of MB. Cloudflare receives the test traffic and results. Continue?'),
  now = () => Date.now(),
  userAgent = () => navigator.userAgent,
} = {}) {
  let active = null;
  const status = message => target.dispatchEvent(new CustomEvent('speedtest-status', { detail: message }));
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  const ms = value => finite(value) && value >= 0 ? Math.round(value * 10) / 10 : null;
  const mbps = value => finite(value) && value > 0 ? Math.round(value / 1e4) / 100 : null;
  function finish(run, result) {
    if (run.settled) return;
    run.settled = true;
    if (active === run) active = null;
    if (run.engine) {
      run.engine.onFinish = () => {};
      run.engine.onResultsChange = () => {};
      run.engine.onError = () => {};
    }
    run.resolve(result);
  }
  async function start(run) {
    try {
      status('Loading the speed test…');
      const SpeedTest = await load();
      if (run.settled) return;
      if (typeof SpeedTest !== 'function') throw new Error('Invalid speed test module');
      const engine = new SpeedTest({ autoStart: false, measureDownloadLoadedLatency: true, measureUploadLoadedLatency: true });
      run.engine = engine;
      engine.onResultsChange = ({ type } = {}) => {
        if (!run.settled && type) status(`Measuring ${type}…`);
      };
      engine.onError = (message, code) => {
        run.lastError = code ? `${message} (HTTP ${code})` : String(message);
      };
      engine.onFinish = results => {
        if (run.settled) return;
        try {
          const raw = results.getSummary() || {};
          const summary = Object.fromEntries(Object.entries(raw).filter(([, v]) => finite(v) || typeof v === 'boolean'));
          let scores = null;
          try {
            const rawScores = results.getScores();
            if (rawScores && typeof rawScores === 'object') {
              scores = Object.fromEntries(Object.entries(rawScores).filter(([, value]) => value && typeof value === 'object').map(([key, value]) => [key, { points: value.points, classificationIdx: value.classificationIdx, classificationName: value.classificationName }]));
            }
          } catch { /* Scores are optional. */ }
          const loadedValues = [ms(raw.downLoadedLatency), ms(raw.upLoadedLatency)].filter(v => v !== null);
          const detail = {
            spotId: run.spotId, network: run.network,
            down: mbps(raw.download), up: mbps(raw.upload), ping: ms(raw.latency),
            loaded: loadedValues.length ? Math.max(...loadedValues) : null,
            details: {
              engine: `@cloudflare/speedtest@${VERSION}`,
              measuredAt: new Date(now()).toISOString(),
              durationMs: finite(raw.totalDurationMs) && raw.totalDurationMs >= 0 ? Math.round(raw.totalDurationMs) : Math.max(0, now() - run.started),
              summary, scores, userAgent: userAgent(), lastError: run.lastError || null,
            },
          };
          if (detail.down === null && detail.up === null && detail.ping === null) throw new Error(run.lastError || 'No measurements returned');
          target.dispatchEvent(new CustomEvent('speedtest-result', { detail }));
          status('Measurement complete.');
          finish(run, detail);
        } catch (error) {
          status(`Measurement failed: ${error.message}`);
          finish(run, null);
        }
      };
      engine.play();
    } catch (error) {
      if (!run.settled) {
        status(`Could not start the speed test: ${error.message}`);
        finish(run, null);
      }
    }
  }
  function runSpeedTestForSpot({ spotId, network } = {}) {
    if (typeof spotId !== 'string' || !spotId.trim() || typeof network !== 'string' || !network.trim()) {
      throw new TypeError('A spot and provider are required');
    }
    if (active) { status('A measurement is already running.'); return Promise.resolve(null); }
    if (!confirm()) { status('Measurement cancelled.'); return Promise.resolve(null); }
    const run = { spotId: spotId.trim(), network: network.trim(), started: now(), settled: false };
    active = run;
    const promise = new Promise(resolve => { run.resolve = resolve; });
    start(run);
    return promise;
  }
  function cancelSpeedTest() {
    if (!active) return false;
    const run = active;
    try { run.engine?.pause(); } catch { /* Finish cancellation even if the engine cannot pause. */ }
    status('Measurement cancelled.');
    finish(run, null);
    return true;
  }
  return { runSpeedTestForSpot, cancelSpeedTest };
}

const controller = typeof window === 'undefined' ? null : createSpeedTestController();
export const runSpeedTestForSpot = (...args) => controller.runSpeedTestForSpot(...args);
export const cancelSpeedTest = () => controller.cancelSpeedTest();
if (typeof window !== 'undefined') Object.assign(window, { runSpeedTestForSpot, cancelSpeedTest });
