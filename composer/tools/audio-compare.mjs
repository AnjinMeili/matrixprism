#!/usr/bin/env node
// Compares the composer's audio analysis with the known answers of synthetic
// test signals (T26; see docs/audio-features-plan.md). Each signal in
// audio-signals.js is played through an OfflineAudioContext in headless
// Chrome (audio-compare.html), read every frame by analysers set up as the
// composer's, and analysed by the composer's own code. Run with
// `npm run compare-audio`; it prints a Markdown report.
//
// Options: --source bass|flux (the composer's Beat from setting), --fps 30
// (the composer's frame rate, which sets how often the
// analysers are read), --only id,id (signals to run), --json <file> (also
// write every frame of every signal there).
//
// Offline, a run gives the same figures every time on the same Chrome, apart
// from the timings under "Cost". It
// measures the analysis on clean synthetic signals only: not real music, a
// microphone or loopback input, or Safari.
import fs from 'node:fs';
import { parseArgs } from 'node:util';
import { runPagePosted } from './headless.mjs';
import { sweepHz } from './audio-signals.js';
import { beatScore, bpmVerdict, changesPerMinute, correlation, keyVerdict, lockTime } from './audio-scores.js';
import { camelotKey } from '../public/key-detector.js';

const { values } = parseArgs({
  options: {
    fps: { type: 'string', default: '30' },
    only: { type: 'string', default: '' },
    source: { type: 'string', default: 'bass' },
    json: { type: 'string', default: '' },
  },
});

const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const median = (list) => {
  const sorted = list.filter((v) => v !== null).sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
};
const mean = (list) => list.length ? list.reduce((s, v) => s + v, 0) / list.length : null;
const fixed = (value, digits = 1) => value === null || value === undefined ? '–' : value.toFixed(digits);
const ms = (seconds) => seconds === null ? '–' : `${Math.round(seconds * 1000)}`;
const keyName = (label) => {
  if (!label) return '–';
  const [tonic, mode] = label.split(':');
  return `${NOTES[tonic]} ${mode} (${camelotKey(Number(tonic), mode).label})`;
};
const parseKey = (label) => label ? { tonic: Number(label.split(':')[0]), mode: label.split(':')[1] } : null;
const table = (head, rows) => [
  `| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`,
  ...rows.map((row) => `| ${row.join(' | ')} |`),
].join('\n');
const timesWhere = (rows, column) => rows.t.filter((_, i) => rows[column][i] === 1);

function tempoSection(results) {
  const rows = results.map(({ id, truth, rows: r }) => {
    const last = r.t.length - 1;
    const final = truth.tempo[truth.tempo.length - 1].bpm;
    const locks = truth.tempo.map((segment, i) => {
      const to = truth.tempo[i + 1]?.from ?? Infinity;
      const lock = lockTime(r.t, r.bpm, segment.bpm, segment.from, to);
      return lock === null ? 'never' : fixed(lock - segment.from);
    });
    const onsets = beatScore(timesWhere(r, 'onset'), truth.beats);
    const clockBeats = timesWhere(r, 'clockBeat');
    const clock = beatScore(clockBeats, truth.beats);
    // The clock's beats once it first locked: its phase, apart from how soon.
    const locked = clockBeats.length ? beatScore(clockBeats, truth.beats.filter((b) => b >= clockBeats[0] - 0.07)) : null;
    return [id, truth.tempo.map((s) => s.bpm).join(' → '), fixed(r.bpm[last]),
      bpmVerdict(r.bpm[last], final), locks.join(' / '),
      fixed(onsets.f, 2), ms(onsets.offset), fixed(clock.f, 2), fixed(locked?.f, 2), ms(clock.offset)];
  });
  return table(['Signal', 'True BPM', 'Reported at end', 'Verdict', 'Settled after (s)',
    'Onset F', 'Onset lag (ms)', 'Clock beat F', 'Clock beat F once locked', 'Clock lag (ms)'], rows);
}

