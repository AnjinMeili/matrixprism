#!/usr/bin/env node
// Runs the audio comparison (T26) on real tracks: the composer's own analysis
// and Meyda's chroma, through the frame loop in audio-frames.js, in headless
// Chrome. For now it reads the Beatport EDM Key Dataset (see beatport.mjs),
// whose hand-made key labels are the reference for key and whose metadata
// gives Beatport's BPM for about half the tracks. Prints a Markdown report.
//
//   npm run compare-tracks -- --beatport <folder>
//
// Options: --sets clear,unsure,none (which of the dataset's sets to run; see
// readBeatport), --limit N (the first N tracks of those, by id), --workers 8
// (Chrome instances at once), --fps 30, --source bass|flux (the composer's
// Beat from setting), --gain 1.5 (the composer's Gain
// setting, by default its default), --json <file> (save every track's
// summary), --from-json <file> (report on saved summaries without running),
// --essentia (also run Essentia.js on each whole excerpt), --windows (with
// --essentia, also run it on sliding windows, as it would run live).
//
// The audio is served to Chrome from a local port only while the run lasts,
// and only the tracks listed; nothing from the dataset is written into the
// repository. Offline, a run gives the same figures every time on the same
// Chrome, apart from the timings.
import fs from 'node:fs';
import { parseArgs } from 'node:util';
import { runPagePosted } from './headless.mjs';
import { parseKey, readBeatport } from './beatport.mjs';
import { KEY_WEIGHTS, bpmSummary, bpmVerdict, keySummary, keyVerdict, windowKeySummary, windowTempoSummary }
  from './audio-scores.js';

const { values } = parseArgs({
  options: {
    beatport: { type: 'string', default: '' },
    sets: { type: 'string', default: 'clear,unsure,none' },
    limit: { type: 'string', default: '' },
    workers: { type: 'string', default: '8' },
    fps: { type: 'string', default: '30' },
    gain: { type: 'string', default: '1.5' },
    source: { type: 'string', default: 'bass' },
    essentia: { type: 'boolean', default: false },
    windows: { type: 'boolean', default: false },
    json: { type: 'string', default: '' },
    'from-json': { type: 'string', default: '' },
  },
});

const pct = (part, whole) => whole && part !== null && part !== undefined ? `${Math.round(part / whole * 100)}%` : '–';
const fixed = (value, digits = 1) => value === null || value === undefined || Number.isNaN(value) ? '–' : value.toFixed(digits);
const median = (list) => {
  const sorted = list.filter((v) => v !== null && v !== undefined).sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
};
const table = (head, rows) => [
  `| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`,
  ...rows.map((row) => `| ${row.join(' | ')} |`),
].join('\n');

const ESSENTIA_PROFILES = ['edma', 'bgate', 'krumhansl'];
const VERDICTS = ['exact', 'fifth', 'relative', 'parallel', 'other', 'none'];

function keyRows(entries) {
  return entries.map(([name, verdicts]) => {
    const count = (v) => verdicts.filter((x) => x === v).length;
    const score = verdicts.reduce((s, v) => s + KEY_WEIGHTS[v], 0) / verdicts.length;
    return [name, String(verdicts.length), ...VERDICTS.map((v) => pct(count(v), verdicts.length)), fixed(score, 3)];
  });
}
const KEY_HEAD = ['Source', 'Tracks', 'Exact', 'Fifth', 'Relative', 'Parallel', 'Other', 'None', 'Weighted score'];

