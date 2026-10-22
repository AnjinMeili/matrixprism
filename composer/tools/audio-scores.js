// Scores for the audio comparison (T26): what an analysis reported, frame by
// frame, against the answer a test signal or a tag gives.
import { camelotKey } from '../public/key-detector.js';

// Matches detected beat times to true ones, each used once, within `window`
// seconds. Returns precision, recall, their F-measure, and the mean offset
// in seconds of the matched beats (positive when detection is late).
export function beatScore(detected, truth, window = 0.07) {
  let matched = 0, offsets = 0, j = 0;
  for (const time of detected) {
    while (j < truth.length && truth[j] < time - window) ++j;
    if (j < truth.length && Math.abs(truth[j] - time) <= window) {
      ++matched;
      offsets += time - truth[j];
      ++j;
    }
  }
  const precision = detected.length ? matched / detected.length : 0;
  const recall = truth.length ? matched / truth.length : 0;
  return {
    precision, recall, matched,
    f: precision + recall ? 2 * precision * recall / (precision + recall) : 0,
    offset: matched ? offsets / matched : null,
  };
}

// How a reported BPM relates to the true one: right within `tolerance`, or
// off by an octave (double, half) or a 3:2 ratio, or wrong, or none.
export function bpmVerdict(bpm, truth, tolerance = 0.02) {
  if (bpm === null || bpm === undefined || !Number.isFinite(bpm)) return 'none';
  const near = (ratio) => Math.abs(bpm / truth / ratio - 1) <= tolerance;
  if (near(1)) return 'right';
  if (near(2)) return 'double';
  if (near(0.5)) return 'half';
  if (near(1.5) || near(2 / 3)) return 'three-two';
  return 'wrong';
}

// The first time in [from, to) after which every reported BPM is within
// `tolerance` of the truth, or null if it never settles there.
export function lockTime(times, bpms, truth, from = 0, to = Infinity, tolerance = 0.02) {
  let lock = null;
  for (let i = 0; i < times.length; ++i) {
    if (times[i] < from || times[i] >= to) continue;
    if (bpmVerdict(bpms[i], truth, tolerance) === 'right') lock ??= times[i];
    else lock = null;
  }
  return lock;
}

// How a key relates to the true one: exact; a neighbour on the Camelot wheel
// (a fifth); the relative major or minor; the parallel one (same tonic); any
// other; or none.
export function keyVerdict(key, truth) {
  if (!key) return 'none';
  if (key.tonic === truth.tonic && key.mode === truth.mode) return 'exact';
  const found = camelotKey(key.tonic, key.mode), wanted = camelotKey(truth.tonic, truth.mode);
  if (found.letter === wanted.letter && [1, 11].includes((found.number - wanted.number + 12) % 12))
    return 'fifth';
  if (found.number === wanted.number) return 'relative';
  if (key.tonic === truth.tonic) return 'parallel';
  return 'other';
}

// Changes of value per minute, counted from the first value that is not
// null; a change to or from null counts. Null if there was never a value.
export function changesPerMinute(times, values) {
  const first = values.findIndex((value) => value !== null);
  if (first < 0) return null;
  let changes = 0;
  for (let i = first + 1; i < values.length; ++i)
    if (values[i] !== values[i - 1]) ++changes;
  const minutes = (times[times.length - 1] - times[first]) / 60;
  return minutes > 0 ? changes / minutes : 0;
}

// Pearson correlation of two equal-length lists; null if either is constant.
export function correlation(a, b) {
  const n = a.length;
  const meanA = a.reduce((s, v) => s + v, 0) / n, meanB = b.reduce((s, v) => s + v, 0) / n;
  let ab = 0, aa = 0, bb = 0;
  for (let i = 0; i < n; ++i) {
    ab += (a[i] - meanA) * (b[i] - meanB);
    aa += (a[i] - meanA) ** 2;
    bb += (b[i] - meanB) ** 2;
  }
  return aa > 0 && bb > 0 ? ab / Math.sqrt(aa * bb) : null;
}

// The weighted key score used in MIREX key detection: 1 for the right key,
// 0.5 for a fifth, 0.3 for the relative, 0.2 for the parallel, else 0.
export const KEY_WEIGHTS = { exact: 1, fifth: 0.5, relative: 0.3, parallel: 0.2, other: 0, none: 0 };

// Real tracks (audio-tracks.html) report series of [time, value] pairs,
// recorded at each change. Key values are "tonic:mode", with ":held" when the
// key is only held.

// A series as [value, from, to] spans up to `end`.
export const spans = (series, end) => series.map(([t, value], i) => [value, t, series[i + 1]?.[0] ?? end]);

// A key value as { tonic, mode, held }, or null.
export const parseKeyValue = (value) => {
  if (!value) return null;
  const [tonic, mode, held] = value.split(':');
  return { tonic: Number(tonic), mode, held: held === 'held' };
};