// The key at the end, its verdict and when a key was first claimed, from the
// composer's own chroma (`key`) or Meyda's through the same logic (`mKey`).
function keyResult(r, truth, column, heldColumn) {
  const last = r.t.length - 1;
  const first = r.t.find((_, i) => r[column][i] && !r[heldColumn][i]) ?? null;
  return { key: r[column][last], verdict: keyVerdict(parseKey(r[column][last]), truth.key), first };
}

function keySection(results) {
  const summary = (column, heldColumn) => {
    const found = results.map(({ truth, rows: r }) => keyResult(r, truth, column, heldColumn));
    const verdicts = {};
    found.forEach(({ verdict }) => { verdicts[verdict] = (verdicts[verdict] ?? 0) + 1; });
    const firsts = found.map((f) => f.first).filter((v) => v !== null);
    return `${Object.entries(verdicts).map(([verdict, count]) => `${verdict} ${count}`).join(', ')}, of ` +
      `${results.length}` + (firsts.length ? `; first key after ${fixed(Math.min(...firsts))} to ` +
      `${fixed(Math.max(...firsts))} s (median ${fixed(median(firsts))})` : '');
  };
  const rows = results.map(({ id, truth, rows: r }) => {
    const own = keyResult(r, truth, 'key', 'held'), meyda = keyResult(r, truth, 'mKey', 'mHeld');
    return [id.replace('chords-', ''), keyName(own.key), own.verdict, fixed(own.first),
      keyName(meyda.key), meyda.verdict, fixed(meyda.first)];
  });
  return [`Verdicts at the end of each signal. The composer's chroma: ${summary('key', 'held')}. ` +
    `Meyda's chroma: ${summary('mKey', 'mHeld')}.`, '',
  table(['Key played', 'Composer: key at end', 'Verdict', 'First key (s)',
    'Meyda chroma: key at end', 'Verdict', 'First key (s)'], rows)].join('\n');
}

function noKeySection(results) {
  const claimed = (r, column, heldColumn) =>
    `${Math.round(r[column].filter((key, i) => key && !r[heldColumn][i]).length / r.t.length * 100)}%`;
  const keys = (r, column) => [...new Set(r[column].filter(Boolean))].map(keyName).join(', ') || '–';
  const rows = results.map(({ id, rows: r }) => {
    const seconds = r.t[r.t.length - 1];
    return [id, fixed(seconds, 0), claimed(r, 'key', 'held'), keys(r, 'key'),
      claimed(r, 'mKey', 'mHeld'), keys(r, 'mKey'),
      fixed(r.onset.reduce((s, v) => s + v, 0) / seconds * 60), fixed(r.bpm[r.bpm.length - 1])];
  });
  return table(['Signal', 'Seconds', 'Composer: key claimed', 'Keys', 'Meyda chroma: key claimed', 'Keys',
    'Onsets per minute', 'BPM at end'], rows);
}

function fluxSection(results) {
  const rows = results.map(({ id, truth, rows: r }) => {
    const seconds = r.t[r.t.length - 1];
    const flux = { onsets: timesWhere(r, 'fluxOnset'), bpm: r.fluxBpm[r.fluxBpm.length - 1] };
    if (!truth.beats?.length)
      return [id, '–', '–', fixed(r.onset.reduce((s, v) => s + v, 0) / seconds * 60), '–',
        fixed(flux.onsets.length / seconds * 60), '–', '–', fixed(flux.bpm)];
    const final = truth.tempo[truth.tempo.length - 1].bpm;
    const bass = beatScore(timesWhere(r, 'onset'), truth.beats), fromFlux = beatScore(flux.onsets, truth.beats);
    const last = r.bpm.length - 1;
    return [id, truth.tempo.map((t) => t.bpm).join(' → '), fixed(bass.f, 2),
      fixed(r.onset.reduce((s, v) => s + v, 0) / seconds * 60), bpmVerdict(r.bpm[last], final),
      fixed(flux.onsets.length / seconds * 60), fixed(fromFlux.f, 2), ms(fromFlux.offset),
      `${fixed(flux.bpm)} (${bpmVerdict(flux.bpm, final)})`];
  });
  return table(['Signal', 'True BPM', 'Bass: onset F', 'Bass: onsets per minute', 'Bass: BPM verdict',
    'Flux: onsets per minute', 'Flux: onset F', 'Flux: lag (ms)', 'Flux: BPM at end'], rows);
}

