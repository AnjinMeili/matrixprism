// The quad mixer's model (T16): four inputs, A to D; two pairs, Left (A and
// B) and Right (C and D); and the master, which mixes Left and Right for the
// stream. A whole look is all of that plus the shared look settings
// (look.js). Pure: no DOM, no renderer, so the rules are tested in Node.
//
// - An input is one pattern with its own Pattern settings (params.js), its
//   own brightness and gamma trim, applied before mixing, its shape and
//   region (shape.js), and its hue: null to follow the main's (the shared
//   Hue shift), or its own, 0 to 1 (Anjin, 2026-10-16). Settings are per input, not per pattern, since the
//   same pattern may want different settings on two inputs.
// - A pair is today's mixer without its pattern, which is now its second
//   input's: whether the second input is mixed in, the blend and the amount.
// - The master is a blend and a position from Left (0) to Right (1), the
//   fade, and blackout. Its changes reach the stream at once: Anjin had
//   a Gated mode (Take, Fade to live) removed on 2026-10-16.
// - The default look is a whole look the user can replace; Reset master loads
//   it. Until one is saved, it is plain patterns: each input keeps its
//   pattern with no effects, Left shows A alone, the master shows Left, and
//   the shared settings are their defaults.
//
// Settings saved before the quad mixer load into Left; Right stays as it is.
// Playlist entries and Hotsaves hold a pair or the whole quad (look actions,
// below) and load into either pair.
import { BLEND_MODES, blendModeIndex } from './mixer.js';
import { SHAPE_DEFAULTS, shapeSettings } from './shape.js';
import { QUANTIZE } from './tempo.js';
import { changedParams } from './params.js';
import { LOOK_DEFAULTS, lookSettings } from './look.js';

export const INPUT_IDS = ['a', 'b', 'c', 'd'];
export const PAIRS = { left: ['a', 'b'], right: ['c', 'd'] };
export const PAIR_IDS = Object.keys(PAIRS);
// Brightness and gamma trims on one input, before mixing. Gamma below 1
// lifts the darks of a pattern that is too dim.
export const INPUT_BRIGHTNESS_RANGE = [0, 1];
export const INPUT_GAMMA_RANGE = [0.5, 2.8];
export const MASTER_FADE_RANGE = [0, 10];
export const MASTER_FADE_STARTS = QUANTIZE.map((choice) => choice.id);
export const INPUT_DEFAULTS = { patternId: 'plasma', params: {}, brightness: 1, gamma: 1, hue: null, shape: SHAPE_DEFAULTS };
// A pair with its second input off shows its first input alone.
export const PAIR_DEFAULTS = { enabled: false, mode: 'crossfade', amount: 0.5 };
export const MASTER_DEFAULTS = {
  mode: 'crossfade', position: 0, fadeSeconds: 2, fadeStart: 'off', blackout: false,
};

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const inRange = (value, [low, high]) => Number.isFinite(value) && value >= low && value <= high;
const byId = (patterns) => new Map(patterns.map((pattern) => [pattern.id, pattern]));

// One input, checked. `patterns` is the pattern list (PATTERNS); a pattern it
// does not hold is an error, and the input's Pattern settings are kept only
// where they differ from that pattern's defaults.
export function inputSettings(value = INPUT_DEFAULTS, patterns = []) {
  if (!isObject(value)) throw new Error('An input must be an options object.');
  const result = { ...INPUT_DEFAULTS, ...value };
  const pattern = byId(patterns).get(result.patternId);
  if (patterns.length && !pattern) throw new Error(`Unknown input pattern: ${result.patternId}`);
  if (!isObject(result.params)) throw new Error('Input Pattern settings must be an options object.');
  if (!inRange(result.brightness, INPUT_BRIGHTNESS_RANGE))
    throw new Error(`Input brightness must be between ${INPUT_BRIGHTNESS_RANGE[0]} and ${INPUT_BRIGHTNESS_RANGE[1]}.`);
  if (!inRange(result.gamma, INPUT_GAMMA_RANGE))
    throw new Error(`Input gamma must be between ${INPUT_GAMMA_RANGE[0]} and ${INPUT_GAMMA_RANGE[1]}.`);
  if (result.hue !== null && !inRange(result.hue, [0, 1])) throw new Error('Input hue must be null (follow the main) or between 0 and 1.');
  return {
    patternId: result.patternId,
    params: pattern ? changedParams(pattern, result.params) : { ...result.params },
    brightness: result.brightness,
    gamma: result.gamma,
    hue: result.hue,
    shape: shapeSettings(result.shape),
  };
}

