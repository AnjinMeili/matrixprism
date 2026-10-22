import assert from 'node:assert/strict';
import test from 'node:test';
import { LOG_COLUMNS, TempoMonitor, csvRow } from '../public/monitor.js';

// The Monitor view's data (T28): its trace, onset count and log.

const audioAt = (beat, highHits = 0) => ({
  spectrum: new Uint8Array(256).fill(100), wave: new Uint8Array(256).fill(128),
  features: { bass: 0.5, mid: 0.25, treble: 0.125, level: 0.4, beat, highHits, highRate: 4, air: 0.3 }, flux: 0.001,
});
const tempoAt = (seconds, detected = true) =>
  ({ bpm: 124, detected, confidence: 0.75, position: seconds * 124 / 60, beatInBar: 0 });

test('the trace keeps three minutes of tempo and the onsets in it', () => {
  const monitor = new TempoMonitor(16, 12);
  for (let n = 0; n <= 240 * 30; ++n) {
    const t = n / 30;
    monitor.update(t, tempoAt(t, t > 10), audioAt(n % 15 === 0 ? 1 : 0.2), 'flux');
  }
  assert.ok(monitor.trace[0][0] >= 60 - 0.5, 'nothing older than three minutes');
  assert.ok(Math.abs(monitor.trace.length - 360) <= 1, `${monitor.trace.length} points, one each half second`);
  assert.equal(monitor.trace.at(-1)[2], true);
  assert.equal(monitor.onsetsPerMinute(240), 120, 'an onset every half second');
  assert.equal(monitor.rgb.length, 16 * 12 * 3, 'the beat graph is drawn');
});

test('the log records ten rows a second while recording, as CSV', () => {
  const monitor = new TempoMonitor(16, 12);
  for (let n = 0; n < 30; ++n) monitor.update(n / 30, tempoAt(n / 30), audioAt(0.2), 'flux');
  assert.equal(monitor.rows.length, 0, 'nothing is logged until recording starts');
  monitor.setRecording(true);
  for (let n = 30; n < 90; ++n)
    monitor.update(n / 30, tempoAt(n / 30), audioAt(n % 15 === 0 ? 1 : 0.2, n % 5 === 0 ? 1 : 0), 'essentia');
  assert.ok(Math.abs(monitor.rows.length - 20) <= 1, `${monitor.rows.length} rows in two seconds`);
  const [header, first] = monitor.csv().split('\n');
  assert.equal(header, LOG_COLUMNS.join(','));
  const cells = first.split(',');
  assert.equal(cells.length, LOG_COLUMNS.length);
  assert.equal(cells[1], 'essentia');
  assert.equal(cells[2], '124');
  assert.equal(cells[3], '1');
  const onsets = monitor.rows.reduce((sum, row) => sum + Number(row.split(',')[6]), 0);
  assert.equal(onsets, 4, 'each onset counted once, in its row');
  const column = LOG_COLUMNS.indexOf('high_hits');
  const highHits = monitor.rows.reduce((sum, row) => sum + Number(row.split(',')[column]), 0);
  assert.equal(highHits, 12, 'each high hit counted once, in its row');
  assert.equal(cells[LOG_COLUMNS.indexOf('air')], '0.3');
  monitor.setRecording(false);
  monitor.update(3, tempoAt(3), audioAt(0.2), 'flux');
  const kept = monitor.rows.length;
  monitor.clearLog();
  assert.equal(monitor.rows.length, 0);
  assert.ok(kept > 0);
});

test('CSV cells are quoted when they need to be, and empty when unknown', () => {
  assert.equal(csvRow([1.234567, 'flux', null, NaN, 'a,b', 'say "hi"']), '1.2346,flux,,,"a,b","say ""hi"""');
});