function bandsSection(byId) {
  const parts = [];
  const sweep = byId.sweep;
  if (sweep) {
    const hz = sweep.rows.t.map((t) => sweepHz(sweep.truth.sweep, t));
    const rows = ['bass', 'mid', 'treble'].map((band) => {
      const value = sweep.rows[band];
      const peak = Math.max(...value);
      const above = hz.filter((_, i) => value[i] >= peak / 2);
      return [band, fixed(peak, 2), above.length ? `${Math.round(Math.min(...above))} to ${Math.round(Math.max(...above))}` : '–'];
    });
    parts.push('A sine sweeping from 30 Hz to 16 kHz at half full scale. The frequencies over which each band ' +
      'reads at least half its peak:', '', table(['Band', 'Peak', 'Half-peak range (Hz)'], rows));
  }
  const noise = ['noise-bass', 'noise-mid', 'noise-treble'].filter((id) => byId[id]);
  if (noise.length) {
    const rows = noise.map((id) => {
      const r = byId[id].rows, skip = Math.round(r.t.length / 6);
      const m = (band) => fixed(mean(r[band].slice(skip)), 2);
      return [`${id.slice(6)} (${byId[id].truth.band.join(' to ')} Hz)`, m('bass'), m('mid'), m('treble'), m('level')];
    });
    parts.push('', 'Noise confined to one band, at an RMS of 0.2. The mean of each band once settled:', '',
      table(['Noise in', 'bass', 'mid', 'treble', 'level'], rows));
  }
  const levels = byId.levels;
  if (levels) {
    const { dbfs, stepSeconds } = levels.truth.levels;
    const rows = dbfs.map((db, step) => {
      const r = levels.rows;
      const inside = r.t.map((t, i) => t > step * stepSeconds + 0.5 && t < (step + 1) * stepSeconds ? r.level[i] : null)
        .filter((v) => v !== null);
      const expected = Math.min(1, 2 * 10 ** (db / 20) / Math.SQRT2);
      return [`${db}`, fixed(expected, 3), fixed(mean(inside), 3)];
    });
    parts.push('', 'A 1 kHz sine stepping down in level. `level` is twice the RMS of 256 samples of the ' +
      'waveform, capped at 1, so a sine at full scale reads 1:', '',
      table(['dBFS', 'Expected level', 'Mean level reported'], rows));
  }
  return parts.join('\n');
}