function keySection(tracks) {
  const verdicts = (pick) => tracks.map((t) => keyVerdict(pick(t), t.key));
  const withBeatport = tracks.filter((t) => t.beatportKey);
  const parts = [table(KEY_HEAD, keyRows([
    ['Composer, key for most of the time', verdicts((t) => t.own.most)],
    ['Composer, key at the end', verdicts((t) => t.own.end)],
    ['Meyda chroma, key for most of the time', verdicts((t) => t.meyda.most)],
    ['Meyda chroma, key at the end', verdicts((t) => t.meyda.end)],
    ...ESSENTIA_PROFILES.filter(() => tracks.some((t) => t.essentia)).map((profile) =>
      [`Essentia KeyExtractor, ${profile} profile (whole excerpt)`,
        tracks.filter((t) => t.essentia).map((t) => keyVerdict(t.essentiaKeys[profile], t.key))]),
    ["Beatport's own key (reference)", withBeatport.map((t) => keyVerdict(t.beatportKey, t.key))],
  ]))];
  parts.push('', table(['Source', 'First key claimed (median s)', 'Time with a key claimed (median)',
    'Key changes per minute (median)'], [
    ['Composer', fixed(median(tracks.map((t) => t.own.first))), pct(median(tracks.map((t) => t.own.claimed)), 1),
      fixed(median(tracks.map((t) => t.own.changesPerMinute)))],
    ['Meyda chroma', fixed(median(tracks.map((t) => t.meyda.first))), pct(median(tracks.map((t) => t.meyda.claimed)), 1),
      fixed(median(tracks.map((t) => t.meyda.changesPerMinute)))],
  ]));
  return parts.join('\n');
}

function byGenre(tracks, columns) {
  const genres = [...new Set(tracks.map((t) => t.genre))].sort();
  return genres.map((genre) => {
    const group = tracks.filter((t) => t.genre === genre);
    return [genre, String(group.length), ...columns.map((column) => column(group))];
  });
}

function keyGenreSection(tracks) {
  const exact = (pick) => (group) => pct(group.filter((t) => keyVerdict(pick(t), t.key) === 'exact').length, group.length);
  const score = (pick) => (group) =>
    fixed(group.reduce((s, t) => s + KEY_WEIGHTS[keyVerdict(pick(t), t.key)], 0) / group.length, 2);
  const withEssentia = tracks.some((t) => t.essentia);
  return table(['Genre', 'Tracks', 'Composer exact', 'Composer score', 'Meyda exact', 'Meyda score',
    ...(withEssentia ? ['Essentia edma exact', 'Essentia edma score'] : [])],
  byGenre(tracks, [exact((t) => t.own.most), score((t) => t.own.most),
    exact((t) => t.meyda.most), score((t) => t.meyda.most),
    ...(withEssentia ? [exact((t) => t.essentiaKeys?.edma), score((t) => t.essentiaKeys?.edma)] : [])]));
}

// Essentia always names a key, with a strength; how its strength on tracks
// with no key compares with the clear tracks'.
function strengthSection(none, clear) {
  const quartiles = (list) => [0.25, 0.5, 0.75].map((p) => fixed(list.sort((a, b) => a - b)[Math.floor(p * list.length)], 2))
    .join(' / ');
  return table(['Essentia key strength (quartiles: 25% / median / 75%)', ...ESSENTIA_PROFILES],
    [['Tracks with no key', none], ['Clear tracks', clear]].map(([name, group]) =>
      [name, ...ESSENTIA_PROFILES.map((profile) =>
        quartiles(group.filter((t) => t.essentia).map((t) => t.essentia.keys[profile].strength)))]));
}

function noKeySection(tracks) {
  const row = (name, pick) => [name, String(tracks.length),
    pct(tracks.filter((t) => pick(t).first !== null).length, tracks.length),
    pct(median(tracks.map((t) => pick(t).claimed)), 1)];
  return table(['Source', 'Tracks', 'Tracks where a key was claimed', 'Time with a key claimed (median)'],
    [row('Composer', (t) => t.own), row('Meyda chroma', (t) => t.meyda)]);
}

function tempoSection(tracks, source) {
  const kinds = ['right', 'double', 'half', 'three-two', 'wrong', 'none'];
  const row = (name, pick) => [name, String(tracks.length),
    ...kinds.map((k) => pct(tracks.filter((t) => pick(t).verdict === k).length, tracks.length)),
    pct(median(tracks.map((t) => pick(t).rightShare)), 1)];
  return table(['Onsets from', 'Tracks', 'Right', 'Double', 'Half', '3:2', 'Wrong', 'None',
    'Time within 2% (median)'], [row(`The composer (beats from ${source})`, (t) => t.bassTempo),
    row('Flux, timed to the frame', (t) => t.fluxTempo),
    ...(tracks.every((t) => t.essentiaTempo) ? [row('Essentia RhythmExtractor2013 (whole excerpt)', (t) => t.essentiaTempo)] : [])]);
}

