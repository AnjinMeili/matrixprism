// Pattern parameters (T33 step 1): the variables a pattern declares as its
// own interface, which the Patterns view shows as controls and saves per
// pattern.
//
// A pattern lists them in `params`, each:
//
//   { id, name, min, max, step, default, help }      a number
//   { id, name, type: 'bool', default, help }        on or off
//   { id, name, type: 'choice', choices: [{ id, name }], default, help }
//
// `id` is a short identifier (letters and digits, starting with a letter).
// A number with `step: 1` is a whole number. `help` is optional.
//
// Shader patterns read each as `uniform float p_<id>`, declared for them
// (paramUniforms): a number as itself, a bool as 0 or 1, a choice as its
// index. Stateful patterns get the values, by id, as the second argument to
// renderFrame(state, params): a number, true or false, or the choice's id.

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
  if (typeof value !== 'number' || !Number.isFinite(value)) return param.default;
  const stepped = param.min + Math.round((value - param.min) / param.step) * param.step;
  // Rounded to the step's decimals, so 0.1 steps do not drift to 0.30000000000000004.
  const decimals = Math.max(0, -Math.floor(Math.log10(param.step)) + 1);
  return Math.min(param.max, Math.max(param.min, Number(stepped.toFixed(decimals))));
}

// Every parameter of a pattern, from the saved values where they are valid
// and the defaults elsewhere. Saved values for parameters the pattern no
// longer has are left out.
export function paramValues(pattern, saved = {}) {
  const values = {};
  for (const param of pattern.params ?? [])
    values[param.id] = paramValue(param, saved?.[param.id]);
  return values;
}

// The saved values worth keeping: those that differ from the default.
export function changedParams(pattern, values) {
  const changed = {};
  for (const param of pattern.params ?? []) {
    const value = paramValue(param, values?.[param.id]);
    if (value !== param.default) changed[param.id] = value;
  }
  return changed;
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
