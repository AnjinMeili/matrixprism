import assert from 'node:assert/strict';
import test from 'node:test';
import { FoldedHistory, SoundTrace, TRACE_RATE } from '../public/beat-fold.js';
import { WAVE_SECONDS } from '../public/beat-graph.js';

// A click track at `bpm` fed to a trace as the live input would be: at 60
// frames a second, each frame's 256-entry waveform covering the last
// WAVE_SECONDS, with a 5 ms click on every beat.
function clickTrace(bpm, seconds, trace = new SoundTrace()) {
  const beat = 60 / bpm, entry = WAVE_SECONDS / 256;
  const loud = (t) => t >= 0 && t % beat < 0.005;
  for (let frame = 0; frame <= seconds * 60; ++frame) {
    const t = frame / 60;
    const wave = new Uint8Array(256);
    for (let j = 0; j < 256; ++j) wave[j] = loud(t - (255 - j) * entry) ? (j % 2 ? 228 : 28) : 128;
    trace.feed({ audioTime: t, wave, spectrum: new Uint8Array(256).fill(100) });
  }
  return trace;
}

// The row of each finished bar where the energy is highest, oldest first.
function loudestRows(folded, bars) {
  const rows = [];
  for (let back = bars; back >= 1; --back) {
    const column = folded.column(back);
    let best = -1, at = null;
    for (let row = 0; row < folded.rows; ++row)
      if (column[row * 3 + 2] > best) [best, at] = [column[row * 3 + 2], row];
    rows.push(at);
  }
  return rows;
}

test('the trace keeps readings by time, and only the last of them', () => {
  const trace = clickTrace(120, 3, new SoundTrace(2));
  assert.equal(trace.size, 2 * TRACE_RATE);
  assert.equal(trace.next, Math.floor(3 * TRACE_RATE));
  assert.ok(!trace.has(trace.next - 2 * TRACE_RATE - 1) && trace.has(trace.next - 1));
  // A click is loud and the time between is quiet.
  const at = (time) => trace.energy[Math.floor(time * TRACE_RATE) % trace.size];
  assert.ok(at(2.001) > 0.5 && at(2.25) < 0.01, `${at(2.001)} ${at(2.25)}`);
});

test('folded at the right tempo the beats draw level lines; a little off, they slope', () => {
  const trace = clickTrace(128, 60);
  const right = loudestRows(new FoldedHistory(trace, { rows: 192, bars: 24 }).fold(128, 0), 20);
  assert.ok(right.every((row) => row === right[0]), `level: ${right.join(' ')}`);
  // At 130 the bar is shorter than the music's, so the beat comes later in
  // each bar than the one before, row by row.
  const off = loudestRows(new FoldedHistory(trace, { rows: 192, bars: 24 }).fold(130, 0), 20);
  const steps = off.slice(1).map((row, i) => (row - off[i] + 192) % 192);
  assert.ok(new Set(off).size > 10, `sloping: ${off.join(' ')}`);
  assert.ok(steps.filter((s) => s > 0 && s < 48).length >= 15, `steady drift: ${steps.join(' ')}`);
});

test('moving the bar line moves the rows the beats fall on', () => {
  const trace = clickTrace(120, 40);
  const at0 = loudestRows(new FoldedHistory(trace, { rows: 192, bars: 12 }).fold(120, 0), 8);
  // Half a beat later: the beats come half a beat earlier in each bar.
  const at = loudestRows(new FoldedHistory(trace, { rows: 192, bars: 12 }).fold(120, 0.25), 8);
  assert.ok(at0.every((row) => row === at0[0]) && at.every((row) => row === at[0]));
  assert.equal(((at0[0] - at[0]) + 192) % 192 % 48, 24, `${at0[0]} and ${at[0]}`);
});