function featuresSection(byId, results) {
  const parts = [];
  const sweep = byId.sweep;
  if (sweep) {
    const r = sweep.rows;
    // Skip the first half second, while the analyser fills.
    const keep = r.t.map((t) => t > 0.5);
    const hz = r.t.map((t) => sweepHz(sweep.truth.sweep, t)).filter((_, i) => keep[i]);
    const pick = (column) => r[column].filter((_, i) => keep[i]);
    const row = (name, list, scale = 1) => {
      const ratios = list.map((v, i) => v * scale / hz[i]);
      return [name, fixed(correlation(list.map((v) => Math.log(Math.max(1, v * scale))), hz.map(Math.log)), 3),
        fixed(median(ratios), 2), fixed(Math.min(...ratios), 2), fixed(Math.max(...ratios), 2)];
    };
    parts.push('Against the sweep\'s true frequency: correlation in log frequency, and the ratio to the true ' +
      'frequency (1 is exact). Zero-crossing rate is scaled by half the sample rate to read in Hz:', '',
      table(['Feature', 'Correlation', 'Median ratio', 'Lowest ratio', 'Highest ratio'], [
        row('centroid', pick('centroid')), row('Meyda centroid', pick('mCentroid')),
        row('rolloff (85%)', pick('rolloff')), row('Meyda rolloff (99%)', pick('mRolloff')),
        row('zero crossings', pick('zcr'), 24000), row('Meyda zero crossings', pick('mZcr'), 24000)]));
  }
  const flat = ['sweep', 'levels', 'chords-C-major', 'white-noise', 'noise-treble', 'drums-125']
    .filter((id) => byId[id]).map((id) => {
      const of = (column) => {
        const value = median(byId[id].rows[column].filter((v) => v > 0));
        return value === null ? '–' : value.toPrecision(2);
      };
      return [id, of('flatness'), of('mFlatness')];
    });
  if (flat.length)
    parts.push('', 'Median flatness (frames of silence left out); it should be near 0 for tones and high for noise:', '',
      table(['Signal', 'Flatness', 'Meyda flatness'], flat));
  const clicks = results.filter((r) => r.id.startsWith('click-'));
  if (clicks.length) {
    // Flux in the 70 ms after each true beat, against the frames between.
    const ratios = clicks.map(({ truth, rows: r }) => {
      const on = [], off = [];
      r.flux.forEach((v, i) => (truth.beats.some((b) => r.t[i] >= b && r.t[i] < b + 0.07) ? on : off).push(v));
      return mean(on) / Math.max(1e-12, mean(off));
    });
    parts.push('', `Flux in the 70 ms after each kick is ${fixed(Math.min(...ratios))} to ` +
      `${fixed(Math.max(...ratios))} times its mean on the other frames, over the ${clicks.length} click tracks.`);
  }
  return parts.join('\n');
}

// How closely Meyda's features follow the hand-written ones, over every frame
// of every signal where both have a value and there is sound.
function agreementSection(results, errors) {
  const pairs = [['centroid', 'mCentroid'], ['flatness', 'mFlatness'], ['rolloff', 'mRolloff'],
    ['zcr', 'mZcr'], ['level', 'mRms']];
  const rows = pairs.map(([own, theirs]) => {
    const a = [], b = [];
    for (const { rows: r } of results)
      r.t.forEach((_, i) => {
        if (r.level[i] > 0.01 && r[own][i] !== null && r[theirs][i] !== null) {
          a.push(r[own][i]);
          b.push(r[theirs][i]);
        }
      });
    return [`${own} and Meyda's ${theirs.slice(1).toLowerCase()}`, String(a.length), fixed(correlation(a, b), 3),
      fixed(median(b.map((v, i) => a[i] ? v / a[i] : null)), 3)];
  });
  const parts = [table(['Pair', 'Frames', 'Correlation', 'Median ratio, Meyda to ours'], rows)];
  for (const [feature, message] of Object.entries(errors ?? {}))
    parts.push('', `Meyda's \`${feature}\` failed on every frame: "${message}".`);
  return parts.join('\n');
}