export function pairSettings(value = PAIR_DEFAULTS) {
  if (!isObject(value)) throw new Error('A pair must be an options object.');
  const result = { ...PAIR_DEFAULTS, ...value };
  if (typeof result.enabled !== 'boolean') throw new Error('Pair enabled must be true or false.');
  blendModeIndex(result.mode);
  if (!inRange(result.amount, [0, 1])) throw new Error('Pair amount must be between 0 and 1.');
  return { enabled: result.enabled, mode: result.mode, amount: result.amount };
}

export function masterSettings(value = MASTER_DEFAULTS) {
  if (!isObject(value)) throw new Error('The master must be an options object.');
  const result = { ...MASTER_DEFAULTS, ...value };
  blendModeIndex(result.mode);
  if (!inRange(result.position, [0, 1])) throw new Error('Master position must be between 0 and 1.');
  if (!inRange(result.fadeSeconds, MASTER_FADE_RANGE))
    throw new Error(`Master fade must be between ${MASTER_FADE_RANGE[0]} and ${MASTER_FADE_RANGE[1]} seconds.`);
  if (!MASTER_FADE_STARTS.includes(result.fadeStart)) throw new Error(`Unknown master fade start: ${result.fadeStart}`);
  if (typeof result.blackout !== 'boolean') throw new Error('Master blackout must be true or false.');
  return {
    mode: result.mode, position: result.position, fadeSeconds: result.fadeSeconds,
    fadeStart: result.fadeStart, blackout: result.blackout,
  };
}

// The mixer: four inputs, two pairs and the master, each checked. Inputs and
// pairs not given take their defaults.
export function quadSettings(value = {}, patterns = []) {
  if (!isObject(value)) throw new Error('Quad mixer settings must be an options object.');
  const inputs = isObject(value.inputs) ? value.inputs : {};
  const pairs = isObject(value.pairs) ? value.pairs : {};
  return {
    inputs: Object.fromEntries(INPUT_IDS.map((id) =>
      [id, inputSettings(inputs[id] ?? INPUT_DEFAULTS, patterns)])),
    pairs: Object.fromEntries(PAIR_IDS.map((id) => [id, pairSettings(pairs[id])])),
    master: masterSettings(value.master),
  };
}

// A whole look: the mixer and the shared look settings.
export function wholeLook(value = {}, patterns = []) {
  if (!isObject(value)) throw new Error('A look must be an options object.');
  return { ...quadSettings(value, patterns), shared: lookSettings(value.shared ?? LOOK_DEFAULTS) };
}

// The default look when none was saved: every input keeps its pattern with
// no effects, each pair shows its first input, the master shows Left in Live
// mix, and the shared settings are their defaults.
export function plainLook(current, patterns = []) {
  const look = wholeLook({}, patterns);
  for (const id of INPUT_IDS) look.inputs[id].patternId = current.inputs[id].patternId;
  return look;
}

// What Reset master loads: the saved default look, or the plain one.
export function defaultLook(saved, current, patterns = []) {
  return saved ? wholeLook(saved, patterns) : plainLook(current, patterns);
}

// What one input's Reset leaves: its pattern, with no effects.
export function resetInput(input) {
  return { ...INPUT_DEFAULTS, patternId: input.patternId };
}

// What one pair's Reset leaves: its first input alone, with a plain crossfade.
export function resetPair() {
  return { ...PAIR_DEFAULTS };
}

// Swap (Anjin, 2026-10-16: "each mixer should have a swap feature"): the
// two inputs of a pair, or Left and Right on the master, trade everything,
// and the fader moves so the picture stays, as Anjin chose. A crossfade's
// fader is a position, and a crossfade from B to A at 1 - x is the one from A
// to B at x, so the picture is exactly the same. A combine blend's fader is
// its strength, so it is kept; the picture then stays only at full strength
// with a blend that treats its two inputs alike (Add, Screen, Average,
// Multiply, Max, Min, Difference). Stencil and Overlay, which do not, change.
const isTransition = (mode) => BLEND_MODES[blendModeIndex(mode)].kind === 'transition';
export const swappedPosition = (mode, amount) => (isTransition(mode) ? 1 - amount : amount);

