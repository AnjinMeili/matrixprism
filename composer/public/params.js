// Pattern parameters (T33 step 1): the variables a pattern declares as its
// own interface, which the Patterns view shows as controls and saves per
// pattern.
//
// A pattern lists them in `params`, each:
//
//   { id, name, min, max, step, default, help }      a number
//   { id, name, type: 'bool', default, help }        on or off
//   { id, name, type: 'choice', choices: [{ id, name }], default, help }
//   { id: 'variation', name, type: 'variation', default: 0, help }   a seed (seed.js, T72)
//
// `id` is a short identifier (letters and digits, starting with a letter).
// A number with `step: 1` is a whole number. `help` is optional.
//
// Shader patterns read each as `uniform float p_<id>`, declared for them
// (paramUniforms): a number as itself, a bool as 0 or 1, a choice as its
// index. Stateful patterns get the values, by id, as the second argument to
// renderFrame(state, params): a number, true or false, or the choice's id.
//
// Follows (#21): a number setting can also follow the music. The pattern's
// saved settings then carry `follows: { <param id>: { source, amount } }`;
// the slider's value is the resting point, and each frame the setting moves
// from it by the source (0 to 1) times the amount (-1 to 1) times the
// slider's whole range, held within the range (followedValues).

import { SEED_MAX } from './seed.js';

const ID = /^[a-zA-Z][a-zA-Z0-9]*$/;

// Problems with a pattern's declaration, as messages; empty when it is sound.
export function paramProblems(pattern) {
  const problems = [];
  const seen = new Set();
  for (const param of pattern.params ?? []) {
    const where = `${pattern.id}.${param.id}`;
    if (!ID.test(param.id ?? '')) problems.push(`${where}: id must be letters and digits, starting with a letter`);
    if (seen.has(param.id)) problems.push(`${where}: declared twice`);
    seen.add(param.id);
    if (!param.name) problems.push(`${where}: no name`);
    const type = param.type ?? 'number';
    if (type === 'number') {
      if (!(Number.isFinite(param.min) && Number.isFinite(param.max) && param.min < param.max))
        problems.push(`${where}: min and max must be numbers, min below max`);
      if (!(param.step > 0)) problems.push(`${where}: step must be above 0`);
      if (!(param.default >= param.min && param.default <= param.max))
        problems.push(`${where}: default ${param.default} outside ${param.min} to ${param.max}`);
    } else if (type === 'bool') {
      if (typeof param.default !== 'boolean') problems.push(`${where}: default must be true or false`);
    } else if (type === 'choice') {
      if (!param.choices?.length) problems.push(`${where}: no choices`);
      else if (!param.choices.some((choice) => choice.id === param.default))
        problems.push(`${where}: default is not one of the choices`);
    } else if (type === 'variation') {
      if (param.default !== 0) problems.push(`${where}: a variation's default must be 0, none chosen`);
    } else {
      problems.push(`${where}: unknown type ${type}`);
    }
  }
  return problems;
}

// One value made valid for its parameter: a number clamped into range and
// onto its steps, a bool, a choice that exists; otherwise the default.
export function paramValue(param, value) {
  const type = param.type ?? 'number';
  if (type === 'bool') return typeof value === 'boolean' ? value : param.default;
  if (type === 'choice') return param.choices.some((choice) => choice.id === value) ? value : param.default;
  if (type === 'variation') return Number.isInteger(value) && value > 0 && value <= SEED_MAX ? value : 0;
  if (typeof value !== 'number' || !Number.isFinite(value)) return param.default;
  const stepped = param.min + Math.round((value - param.min) / param.step) * param.step;
  // Rounded to the step's decimals, so 0.1 steps do not drift to 0.30000000000000004.
  const decimals = Math.max(0, -Math.floor(Math.log10(param.step)) + 1);
  return Math.min(param.max, Math.max(param.min, Number(stepped.toFixed(decimals))));
}

// Every parameter of a pattern, from the saved values where they are valid
// and the defaults elsewhere. Saved values for parameters the pattern no
// longer has are left out. Follows that differ from Off are kept beside them.
export function paramValues(pattern, saved = {}) {
  const values = {};
  for (const param of pattern.params ?? [])
    values[param.id] = paramValue(param, saved?.[param.id]);
  const follows = cleanFollows(pattern, saved?.follows);
  if (Object.keys(follows).length) values.follows = follows;
  return values;
}

// The saved values worth keeping: those that differ from the default.
export function changedParams(pattern, values) {
  const changed = {};
  for (const param of pattern.params ?? []) {
    const value = paramValue(param, values?.[param.id]);
    if (value !== param.default) changed[param.id] = value;
  }
  const follows = cleanFollows(pattern, values?.follows);
  if (Object.keys(follows).length) changed.follows = follows;
  return changed;
}