// High-band hits (T30): against the true hat times where a signal has
// them, as a rate where it has none, with where in the band they fell and
// the air.
function highsSection(results, byId) {
  const window = 0.05;
  const parts = [];
  const withHits = results.filter((r) => r.truth.hits);
  const seconds = (r) => r.rows.t[r.rows.t.length - 1];
  if (withHits.length) {
    const rows = withHits.map(({ id, truth, rows: r }) => {
      const found = timesWhere(r, 'highHit');
      const score = beatScore(found, truth.hits, window);
      const strengths = r.highStrength.filter((v) => v > 0);
      return [id, fixed(truth.hits.length / seconds({ rows: r })), fixed(found.length / seconds({ rows: r })),
        fixed(score.f, 2), fixed(score.precision, 2), fixed(score.recall, 2), ms(score.offset), fixed(median(strengths), 2)];
    });
    parts.push(`Against the true hit times, each matched once within ${window * 1000} ms. Lag is the mean offset of ` +
      'the matched hits (positive is late); strength is the median over the hits found.', '',
      table(['Signal', 'True hits a second', 'Found a second', 'F', 'Precision', 'Recall', 'Lag (ms)',
        'Median strength'], rows));
  }
  const offbeat = byId['hats-offbeat-124'];
  if (offbeat) {
    const found = timesWhere(offbeat.rows, 'highHit');
    const atKicks = offbeat.truth.beats.filter((b) => found.some((t) => Math.abs(t - b) <= window)).length;
    parts.push('', `On \`hats-offbeat-124\`, where only the off-beats have hats, ${atKicks} of the ` +
      `${offbeat.truth.beats.length} kicks also gave a hit.`);
  }
  const places = byId['hats-places-120'];
  if (places) {
    const r = places.rows, low = [], high = [];
    places.truth.hits.forEach((time, i) => {
      const j = r.t.findIndex((t, k) => r.highHit[k] === 1 && Math.abs(t - time) <= window);
      if (j >= 0) (places.truth.places[i] === 'high' ? high : low).push(r.highPlace[j]);
    });
    parts.push('', `Where in 4–16 kHz the hits fell (\`highPlace\`, 0 at 4 kHz, 1 at 16 kHz) on ` +
      `\`hats-places-120\`: median ${fixed(median(low), 2)} for the ticks at 4–6 kHz (${low.length} found) and ` +
      `${fixed(median(high), 2)} for those at 11–15 kHz (${high.length} found). On a log scale 5 kHz is at ` +
      `${fixed(Math.log(5 / 4) / Math.log(4), 2)} and 13 kHz at ${fixed(Math.log(13 / 4) / Math.log(4), 2)}.`);
  }
  const quiet = ['click-120', 'chords-C-major', 'silence', 'white-noise', 'noise-bass', 'noise-mid', 'noise-treble', 'sweep']
    .filter((id) => byId[id]);
  if (quiet.length) {
    const rows = quiet.map((id) => {
      const r = byId[id].rows;
      return [id, fixed(r.highHit.reduce((sum, v) => sum + v, 0) / seconds(byId[id]) * 60)];
    });
    parts.push('', 'Signals with no hats, where every hit is a false one. `click-120` is a kick alone:', '',
      table(['Signal', 'Hits a minute'], rows));
  }
  const airIds = ['silence', 'white-noise', 'noise-bass', 'noise-mid', 'noise-treble', 'chords-C-major', 'drums-125',
    'hats-16ths-128', 'shaker-chords-100'].filter((id) => byId[id]);
  if (airIds.length) {
    const rows = airIds.map((id) => {
      const r = byId[id].rows, skip = Math.round(r.t.length / 6);
      return [id, fixed(median(r.air.slice(skip)), 3)];
    });
    parts.push('', '`air` is the share of the unsmoothed spectrum\'s magnitude in 4–16 kHz, smoothed over 0.3 s. ' +
      'The bins are evenly spaced in frequency, so white noise puts about half its magnitude there. The median ' +
      'once settled:', '', table(['Signal', 'Median air'], rows));
  }
  return parts.join('\n');
}

function costSection(results) {
  const all = (column) => results.flatMap((r) => r.rows[column]);
  const analyse = all('analyseMs'), features = all('featuresMs');
  return table(['Step', 'Mean ms per frame', 'Highest ms'], [
    ['`analyse()` and the tempo tracker', fixed(mean(analyse), 3), fixed(Math.max(...analyse), 2)],
    ['The five hand-written features', fixed(mean(features), 3), fixed(Math.max(...features), 2)],
    ['Meyda: rms, zcr, centroid, flatness, rolloff, loudness, sharpness and MFCC (2048 samples)',
      fixed(mean(all('meydaMs')), 3), fixed(Math.max(...all('meydaMs')), 2)],
    ['Meyda: chroma (8192 samples) and the key logic', fixed(mean(all('chromaMs')), 3),
      fixed(Math.max(...all('chromaMs')), 2)],
  ]);
}