// Whether the bass band, which the composer's beats come from, has room to
// jump: its median, and the share of frames where it sits at its cap of 1.
function bassSection(tracks, source) {
  const quartiles = (list) => [0.25, 0.5, 0.75].map((p) => fixed(list.sort((a, b) => a - b)[Math.floor(p * list.length)], 2))
    .join(' / ');
  const perMinute = (pick) => quartiles(tracks.map((t) => pick(t) / t.seconds * 60));
  return table(['Over all tracks run (quartiles: 25% / median / 75%)', 'Value'], [
    ['Bass band, median over each track', quartiles(tracks.map((t) => t.bassMedian))],
    ['Share of frames with the bass band at its cap of 1', quartiles(tracks.map((t) => t.bassCapped))],
    [`The composer's onsets per minute (from ${source})`, perMinute((t) => t.onsets)],
    ['Flux onsets per minute, timed to the frame', perMinute((t) => t.fluxOnsets)],
  ]);
}

function tempoGenreSection(tracks, source) {
  const right = (pick) => (group) => pct(group.filter((t) => pick(t).verdict === 'right').length, group.length);
  const octave = (pick) => (group) =>
    pct(group.filter((t) => ['double', 'half'].includes(pick(t).verdict)).length, group.length);
  const bpms = (group) => `${Math.min(...group.map((t) => t.bpm))} to ${Math.max(...group.map((t) => t.bpm))}`;
  const withEssentia = tracks.every((t) => t.essentiaTempo);
  return table(['Genre', 'Tracks', 'Beatport BPM', `Composer (${source}): right`, `Composer (${source}): double or half`, 'Flux: right',
    'Flux: double or half', ...(withEssentia ? ['Essentia: right', 'Essentia: double or half'] : [])],
  byGenre(tracks, [bpms, right((t) => t.bassTempo), octave((t) => t.bassTempo),
    right((t) => t.fluxTempo), octave((t) => t.fluxTempo),
    ...(withEssentia ? [right((t) => t.essentiaTempo), octave((t) => t.essentiaTempo)] : [])]));
}

// High-band hits and air (T30): their spread over the tracks, and by genre.
// There are no labels for hats, so this says how often sparkles would come,
// not whether each was a hat.
function highsSection(tracks) {
  const spread = (list) => [0.1, 0.25, 0.5, 0.75, 0.9].map((p) =>
    fixed(list.sort((a, b) => a - b)[Math.floor(p * list.length)], 2)).join(' / ');
  const rate = (t) => t.highs.hits / t.seconds;
  const rows = [
    ['Hits a second, over each track', spread(tracks.map(rate))],
    ['Hits a second, the busiest 10% of each track (2-second windows)', spread(tracks.map((t) => t.highs.rateHigh))],
    ['Share of time with no hit in the last 2 seconds', spread(tracks.map((t) => t.highs.silentShare))],
    ['Share of hits on a flux onset (all bands)', spread(tracks.filter((t) => t.highs.hits).map((t) => t.highs.onOnsets / t.highs.hits))],
    ['Median strength of the hits', spread(tracks.filter((t) => t.highs.hits).map((t) => t.highs.strength))],
    ['Median place of the hits (0 at 4 kHz, 1 at 16 kHz)', spread(tracks.filter((t) => t.highs.hits).map((t) => t.highs.place))],
    ['Air, median over each track', spread(tracks.map((t) => t.highs.air))],
    ['Air, 90th percentile over each track', spread(tracks.map((t) => t.highs.airHigh))],
  ];
  const bands = [[0, 0.5], [0.5, 2], [2, 4], [4, 8], [8, Infinity]];
  const counts = bands.map(([low, high]) => [`${low} to ${high === Infinity ? 'more' : high}`,
    pct(tracks.filter((t) => rate(t) >= low && rate(t) < high).length, tracks.length)]);
  return [table(['Over the tracks (10% / 25% / median / 75% / 90%)', 'Value'], rows), '',
    table(['Hits a second', 'Share of tracks'], counts), '', '### By genre', '',
    table(['Genre', 'Tracks', 'Hits a second (median)', 'Air (median)'],
      byGenre(tracks, [(g) => fixed(median(g.map(rate)), 1), (g) => fixed(median(g.map((t) => t.highs.air)), 3)]))].join('\n');
}