// A pair after its inputs swap. One showing its first input alone shows its
// second alone after, as a crossfade at full, so the picture stays.
export function swappedPair(pair) {
  if (!pair.enabled) return { enabled: true, mode: isTransition(pair.mode) ? pair.mode : 'crossfade', amount: 1 };
  return { ...pair, amount: swappedPosition(pair.mode, pair.amount) };
}

// A look (quad settings or a whole look) with one pair's inputs swapped, or
// with Left and Right swapped on the master ('master'): the inputs A and C,
// B and D, the pairs whole, and the master's position.
export function swapLook(look, which) {
  const { inputs, pairs, master } = look;
  if (which === 'master') {
    return {
      ...look,
      inputs: { a: inputs.c, b: inputs.d, c: inputs.a, d: inputs.b },
      pairs: { left: pairs.right, right: pairs.left },
      master: { ...master, position: swappedPosition(master.mode, master.position) },
    };
  }
  const [first, second] = PAIRS[which];
  return {
    ...look,
    inputs: { ...inputs, [first]: inputs[second], [second]: inputs[first] },
    pairs: { ...pairs, [which]: swappedPair(pairs[which]) },
  };
}

// The inputs whose places a swap exchanges, as [from, to] pairs.
export function swappedInputs(which) {
  if (which === 'master') return [['a', 'c'], ['b', 'd']];
  return [PAIRS[which]];
}

// Today's mixer as a pair: its pattern goes to the second input; what it
// does not say takes the pair's defaults.
function pairFromMixer(mixer) {
  return {
    enabled: mixer.enabled ?? PAIR_DEFAULTS.enabled,
    mode: mixer.mode ?? PAIR_DEFAULTS.mode,
    amount: mixer.amount ?? PAIR_DEFAULTS.amount,
  };
}

// The mixer from settings saved before the quad mixer: today's pattern,
// mixer, shapes and per-pattern parameters become Left; Right and the master
// take their defaults. Settings that already hold `quad` are only checked.
export function quadFromSettings(settings, patterns = []) {
  if (isObject(settings.quad)) return quadSettings(settings.quad, patterns);
  const params = isObject(settings.patternParams) ? settings.patternParams : {};
  const mixer = isObject(settings.mixer) ? settings.mixer : {};
  const shapes = isObject(settings.shapes) ? settings.shapes : {};
  const a = settings.patternId ?? INPUT_DEFAULTS.patternId;
  const b = mixer.patternId ?? INPUT_DEFAULTS.patternId;
  return quadSettings({
    inputs: {
      a: { patternId: a, params: params[a] ?? {}, shape: shapes.a ?? SHAPE_DEFAULTS },
      b: { patternId: b, params: params[b] ?? {}, shape: shapes.b ?? SHAPE_DEFAULTS },
    },
    pairs: { left: pairFromMixer(mixer) },
  }, patterns);
}

// ---------- Look actions: what a playlist entry shows (T73) ----------
//
// An entry's look is a pair (two inputs and the pair's mix) or the whole quad
// (four inputs and both pairs), with the shared look settings it was saved
// with. A pair look loads into either pair. An input in a look holds its
// pattern and whatever else it was saved with; what it does not hold stays
// as it is on the input it loads into, so entries saved before the quad keep
// their meaning. Loading never moves the main.

const inputPatch = (value, patternIds) => {
  if (!isObject(value)) throw new Error('An input in a look must be an options object.');
  if (typeof value.patternId !== 'string' || (patternIds && !patternIds.includes(value.patternId)))
    throw new Error(`Unknown look pattern: ${value.patternId}`);
  const patch = { patternId: value.patternId };
  if (value.params !== undefined) {
    if (!isObject(value.params)) throw new Error('Input Pattern settings must be an options object.');
    patch.params = JSON.parse(JSON.stringify(value.params));
  }
  if (value.shape !== undefined) patch.shape = shapeSettings(value.shape);
  if (value.brightness !== undefined) {
    if (!inRange(value.brightness, INPUT_BRIGHTNESS_RANGE)) throw new Error('Input brightness is out of range.');
    patch.brightness = value.brightness;
  }
  if (value.gamma !== undefined) {
    if (!inRange(value.gamma, INPUT_GAMMA_RANGE)) throw new Error('Input gamma is out of range.');
    patch.gamma = value.gamma;
  }
  if (value.hue !== undefined) {
    if (value.hue !== null && !inRange(value.hue, [0, 1])) throw new Error('Input hue is out of range.');
    patch.hue = value.hue;
  }
  return patch;
};