// One key series summarised: the key reported for most of the time, the key
// at the end, when a key was first claimed (not held), the share of time with
// a claimed key, and changes of key per minute.
export function keySummary(series, end) {
  const time = new Map();
  let claimed = 0, first = null, changes = 0, previous = null;
  for (const [value, from, to] of spans(series, end)) {
    const key = parseKeyValue(value);
    if (!key) continue;
    const name = `${key.tonic}:${key.mode}`;
    time.set(name, (time.get(name) ?? 0) + to - from);
    if (!key.held) {
      claimed += to - from;
      first ??= from;
    }
    if (previous !== null && name !== previous) ++changes;
    previous = name;
  }
  const most = [...time.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  return {
    most: parseKeyValue(most), end: parseKeyValue(series[series.length - 1]?.[1]), first,
    claimed: end ? claimed / end : 0, changesPerMinute: end ? changes / (end / 60) : 0,
  };
}

// One BPM series summarised: the time-weighted median of the BPM reported,
// and the share of time it was within 2% of `truth`.
export function bpmSummary(series, end, truth) {
  const weighted = spans(series, end).filter(([bpm]) => bpm !== null).sort((a, b) => a[0] - b[0]);
  const total = weighted.reduce((s, [, from, to]) => s + to - from, 0);
  let running = 0, typical = null;
  for (const [bpm, from, to] of weighted) {
    running += to - from;
    if (running >= total / 2) { typical = bpm; break; }
  }
  const right = weighted.filter(([bpm]) => bpmVerdict(bpm, truth) === 'right')
    .reduce((s, [, from, to]) => s + to - from, 0);
  return { typical, verdict: bpmVerdict(typical, truth), rightShare: end ? right / end : 0 };
}

// Essentia run as it would run live, on sliding windows (audio-tracks.html):
// each value is [end time, result, confidence or strength], known at the end
// of its window.

// Tempo windows against the true BPM: the share within 2%; when the first
// right one came; the share right after it; the verdict for the median of the
// windows' BPMs; and the share right among windows at or above
// `confidence` and how many windows that keeps.
export function windowTempoSummary(values, truth, confidence = 1.8) {
  const right = values.map(([, bpm]) => bpmVerdict(bpm, truth) === 'right');
  const first = right.indexOf(true);
  const after = first < 0 ? [] : right.slice(first);
  const sure = values.map(([, , c], i) => [c >= confidence, right[i]]).filter(([kept]) => kept);
  const bpms = values.map(([, bpm]) => bpm).sort((a, b) => a - b);
  const share = (list) => list.length ? list.filter(Boolean).length / list.length : null;
  return {
    share: share(right), first: first < 0 ? null : values[first][0], afterFirst: share(after),
    verdict: bpmVerdict(bpms.length ? bpms[Math.floor(bpms.length / 2)] : null, truth),
    sureShare: share(sure.map(([, r]) => r)), sureKept: values.length ? sure.length / values.length : null,
  };
}

// Key windows against the true key: the share exact; the verdict for the key
// most windows give; changes of key per minute; and, counting only windows
// at or above `strength`, the share claimed and the share exact among them.
export function windowKeySummary(values, truth, parse, strength = 0.75) {
  const keys = values.map(([, key]) => parse(key));
  const verdicts = keys.map((key) => keyVerdict(key, truth));
  const counts = new Map();
  for (const [, key] of values) counts.set(key, (counts.get(key) ?? 0) + 1);
  const most = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  let changes = 0;
  for (let i = 1; i < values.length; ++i) if (values[i][1] !== values[i - 1][1]) ++changes;
  const minutes = values.length > 1 ? (values[values.length - 1][0] - values[0][0]) / 60 : 0;
  const claimed = values.map(([, , s], i) => [s >= strength, verdicts[i]]).filter(([kept]) => kept);
  return {
    share: values.length ? verdicts.filter((v) => v === 'exact').length / values.length : null,
    verdict: keyVerdict(parse(most), truth),
    changesPerMinute: minutes > 0 ? changes / minutes : 0,
    claimed: values.length ? claimed.length / values.length : null,
    claimedExact: claimed.length ? claimed.filter(([, v]) => v === 'exact').length / claimed.length : null,
  };
}

// How steady a tempo series stays through a track (Anjin, 2026-10-20:
// beat-counted changes "can vary widely depending on the texture of the
// track"), against `reference`, a tempo for the whole track such as
// Essentia's, or the series' own typical tempo when there is none. Shares are
// of the whole track, `end` seconds:
//   locked     a tempo was reported (not lost and back on the manual tempo);
//   right      within `tolerance` of the reference;
//   octave     within it of double or half the reference;
//   other      locked on anything else (4/3, 3/2 and the rest);
//   jumps      [time, from, to] for each change of more than `jump`;
//   longestOff the longest stretch not right, in seconds, and when it began.
export function tempoSteadiness(series, end, reference = null, { tolerance = 0.04, jump = 0.08 } = {}) {
  const parts = spans(series, end).filter(([, from, to]) => to > from);
  const weighted = parts.filter(([bpm]) => bpm !== null).sort((a, b) => a[0] - b[0]);
  const lockedTime = weighted.reduce((s, [, from, to]) => s + to - from, 0);
  let running = 0, typical = null;
  for (const [bpm, from, to] of weighted) {
    running += to - from;
    if (running >= lockedTime / 2) { typical = bpm; break; }
  }
  const truth = reference ?? typical;
  const near = (bpm, ratio) => bpm !== null && truth && Math.abs(bpm / truth / ratio - 1) <= tolerance;
  const time = (test) => parts.filter(([bpm]) => test(bpm)).reduce((s, [, from, to]) => s + to - from, 0);
  const right = time((bpm) => near(bpm, 1));
  const octave = time((bpm) => near(bpm, 2) || near(bpm, 0.5));
  const jumps = [];
  let previous = null;
  for (const [t, bpm] of series) {
    if (bpm === null) continue;
    if (previous !== null && Math.abs(bpm / previous - 1) > jump) jumps.push([t, previous, bpm]);
    previous = bpm;
  }
  let longestOff = { seconds: 0, from: null }, offFrom = null;
  for (const [bpm, from, to] of parts) {
    if (near(bpm, 1)) offFrom = null;
    else {
      offFrom ??= from;
      if (to - offFrom > longestOff.seconds) longestOff = { seconds: to - offFrom, from: offFrom };
    }
  }
  const share = (part) => (end > 0 ? part / end : 0);
  return {
    reference: truth, typical, locked: share(lockedTime), right: share(right), octave: share(octave),
    other: share(lockedTime - right - octave), jumps, longestOff,
  };
}
