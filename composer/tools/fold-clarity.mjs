#!/usr/bin/env node
// A measurement, not a check: how clearly each thing the beat graph could fold
// shows the beat (fold-measures.js), genre by genre. Each track is decoded
// with ffmpeg, its measures taken, and each folded at the track's tempo and
// 1% either side: a measure's contrast is how much better the true tempo
// lines its bars up. Prints a Markdown report.
//
//   node tools/fold-clarity.mjs --beatport <folder> [--per-genre 20]
//   node tools/fold-clarity.mjs --references <tempo-stability run.json> --folder <music folder>
//   node tools/fold-clarity.mjs --file <audio> --bpm 139.7 [--from 300 --to 720]
//
// The Beatport set's tempo is its label; a tempo-stability run gives
// Essentia's tempo for each whole track. --workers 8; --json <file> (save
// every track's figures); --from-json <file>. The audio is read where it is
// and nothing of it is written.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { MEASURES, contrast } from './fold-measures.js';

const RATE = 48000;

// In a worker: decode one track and score every measure.
function scoreTrack({ file, bpm, from, to }) {
  const args = ['-v', 'quiet', ...(from ? ['-ss', String(from)] : []), ...(to ? ['-to', String(to)] : []),
    '-i', file, '-ac', '1', '-ar', String(RATE), '-f', 'f32le', '-'];
  const bytes = execFileSync('ffmpeg', args, { maxBuffer: 2 ** 30 });
  const samples = new Float32Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.length / 4));
  return Object.fromEntries(Object.entries(MEASURES).map(([name, measure]) => [name, contrast(measure(samples, RATE), bpm)]));
}

if (!isMainThread) {
  parentPort.on('message', (job) => {
    try {
      parentPort.postMessage({ id: job.id, scores: scoreTrack(job) });
    } catch (error) {
      parentPort.postMessage({ id: job.id, error: String(error.message || error) });
    }
  });
} else {
  const { values } = parseArgs({
    options: {
      beatport: { type: 'string', default: '' },
      'per-genre': { type: 'string', default: '' },
      references: { type: 'string', default: '' },
      folder: { type: 'string', default: '' },
      file: { type: 'string', default: '' },
      bpm: { type: 'string', default: '' },
      from: { type: 'string', default: '' },
      to: { type: 'string', default: '' },
      workers: { type: 'string', default: '8' },
      json: { type: 'string', default: '' },
      'from-json': { type: 'string', default: '' },
    },
  });
  const median = (list) => {
    const sorted = list.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
    return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
  };
  const fixed = (v, d = 2) => (v === null || v === undefined ? '–' : v.toFixed(d));
  const table = (head, rows) => [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.join(' | ')} |`)].join('\n');
  const NAMES = Object.keys(MEASURES);

  async function tracksToRun() {
    if (values.file) return [{ id: path.basename(values.file), group: 'the file', file: values.file, bpm: Number(values.bpm),
      from: values.from, to: values.to }];
    if (values.beatport) {
      const { readBeatport } = await import('./beatport.mjs');
      const all = readBeatport(values.beatport).filter((t) => t.file && t.bpm).sort((a, b) => Number(a.id) - Number(b.id));
      const per = values['per-genre'] ? Number(values['per-genre']) : Infinity, counts = {};
      return all.filter((t) => (counts[t.genre] = (counts[t.genre] ?? 0) + 1) <= per)
        .map((t) => ({ id: t.id, group: t.genre || 'no genre', file: t.file, bpm: t.bpm }));
    }
    if (values.references) {
      const run = JSON.parse(fs.readFileSync(values.references, 'utf8'));
      return run.tracks.filter((t) => !t.error && t.reference).map((t) => ({
        id: t.id, group: t.id.split('/')[0], file: path.join(values.folder, t.id), bpm: t.reference }));
    }
    throw new Error('Give --beatport <folder>, --references <run.json> --folder <folder>, or --file <audio> --bpm N.');
  }

  async function run(tracks) {
    const results = new Map(), started = Date.now();
    const count = Math.max(1, Math.min(Number(values.workers), os.cpus().length, tracks.length));
    let next = 0;
    await Promise.all(Array.from({ length: count }, () => new Promise((resolve) => {
      const worker = new Worker(new URL(import.meta.url));
      const send = () => {
        if (next >= tracks.length) { worker.terminate(); resolve(); return; }
        const { id, file, bpm, from, to } = tracks[next++];
        worker.postMessage({ id, file, bpm, from, to });
      };
      worker.on('message', (result) => {
        results.set(result.id, result);
        if (results.size % 25 === 0 || results.size === tracks.length)
          console.error(`${results.size} of ${tracks.length} tracks, ${Math.round((Date.now() - started) / 1000)} s`);
        send();
      });
      send();
    })));
    return { seconds: (Date.now() - started) / 1000,
      tracks: tracks.map((t) => ({ id: t.id, group: t.group, bpm: t.bpm, ...results.get(t.id) })) };
  }

  try {
    const data = values['from-json'] ? JSON.parse(fs.readFileSync(values['from-json'], 'utf8')) : await run(await tracksToRun());
    if (values.json) fs.writeFileSync(values.json, JSON.stringify(data));
    const ok = data.tracks.filter((t) => t.scores), failed = data.tracks.filter((t) => !t.scores);
    const groups = [...new Set(ok.map((t) => t.group))].sort();
    const best = (list) => NAMES.map((name) => list.filter((t) => NAMES.every((other) =>
      t.scores[name].contrast >= t.scores[other].contrast)).length);
    const rows = (list) => [
      ...NAMES.map((name) => fixed(median(list.map((t) => t.scores[name].contrast)))),
      ...best(list).map((n) => String(n)),
    ];
    const out = [
      `${ok.length} tracks in ${Math.round(data.seconds / 60)} minutes${failed.length ? `; ${failed.length} failed (${failed.slice(0, 3).map((f) => `${f.id}: ${f.error}`).join('; ')})` : ''}.`, '',
      'Each measure folded at the track\'s tempo into bars of 48 rows: "contrast" is the mean correlation of each bar ' +
        'with the one before at that tempo, less the higher of the same at 1% faster and slower. The more, the more ' +
        'clearly the right tempo stands out. "Best" counts the tracks on which that measure had the highest contrast.', '',
      table(['Group', 'Tracks', ...NAMES.map((n) => `${n}: median contrast`), ...NAMES.map((n) => `${n}: best`)],
        [...groups.map((g) => {
          const list = ok.filter((t) => t.group === g);
          return [g, String(list.length), ...rows(list)];
        }), ['**All**', String(ok.length), ...rows(ok)]]), '',
      table(['Group', ...NAMES.map((n) => `${n}: median right`)],
        [...groups, null].map((g) => {
          const list = g === null ? ok : ok.filter((t) => t.group === g);
          return [g ?? '**All**', ...NAMES.map((name) => fixed(median(list.map((t) => t.scores[name].right))))];
        })),
    ];
    console.log(out.join('\n'));
  } catch (error) {
    console.error(error.stack || error.message);
    process.exit(2);
  }
}
