import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSpeedTestController } from '../speedtest.js';

test('reports engine results with correct units and network', async () => {
  const target = new EventTarget(); let event;
  target.addEventListener('speedtest-result', e => event = e.detail);
  class Fake { constructor(options) { assert.equal(options.autoStart, false); assert.equal(options.measureUploadLoadedLatency, true); } play() { this.onFinish({getSummary: () => ({download: 123000000, upload: 20000000, latency: 8, downLoadedLatency: 30, upLoadedLatency: 45, totalDurationMs: 2000}), getScores: () => ({})}); } }
  const controller = createSpeedTestController({target, load: async () => Fake, confirm: () => true, now: () => 0, userAgent: () => 'test'});
  const result = await controller.runSpeedTestForSpot({spotId:'s', network:'b'});
  assert.equal(result, event); assert.equal(result.down, 123); assert.equal(result.up, 20); assert.equal(result.ping, 8); assert.equal(result.loaded, 45); assert.equal(result.network, 'b'); assert.equal(result.details.summary.download, 123000000);
});

test('cancellation stops a running test without a result', async () => {
  const target = new EventTarget(); let count = 0; let paused = false;
  target.addEventListener('speedtest-result', () => count++);
  class Fake { play() {} pause() { paused = true; } }
  const controller = createSpeedTestController({target, load: async () => Fake, confirm: () => true});
  const pending = controller.runSpeedTestForSpot({spotId:'s',network:'a'});
  await Promise.resolve(); assert.equal(controller.cancelSpeedTest(), true); assert.equal(await pending, null); assert.equal(paused, true); assert.equal(count, 0);
});

test('a quick test emits live readings before its final result', async () => {
  const target = new EventTarget();
  const updates = [];
  target.addEventListener('speedtest-progress', event => updates.push(event.detail));
  class Fake {
    results = { getSummary: () => ({ download: 50000000, latency: 12, downLoadedLatency: 0 }) };
    play() {
      this.onResultsChange({ type: 'download' });
      this.onFinish({ getSummary: () => ({ download: 60000000, upload: 10000000, latency: 12 }) });
    }
  }
  const controller = createSpeedTestController({ target, load: async () => Fake, confirm: () => true, userAgent: () => 'test' });
  const result = await controller.runSpeedTestForSpot({ spotId: null, network: 'a' });
  assert.deepEqual(updates.map(({ down, up, ping, loaded }) => ({ down, up, ping, loaded })), [
    { down: 50, up: null, ping: 12, loaded: null },
  ]);
  assert.equal(result.spotId, null);
  assert.equal(result.down, 60);
});