// Essentia as it would run live, from its sliding windows.
function windowSection(timed, clear) {
  const quartiles = (list) => {
    const sorted = list.filter((v) => v !== null).sort((a, b) => a - b);
    return sorted.length ? [0.25, 0.5, 0.75].map((p) => sorted[Math.floor(p * sorted.length)]) : [null, null, null];
  };
  const pcts = (list) => quartiles(list).map((v) => pct(v, 1)).join(' / ');
  const secs = (list) => quartiles(list).map((v) => fixed(v)).join(' / ');
  const tempo = timed.map((t) => windowTempoSummary(t.essentia.windows.tempo, t.bpm));
  const never = tempo.filter((w) => w.first === null).length;
  const key = clear.map((t) => windowKeySummary(t.essentia.windows.key, t.key, parseKey));
  const verdicts = (list) => VERDICTS.map((v) => pct(list.filter((w) => w.verdict === v).length, list.length));
  return [
    `Tempo: RhythmExtractor2013 on the last 10 seconds, every 2 seconds, on the ${timed.length} tracks with a ` +
    `Beatport BPM. Each window's result counts from the end of its window, when it would be known live. ` +
    `Figures are quartiles over the tracks: 25% / median / 75%.`, '',
    table(['Tempo windows', 'Value'], [
      ['Share of windows within 2%', pcts(tempo.map((w) => w.share))],
      ['First right window ends at (s)', secs(tempo.map((w) => w.first))],
      ['Tracks with no right window', pct(never, timed.length)],
      ['Share right after the first right window', pcts(tempo.map((w) => w.afterFirst))],
      ['Share right among windows with confidence 1.8 or more', pcts(tempo.map((w) => w.sureShare))],
      ['Share of windows with confidence 1.8 or more', pcts(tempo.map((w) => w.sureKept))],
    ]), '',
    table(['Median of the windows\' BPMs', 'Right', 'Double', 'Half', '3:2', 'Wrong', 'None'],
      [['Tracks', ...['right', 'double', 'half', 'three-two', 'wrong', 'none']
        .map((v) => pct(tempo.filter((w) => w.verdict === v).length, tempo.length))]]), '',
    `Key: KeyExtractor with the edma profile on the last 20 seconds, every 4 seconds, on the ${clear.length} ` +
    'clear tracks.', '',
    table(['Key windows', 'Value'], [
      ['Share of windows exact', pcts(key.map((w) => w.share))],
      ['Key changes per minute', secs(key.map((w) => w.changesPerMinute))],
      ['Share of windows with strength 0.75 or more', pcts(key.map((w) => w.claimed))],
      ['Share exact among them', pcts(key.map((w) => w.claimedExact))],
    ]), '',
    table(['Key most windows give', ...VERDICTS.map((v) => v[0].toUpperCase() + v.slice(1))], [['Tracks', ...verdicts(key)]]), '',
    table(['Essentia, per window', 'Mean ms'], [
      ['RhythmExtractor2013 on 10 s', fixed(timed.reduce((s, t) => s + t.essentia.windows.tempoMs, 0) / timed.length, 0)],
      ['KeyExtractor on 20 s', fixed(clear.reduce((s, t) => s + t.essentia.windows.keyMs, 0) / clear.length, 0)],
    ]),
  ].join('\n');
}