try {
  const query = new URLSearchParams({ fps: values.fps, source: values.source, ...(values.only ? { only: values.only } : {}) }).toString();
  const text = await runPagePosted('audio-compare.html', { query });
  if (text.startsWith('FAIL')) throw new Error(text);
  if (values.json) fs.writeFileSync(values.json, text);
  const data = JSON.parse(text);
  const byId = Object.fromEntries(data.results.map((r) => [r.id, r]));
  const group = (name) => data.results.filter((r) => r.group === name);
  const chrome = data.userAgent.match(/Chrome\/[\d.]+/)?.[0] ?? data.userAgent;
  const seconds = data.results.reduce((s, r) => s + r.rows.t[r.rows.t.length - 1], 0);
  const out = [
    `Run on ${new Date().toLocaleDateString('en-CA')} in headless ${chrome}: ${data.results.length} signals, ` +
    `${Math.round(seconds / 60)} minutes of audio at ${data.sampleRate} Hz, analysers read ${data.fps} times a second, ` +
    `beats from ${values.source}.`,
  ];
  if (group('tempo').length)
    out.push('', '## Tempo and beats', '',
      '"Settled after" is the time from the start of each tempo until the reported BPM stays within 2% to the end ' +
      'of it. Onsets are the composer\'s beat detections (`features.beat`); clock beats are the beats of its ' +
      'predicted beat clock while locked, which is what moves the patterns. F is the F-measure against the true ' +
      'beats within 70 ms; lag is the mean offset of the matched ones (positive is late).', '',
      tempoSection(group('tempo')));
  if (group('tempo').length)
    out.push('', '## Onsets from flux', '',
      'The composer\'s beat rule (a jump to 1.3 times the running average, at most one in 0.22 s) applied to ' +
      'the hand-written flux instead of the bass band, and a fresh tempo tracker fed with those onsets. ' +
      'Meyda\'s flux could not be tried (see "Meyda beside the hand-written features").', '',
      fluxSection([...group('tempo'), ...group('none')]));
  if (group('key').length)
    out.push('', '## Key', '', 'Chords I–IV–V–I (major) or i–iv–V–i (minor), two seconds each, for 16 seconds. ' +
      'Meyda\'s chroma is taken from the key analyser\'s 8192 samples and goes through the composer\'s own ' +
      'key logic (`KeyDetector.addChroma`), so only the chroma differs.', '',
      keySection(group('key')));
  const none = [...group('none'), ...group('tempo').filter((r) => r.id.startsWith('drums-'))];
  if (none.length)
    out.push('', '## Signals with no key', '', '"Claimed" excludes a key that is only held from before.', '',
      noKeySection(none));
  if (group('bands').length)
    out.push('', '## Bands and level', '', bandsSection(byId));
  if (group('highs').length)
    out.push('', '## High-band hits and air (T30)', '', highsSection(data.results, byId));
  if (byId.sweep || byId['white-noise'])
    out.push('', '## Hand-written features, and Meyda\'s', '', featuresSection(byId, data.results));
  out.push('', '## Meyda beside the hand-written features', '',
    'Over every frame with sound (level above 0.01) of every signal. Meyda\'s centroid is converted from bins ' +
    'to Hz and its zero crossings from a count to a rate. Its rolloff is at 99% where ours is at 85%, and its ' +
    'RMS is taken after its Hann window, against `level`, which is twice the RMS of the raw waveform.', '',
    agreementSection(data.results, data.meydaErrors));
  const meydaBytes = fs.statSync(new URL('./vendor/meyda/meyda.min.js', import.meta.url)).size;
  out.push('', '## Cost', '', 'Measured in the page with `performance.now()`, which Chrome coarsens to 0.1 ms or ' +
    `finer, so the means are more telling than single frames. Meyda's browser build is ` +
    `${Math.round(meydaBytes / 1024)} KB.`, '', costSection(data.results));
  console.log(out.join('\n'));
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
