#!/usr/bin/env node
// A measurement, not a check: how steady the composer's tempo stays through
// whole tracks of Anjin's music, for each beat source, to find the
// tracks where it wanders (Anjin, 2026-10-20: beat-counted changes "can
// vary widely depending on the texture of the track"). It runs each track
// through the same page as compare-tracks (audio-tracks.html), offline in
// headless Chrome, once for each Beat from setting as it runs live: bass
// jumps (which pass also gives Essentia's tempo for the whole track, the
// reference), spectral flux and Essentia. The page's own flux tempo
// (fluxBpm) is not used: it is the T26 comparison's detector, timed to whole
// frames, not the live Spectral flux source. Prints a Markdown report, least
// steady tracks first.
//
//   node tools/tempo-stability.mjs --folder <music folder> [--albums 2] [--seed N]
//   node tools/tempo-stability.mjs --folder <music folder> --album "Annual 2016"
//   node tools/tempo-stability.mjs --file <audio file>[,<audio file>]
//
// Options: --albums N picks N album folders at random (the seed is printed,
// so a pick can be run again); --album <text> picks the folders whose names
// contain it (repeat with commas); --sources bass,flux,essentia (the passes
// to run; the first also gives the reference); --hold N (how many live
// Essentia estimates must agree to change the tempo, ESTIMATES_TO_CHANGE in
// tempo.js, by default the composer's); --three-two (2/3 and 3/2 agree with
// the tempo); --no-veto (spectral flux cannot stop a change, as before the
// veto was on; --veto, the composer's default, is kept for older runs);
// --limit N (the first N tracks); --workers 8;
// --fps 30; --gain 1.5; --tolerance 0.04; --json <file> (save every track's
// summary); --from-json <file> (report on saved summaries without running).
//
// The audio is read where it is and served to Chrome only while the run
// lasts; nothing of it is written anywhere. Keep the outputs outside the
// repository unless they hold only names and figures.
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { runPagePosted } from './headless.mjs';
import { tempoSteadiness } from './audio-scores.js';

const { values } = parseArgs({
  options: {
    folder: { type: 'string', default: '' },
    file: { type: 'string', default: '' },
    albums: { type: 'string', default: '1' },
    album: { type: 'string', default: '' },
    seed: { type: 'string', default: '' },
    limit: { type: 'string', default: '' },
    workers: { type: 'string', default: '8' },
    fps: { type: 'string', default: '30' },
    gain: { type: 'string', default: '1.5' },
    tolerance: { type: 'string', default: '0.04' },
    sources: { type: 'string', default: 'bass,flux,essentia' },
    hold: { type: 'string', default: '' },
    'three-two': { type: 'boolean', default: false },
    veto: { type: 'boolean', default: false },
    'no-veto': { type: 'boolean', default: false },
    json: { type: 'string', default: '' },
    'from-json': { type: 'string', default: '' },
  },
});