function featureSection(tracks) {
  const existing = ['level', 'bass', 'mid', 'treble'];
  const rows = Object.keys(tracks[0].correlations).map((feature) => {
    const of = (i) => median(tracks.map((t) => t.correlations[feature][i]).filter((v) => v !== null).map(Math.abs));
    const novel = tracks.filter((t) => Math.max(...t.correlations[feature].map((v) => Math.abs(v ?? 0))) < 0.8);
    return [feature, ...existing.map((_, i) => fixed(of(i), 2)), pct(novel.length, tracks.length)];
  });
  return table(['Feature', ...existing.map((e) => `|r| with ${e}`), 'Tracks where all are below 0.8'], rows);
}

async function run(tracks) {
  const workers = Math.max(1, Math.min(Number(values.workers), tracks.length));
  const summaries = [];
  let userAgent = '', meydaErrors = {};
  const started = Date.now();
  await Promise.all(Array.from({ length: workers }, async (_, w) => {
    const mine = tracks.map((track, index) => ({ track, index })).filter(({ index }) => index % workers === w);
    const files = new Map([['/data/list', Buffer.from(JSON.stringify(mine.map(({ track, index }) => ({ index, id: track.id }))))]]);
    for (const { track, index } of mine) files.set(`/data/${index}`, track.file);
    const result = await runPagePosted('audio-tracks.html', {
      query: `fps=${values.fps}&gain=${values.gain}&source=${values.source}&essentia=${values.essentia ? 1 : 0}&windows=${values.windows ? 1 : 0}`, files, timeoutMs: 6 * 3600 * 1000,
      onPost: (name, body) => {
        if (name !== 'track') return;
        summaries.push(JSON.parse(body));
        if (summaries.length % 50 === 0 || summaries.length === tracks.length)
          console.error(`${summaries.length} of ${tracks.length} tracks, ${Math.round((Date.now() - started) / 1000)} s`);
      },
    });
    if (result.startsWith('FAIL')) throw new Error(result);
    ({ userAgent, meydaErrors } = JSON.parse(result));
  }));
  return { fps: Number(values.fps), gain: Number(values.gain), source: values.source, userAgent, meydaErrors, seconds: (Date.now() - started) / 1000, summaries };
}