// A look action, checked: { kind: 'look', scope: 'pair', inputs: [first,
// second], pair, shared? } or { kind: 'look', scope: 'quad', inputs: { a, b,
// c, d }, pairs: { left, right }, master?, shared? }. The master is kept as
// a record of the save and never applied.
export function lookAction(value, patternIds = null) {
  if (!isObject(value) || value.kind !== 'look') throw new Error('A look action must be an options object of kind look.');
  const shared = value.shared === undefined ? {} : { shared: lookSettings(value.shared) };
  if (value.scope === 'pair') {
    if (!Array.isArray(value.inputs) || value.inputs.length !== 2) throw new Error('A pair look holds two inputs.');
    return { kind: 'look', scope: 'pair', inputs: value.inputs.map((input) => inputPatch(input, patternIds)),
      pair: pairSettings(value.pair), ...shared };
  }
  if (value.scope === 'quad') {
    if (!isObject(value.inputs) || !isObject(value.pairs)) throw new Error('A quad look holds four inputs and two pairs.');
    return {
      kind: 'look', scope: 'quad',
      inputs: Object.fromEntries(INPUT_IDS.map((id) => [id, inputPatch(value.inputs[id], patternIds)])),
      pairs: Object.fromEntries(PAIR_IDS.map((id) => [id, pairSettings(value.pairs[id])])),
      ...(value.master === undefined ? {} : { master: masterSettings(value.master) }),
      ...shared,
    };
  }
  throw new Error(`Unknown look scope: ${value.scope}`);
}

// Which pair the main shows most of: Left below half way, Right from it on.
export function pairOnAir(master) {
  return master.position < 0.5 ? 'left' : 'right';
}

// Whether a pair cannot be seen on the main: a transition faded fully to the
// other pair. A combine blend shows both pairs at any position.
export function pairOffAir(master, pairId) {
  if (BLEND_MODES[blendModeIndex(master.mode)].kind !== 'transition') return false;
  return master.position === (pairId === 'left' ? 1 : 0);
}

// The look action for one pair of a whole look, or for the whole quad.
export function pairLookOf(look, pairId) {
  const [first, second] = PAIRS[pairId];
  return {
    kind: 'look', scope: 'pair', inputs: [look.inputs[first], look.inputs[second]].map((input) => ({ ...input })),
    pair: { ...look.pairs[pairId] }, shared: look.shared,
  };
}

export function quadLookOf(look) {
  return {
    kind: 'look', scope: 'quad',
    inputs: Object.fromEntries(INPUT_IDS.map((id) => [id, { ...look.inputs[id] }])),
    pairs: { left: { ...look.pairs.left }, right: { ...look.pairs.right } },
    master: { ...look.master }, shared: look.shared,
  };
}

// An input after a look's input patch: what the patch does not hold stays.
// Without saved settings, the input keeps its own if the pattern is the
// same, and a new pattern starts from its defaults.
function patchedInput(base, patch) {
  return {
    ...base,
    ...patch,
    params: patch.params ?? (patch.patternId === base.patternId ? base.params : {}),
    shape: patch.shape ?? base.shape,
  };
}

// The whole look after a look action: a pair look goes into `pair`, a quad
// look fills all four inputs and both pairs. The main always stays as it is.
// The shared look settings are applied only when `shared` is true and the
// action holds them.
export function lookFromAction(action, current, { pair = 'left', shared = true } = {}, patterns = []) {
  const inputs = { ...current.inputs };
  const pairs = { ...current.pairs };
  if (action.scope === 'quad') {
    for (const id of INPUT_IDS) inputs[id] = patchedInput(current.inputs[id], action.inputs[id]);
    for (const id of PAIR_IDS) pairs[id] = action.pairs[id];
  } else {
    PAIRS[pair].forEach((id, i) => { inputs[id] = patchedInput(current.inputs[id], action.inputs[i]); });
    pairs[pair] = action.pair;
  }
  return wholeLook({
    inputs, pairs, master: current.master,
    shared: shared && action.shared ? action.shared : current.shared,
  }, patterns);
}