// What a setting can follow, each read from the frame's state as 0 to 1.
export const FOLLOW_SOURCES = [
  { id: 'off', name: 'Off' },
  { id: 'lows', name: 'Lows', read: (state) => state.audio?.bass },
  { id: 'mids', name: 'Mids', read: (state) => state.audio?.mid },
  { id: 'highs', name: 'Highs', read: (state) => state.audio?.treble },
  { id: 'level', name: 'Level', read: (state) => state.audio?.level },
  { id: 'beat', name: 'Beat', read: (state) => state.audio?.beat },
  { id: 'hits', name: 'High hits', read: (state) => state.audio?.highHit },
  // The Camelot number round the wheel, 1 at 0 and 12 at 11/12, so a
  // colour setting following it turns with the key; 0 with no key.
  { id: 'key', name: 'Key', read: (state) => {
    const number = state.musicalKey?.camelot?.number;
    return number ? (number - 1) / 12 : 0;
  } },
  // Where in the bar of four beats, 0 to 1.
  { id: 'bar', name: 'Bar', read: (state) => {
    const beats = state.beatPosition;
    return Number.isFinite(beats) ? ((beats % 4) + 4) % 4 / 4 : 0;
  } },
];
export const FOLLOW_DEFAULT = { source: 'off', amount: 0.5 };
const FOLLOW_AMOUNT_STEP = 0.05;

// A follow made valid: a known source and an amount from -1 to 1 on its
// steps; otherwise the default's.
export function followValue(follow) {
  const source = FOLLOW_SOURCES.some((entry) => entry.id === follow?.source) ? follow.source : FOLLOW_DEFAULT.source;
  const raw = typeof follow?.amount === 'number' && Number.isFinite(follow.amount) ? follow.amount : FOLLOW_DEFAULT.amount;
  const amount = Number((Math.round(Math.min(1, Math.max(-1, raw)) / FOLLOW_AMOUNT_STEP) * FOLLOW_AMOUNT_STEP).toFixed(2));
  return { source, amount: Object.is(amount, -0) ? 0 : amount };
}

// The follows worth keeping, for number settings the pattern has: those that
// differ from the default.
export function cleanFollows(pattern, follows) {
  const clean = {};
  if (!follows || typeof follows !== 'object') return clean;
  for (const param of pattern.params ?? []) {
    if ((param.type ?? 'number') !== 'number' || !follows[param.id]) continue;
    const follow = followValue(follows[param.id]);
    if (follow.source !== FOLLOW_DEFAULT.source || follow.amount !== FOLLOW_DEFAULT.amount)
      clean[param.id] = follow;
  }
  return clean;
}

// The values for this frame: each number setting with a follow moved from
// its resting point by its source, held within its range, and put on whole
// steps when its steps are whole. The same object when nothing follows.
export function followedValues(pattern, values, state) {
  if (!values?.follows) return values;
  const followed = { ...values };
  for (const param of pattern.params ?? []) {
    const follow = values.follows[param.id];
    if (!follow || follow.source === 'off' || (param.type ?? 'number') !== 'number') continue;
    const reading = Number(FOLLOW_SOURCES.find((entry) => entry.id === follow.source)?.read(state)) || 0;
    let value = values[param.id] + Math.min(1, Math.max(0, reading)) * follow.amount * (param.max - param.min);
    if (Number.isInteger(param.step)) value = param.min + Math.round((value - param.min) / param.step) * param.step;
    followed[param.id] = Math.min(param.max, Math.max(param.min, value));
  }
  return followed;
}

// The GLSL declarations for a shader pattern's parameters.
export function paramUniforms(pattern) {
  return (pattern.params ?? []).map((param) => `uniform float p_${param.id};`).join('\n');
}

// A value as the float its uniform carries.
export function uniformValue(param, value) {
  const type = param.type ?? 'number';
  if (type === 'bool') return value ? 1 : 0;
  if (type === 'choice') return Math.max(0, param.choices.findIndex((choice) => choice.id === value));
  return value;
}

// A number as shown beside its slider: as many decimals as the step has.
export function formatParam(param, value) {
  const type = param.type ?? 'number';
  if (type === 'bool') return value ? 'on' : 'off';
  if (type === 'choice') return param.choices.find((choice) => choice.id === value)?.name ?? '';
  const decimals = Math.max(0, -Math.floor(Math.log10(param.step)));
  return value.toFixed(decimals);
}