try {
  if (!values.beatport) throw new Error('Give the dataset folder with --beatport <folder>.');
  const sets = values.sets.split(',');
  const all = readBeatport(values.beatport);
  let chosen = all.filter((t) => sets.includes(t.set) && t.file).sort((a, b) => Number(a.id) - Number(b.id));
  if (values.limit) chosen = chosen.slice(0, Number(values.limit));
  const data = values['from-json'] ? JSON.parse(fs.readFileSync(values['from-json'], 'utf8')) : await run(chosen);
  if (values.json) fs.writeFileSync(values.json, JSON.stringify(data));

  const byId = new Map(all.map((t) => [t.id, t]));
  const failed = data.summaries.filter((s) => s.error);
  const tracks = data.summaries.filter((s) => !s.error).map((s) => {
    const t = { ...byId.get(s.id), ...s };
    t.own = keySummary(s.series.key, s.seconds);
    t.meyda = keySummary(s.series.mKey, s.seconds);
    if (s.essentia)
      t.essentiaKeys = Object.fromEntries(ESSENTIA_PROFILES.map((p) => [p, parseKey(s.essentia.keys[p].key)]));
    if (t.bpm) {
      t.bassTempo = bpmSummary(s.series.bpm, s.seconds, t.bpm);
      t.fluxTempo = bpmSummary(s.series.fluxBpm, s.seconds, t.bpm);
      if (s.essentia) t.essentiaTempo = { typical: s.essentia.bpm, verdict: bpmVerdict(s.essentia.bpm, t.bpm), rightShare: null };
    }
    return t;
  });
  const inSet = (set) => tracks.filter((t) => t.set === set);
  const hours = tracks.reduce((s, t) => s + t.seconds, 0) / 3600;
  const chrome = data.userAgent.match(/Chrome\/[\d.]+/)?.[0] ?? data.userAgent;
  const mean = (list) => list.reduce((s, v) => s + v, 0) / list.length;
  const out = [
    `Run on ${new Date().toLocaleDateString('en-CA')} in headless ${chrome}, ${data.fps} frames a second, ` +
    `gain ${data.gain ?? 1}, beats from ${data.source ?? 'bass'}: ` +
    `${tracks.length} tracks (${fixed(hours)} hours of audio) in ${Math.round(data.seconds / 60)} minutes` +
    (failed.length ? `; ${failed.length} failed (${failed.slice(0, 3).map((f) => `${f.id}: ${f.error}`).join('; ')})` : '') + '.',
  ];
  const clear = inSet('clear');
  if (clear.length)
    out.push('', '## Key: the clear tracks', '',
      'One major or minor key, no change, annotator\'s confidence 2. "Most of the time" is the key reported ' +
      'for the longest time, held or not; "at the end" is the key reported at the end of the excerpt. The ' +
      'weighted score is the MIREX one: 1 exact, 0.5 a fifth, 0.3 relative, 0.2 parallel. Beatport\'s own key ' +
      'is shown for the tracks whose metadata has one.', '', keySection(clear),
      '', '### By genre (key for most of the time)', '', keyGenreSection(clear));
  const unsure = inSet('unsure');
  if (unsure.length)
    out.push('', '## Key: the less certain tracks', '', 'As above, at the annotator\'s confidence 1.', '',
      keySection(unsure));
  const none = inSet('none');
  if (none.length)
    out.push('', '## Tracks labelled as having no key', '', '"Claimed" excludes a key that is only held.', '',
      noKeySection(none), ...(none.some((t) => t.essentia) ? ['', strengthSection(none, clear)] : []));
  const timed = tracks.filter((t) => t.bpm);
  if (timed.length)
    out.push('', '## Tempo against Beatport\'s BPM', '',
      'Every track run whose metadata gives a BPM. Beatport\'s BPM is for the whole track and these are ' +
      'two-minute excerpts from its middle, so a track that changes tempo can count against either. The ' +
      'verdict is for the time-weighted median of the BPM reported, within 2%. Flux onsets use the ' +
      'composer\'s beat rule on the hand-written flux, with a tempo tracker of their own.', '',
      tempoSection(timed, data.source ?? 'bass'), '', bassSection(tracks, data.source ?? 'bass'), '', '### By genre', '',
      tempoGenreSection(timed, data.source ?? 'bass'));
  if (timed.some((t) => t.essentia?.windows))
    out.push('', '## Essentia as it would run live', '',
      windowSection(timed.filter((t) => t.essentia?.windows), clear.filter((t) => t.essentia?.windows)));
  if (tracks.every((t) => t.highs))
    out.push('', '## High-band hits and air (T30)', '',
      'Hits are onsets in 4–16 kHz (`updateHighs` in `audio.js`), which make sparkles. The dataset has no ' +
      'labels for hats, so these figures say how often hits come on real music, not how many are right.', '',
      highsSection(tracks));
  out.push('', '## Do the new features add anything?', '',
    'For each track, the correlation over its frames between each hand-written feature and the composer\'s ' +
    'level and bands; the median of its size over the tracks, and the share of tracks where it is below 0.8 ' +
    'with all four, the plan\'s test for new information.', '', featureSection(tracks));
  out.push('', '## Cost', '', table(['Step', 'Mean ms per frame'], [
    ['`analyse()` and the tempo tracker', fixed(mean(tracks.map((t) => t.cost.analyseMs)), 3)],
    ['The five hand-written features', fixed(mean(tracks.map((t) => t.cost.featuresMs)), 3)],
    ['Meyda chroma (8192 samples) and the key logic', fixed(mean(tracks.map((t) => t.cost.chromaMs)), 3)],
  ]), ...(tracks.some((t) => t.essentia) ? ['', table(['Essentia, per excerpt of about 2 minutes', 'Mean ms'], [
    ['RhythmExtractor2013, multifeature', fixed(mean(tracks.filter((t) => t.essentia).map((t) => t.essentia.rhythmMs)), 0)],
    ['KeyExtractor, one profile', fixed(mean(tracks.filter((t) => t.essentia).map((t) => t.essentia.keyMs)), 0)],
  ])] : []));
  console.log(out.join('\n'));
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