test('flux taken a frame at a time is the same as over the whole recording', async () => {
  const { BandFlux, bandFluxReadings } = await import('../public/beat-fold.js');
  const rate = 48000, samples = new Float32Array(rate * 3);
  for (let i = 0; i < samples.length; ++i) samples[i] = (i % 24000 < 2000 ? 0.8 : 0.05) * Math.sin(i * 0.07) + 0.01 * Math.sin(i * 1.3);
  const whole = bandFluxReadings(samples, rate);
  const streaming = new BandFlux(rate), parts = [];
  for (let at = 0; at < samples.length;) {
    const n = 300 + (at % 1700);
    parts.push(...streaming.push(samples.subarray(at, at + n)));
    at += n;
  }
  assert.equal(whole.length, 3 * 200);
  assert.deepEqual(Float32Array.from(parts), whole);
  // Bursts start every 0.5 s (100 readings); reading 350 is between them.
  assert.ok(Math.max(...whole) > 1 && whole[350] < 0.5, `a rise at each loud burst (${Math.max(...whole)}), little between (${whole[350]})`);
});

test('through the Monitor, live flux readings fold at their own times: level at the tempo, a slope 1% off', async () => {
  const { TempoMonitor } = await import('../public/monitor.js');
  const { AudioAnalyzer } = await import('../public/audio.js');
  const { BandFlux } = await import('../public/band-flux.js');
  const rate = 48000, bpm = 125, beat = 60 / bpm;
  const monitor = new TempoMonitor(256, 192);
  // As the worklet would: flux from every sample, each reading queued with its
  // time. A 60 Hz kick on the beat under a loud, steady bass hum.
  const audio = { fluxQueue: [], takeFlux: AudioAnalyzer.prototype.takeFlux, spectrum: new Uint8Array(256).fill(100),
    wave: new Uint8Array(256).fill(128), features: { beat: 0 } };
  const flux = new BandFlux(rate), block = new Float32Array(rate / 60);
  const sample = (t) => (t % beat < 0.06 ? 0.7 * Math.sin(2 * Math.PI * 60 * (t % beat)) : 0) + 0.4 * Math.sin(2 * Math.PI * 45 * t);
  let taken = 0, readings = 0;
  for (let frame = 1; frame <= 45 * 60; ++frame) {
    const t = frame / 60;
    for (let i = 0; i < block.length; ++i) block[i] = sample((taken + i) / rate);
    // Each reading at the time its last sample was heard.
    for (const reading of flux.push(block)) audio.fluxQueue.push([++readings / 200, reading]);
    taken += block.length;
    monitor.update(t, { position: t / beat, bpm, detected: true, confidence: 1 }, audio, 'flux');
  }
  assert.equal(monitor.graph.history.feeder, monitor, 'fed from the Monitor only, while it has flux');
  const rows = (fold) => {
    const out = [];
    for (let back = 16; back >= 1; --back) {
      const column = fold.column(back);
      let best = -1, at = null;
      for (let row = 0; row < fold.rows; ++row) if (column[row * 3 + 2] > best) [best, at] = [column[row * 3 + 2], row];
      out.push(at % 48);
    }
    return out;
  };
  const most = (list) => Math.max(...list.map((row) => list.filter((r) => r === row).length));
  const right = rows(monitor.folded.fold(bpm, 0)), off = rows(monitor.folded.fold(bpm * 1.01, 0));
  assert.ok(most(right) >= 12, `level: ${right.join(' ')}`);
  assert.ok(most(off) <= 4, `sloping: ${off.join(' ')}`);
  // The clock's own graph, fed the same, stands level too.
  const live = [];
  for (let back = 16; back >= 1; --back) {
    const column = monitor.graph.history.column(back);
    let best = -1, at = null;
    for (let row = 0; row < 192; ++row) if (column[row * 3 + 2] > best) [best, at] = [column[row * 3 + 2], row];
    live.push(at % 48);
  }
  assert.ok(most(live) >= 12, `the clock's graph: ${live.join(' ')}`);
});