const AUDIO = /\.(flac|mp3|m4a|aac|wav|aiff?|ogg)$/i;
const pct = (share) => (share === null || share === undefined ? '–' : `${Math.round(share * 100)}%`);
const fixed = (value, digits = 1) => (value === null || value === undefined || Number.isNaN(value) ? '–' : value.toFixed(digits));
const clock = (seconds) => (seconds === null || seconds === undefined ? '–' :
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`);
const median = (list) => {
  const sorted = list.filter((v) => v !== null && v !== undefined).sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
};
const table = (head, rows) => [
  `| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`,
  ...rows.map((row) => `| ${row.map((cell) => String(cell).replace(/\|/g, '/')).join(' | ')} |`),
].join('\n');

// The same picks for the same seed.
function seeded(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

// Every audio file under `dir`, by path.
function audioFiles(dir) {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...audioFiles(full));
    else if (AUDIO.test(entry.name)) found.push(full);
  }
  return found.sort();
}

// The album folders to run: named with --album, or --albums of them at random.
function pickAlbums(folder) {
  const albums = fs.readdirSync(folder, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.')).map((entry) => entry.name).sort();
  if (values.album) {
    const wanted = values.album.split(',').map((text) => text.trim().toLowerCase()).filter(Boolean);
    const named = albums.filter((name) => wanted.some((text) => name.toLowerCase().includes(text)));
    if (!named.length) throw new Error(`No album folder matches ${values.album}.`);
    return { albums: named, seed: null };
  }
  const seed = values.seed ? Number(values.seed) : Math.floor(Math.random() * 1e9);
  const random = seeded(seed), pool = [...albums], chosen = [];
  while (chosen.length < Number(values.albums) && pool.length)
    chosen.push(pool.splice(Math.floor(random() * pool.length), 1)[0]);
  return { albums: chosen.sort(), seed };
}

// One pass of the page over the tracks with one beat source; resolves with
// each track's summary by id.
async function pass(tracks, source, essentia) {
  const workers = Math.max(1, Math.min(Number(values.workers), tracks.length));
  const summaries = new Map();
  const started = Date.now();
  let userAgent = '';
  await Promise.all(Array.from({ length: workers }, async (_, w) => {
    const mine = tracks.map((track, index) => ({ track, index })).filter(({ index }) => index % workers === w);
    const files = new Map([['/data/list', Buffer.from(JSON.stringify(mine.map(({ track, index }) => ({ index, id: track.id }))))]]);
    for (const { track, index } of mine) files.set(`/data/${index}`, track.file);
    const result = await runPagePosted('audio-tracks.html', {
      query: `fps=${values.fps}&gain=${values.gain}&source=${source}&essentia=${essentia ? 1 : 0}&windows=0` +
        (values.hold ? `&hold=${values.hold}` : '') + (values['three-two'] ? '&threeTwo=1' : '') +
        (values.veto ? '&veto=1' : '') + (values['no-veto'] ? '&veto=0' : ''),
      files, timeoutMs: 6 * 3600 * 1000,
      onPost: (name, body) => {
        if (name !== 'track') return;
        const summary = JSON.parse(body);
        summaries.set(summary.id, summary);
        console.error(`${source}: ${summaries.size} of ${tracks.length} tracks, ${Math.round((Date.now() - started) / 1000)} s`);
      },
    });
    if (result.startsWith('FAIL')) throw new Error(result);
    ({ userAgent } = JSON.parse(result));
  }));
  return { summaries, seconds: (Date.now() - started) / 1000, userAgent };
}

async function run() {
  if (!values.folder && !values.file) throw new Error('Give a music folder with --folder <folder>, or files with --file.');
  // Named files, such as a long mix; or album folders.
  const named = values.file ? values.file.split(',').map((file) => file.trim()).filter(Boolean) : null;
  const { albums, seed } = named ? { albums: [...new Set(named.map((file) => path.dirname(file)))], seed: null }
    : pickAlbums(values.folder);
  let tracks = named ? named.map((file) => ({ id: path.basename(file), file }))
    : albums.flatMap((album) => audioFiles(path.join(values.folder, album))
      .map((file) => ({ id: path.relative(values.folder, file), file })));
  if (values.limit) tracks = tracks.slice(0, Number(values.limit));
  if (!tracks.length) throw new Error(`No audio in ${albums.join(', ')}.`);
  console.error(`${tracks.length} tracks from ${albums.join('; ')}${seed === null ? '' : ` (seed ${seed})`}`);
  const sources = values.sources.split(',').map((source) => source.trim()).filter(Boolean);
  const passes = {};
  for (const [i, source] of sources.entries()) passes[source] = await pass(tracks, source, i === 0);
  const first = passes[sources[0]];
  return {
    albums, seed, sources, hold: values.hold ? Number(values.hold) : null,
    threeTwo: values['three-two'], veto: values['no-veto'] ? false : true,
    fps: Number(values.fps), gain: Number(values.gain), userAgent: first.userAgent,
    seconds: Object.values(passes).reduce((sum, p) => sum + p.seconds, 0),
    tracks: tracks.map(({ id }) => {
      const results = sources.map((source) => passes[source].summaries.get(id));
      const bad = results.find((r) => !r || r.error);
      if (bad !== undefined) return { id, error: bad?.error ?? 'no result' };
      const reference = results[0].essentia;
      return {
        id, seconds: results[0].seconds, reference: reference?.bpm ?? null, referenceConfidence: reference?.confidence ?? null,
        series: Object.fromEntries(sources.map((source, i) => [source, results[i].series.bpm])),
      };
    }),
  };
}

const ALL_SOURCES = [['bass', 'Bass jumps'], ['flux', 'Spectral flux'], ['essentia', 'Essentia, live']];

try {
  const data = values['from-json'] ? JSON.parse(fs.readFileSync(values['from-json'], 'utf8')) : await run();
  if (values.json) fs.writeFileSync(values.json, JSON.stringify(data));
  // Runs saved before --sources had all three.
  const SOURCES = ALL_SOURCES.filter(([source]) => (data.sources ?? ['bass', 'flux', 'essentia']).includes(source))
    .map(([source, name]) => [source, source !== 'essentia' ? name : `${name}${[data.hold && `${data.hold} to change`,
      data.threeTwo && '3:2 agrees', data.veto === false && 'no flux veto'].filter(Boolean).map((x) => ` (${x})`).join('')}`]);
  const has = (source) => SOURCES.some(([s]) => s === source);
  const tolerance = Number(values.tolerance);
  const failed = data.tracks.filter((t) => t.error);
  const tracks = data.tracks.filter((t) => !t.error).map((t) => ({
    ...t, scores: Object.fromEntries(SOURCES.map(([source]) =>
      [source, tempoSteadiness(t.series[source], t.seconds, t.reference, { tolerance })])),
  }));
  const hours = tracks.reduce((s, t) => s + t.seconds, 0) / 3600;
  const chrome = data.userAgent.match(/Chrome\/[\d.]+/)?.[0] ?? data.userAgent;
  const out = [
    `# Tempo steadiness: ${data.albums.join('; ')}`, '',
    `Run on ${new Date().toLocaleDateString('en-CA')} in headless ${chrome}, ${data.fps} frames a second, gain ${data.gain}` +
      `${data.seed === null || data.seed === undefined ? '' : `, albums picked at random with seed ${data.seed}`}: ` +
      `${tracks.length} tracks (${fixed(hours)} hours) in ${Math.round(data.seconds / 60)} minutes` +
      `${failed.length ? `; ${failed.length} failed (${failed.slice(0, 3).map((f) => `${f.id}: ${f.error}`).join('; ')})` : ''}.`, '',
    'The reference is Essentia\'s tempo for the whole track (RhythmExtractor2013). "Right" is the share of the ' +
      `track the tempo clock was within ${Math.round(tolerance * 100)}% of it; "octave", within that of double or ` +
      'half; "locked", the share with any detected tempo (the rest runs on the manual tempo). A jump is a change of ' +
      'more than 8%. A mixed album blends one track into the next, so its edges belong partly to the neighbours.', '',
    '## Overall', '',
    table(['Source', 'Median right', 'Tracks right over 80% of the time', 'Median locked', 'Median octave', 'Median jumps a track'],
      SOURCES.map(([source, name]) => {
        const s = tracks.map((t) => t.scores[source]);
        return [name, pct(median(s.map((x) => x.right))), pct(s.filter((x) => x.right > 0.8).length / tracks.length),
          pct(median(s.map((x) => x.locked))), pct(median(s.map((x) => x.octave))), fixed(median(s.map((x) => x.jumps.length)), 0)];
      })), '',
    '## Tracks, least steady first', '',
    'Ordered by live Essentia\'s "right", the steadiest source here. For each source: right / octave / jumps ' +
      '(typical BPM, the time-weighted median of what it reported), and the longest stretch live Essentia was ' +
      'not right, with when it began. Bass jumps rarely detects a tempo at all, so it shows mostly 0%.', '',
    table(['Track', 'Reference BPM', ...SOURCES.map(([, name]) => name), 'Longest off (live Essentia)'],
      [...tracks].sort((a, b) => (has('essentia') ? a.scores.essentia.right - b.scores.essentia.right : 0) ||
        (has('flux') ? a.scores.flux.right - b.scores.flux.right : 0)).map((t) => [
        t.id, fixed(t.reference),
        ...SOURCES.map(([source]) => {
          const s = t.scores[source];
          return `${pct(s.right)} / ${pct(s.octave)} / ${s.jumps.length} (${fixed(s.typical)})`;
        }),
        has('essentia') ? `${fixed(t.scores.essentia.longestOff.seconds, 0)} s from ${clock(t.scores.essentia.longestOff.from)}` : '–',
      ])),
  ];
  console.log(out.join('\n'));
} catch (error) {
  console.error(error.message);
  process.exit(2);
}
