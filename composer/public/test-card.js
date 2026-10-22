// Panel Range: a test card for reading how an LED panel answers the values it
// is sent. Every bar is one known 8-bit level, so what the panel does with it
// can be read off by eye and compared with the preview.
//
// The tables here are the reference; the GLSL below is written from them, and
// cardLevels() is the same layout in JavaScript for the tests.

// Sixteen equal steps from black to full.
export const LINEAR_STEPS = Array.from({ length: 16 }, (_, index) => index * 17);

// Sixteen steps that each give about half as much light again as the one
// before. A panel that is linear in light shows these as even steps.
export const DOUBLING_STEPS = [1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64, 96, 128, 192, 255];

// Four patches that each change between two levels once a second, to show
// which changes read as a pulse: from near black to full, between two middle
// levels (35% and 75%, then 40% and 65%), and from half to full.
export const BLINK_PAIRS = [[8, 255], [89, 191], [102, 166], [128, 255]];

// The card's rows from the top, as the height at which each one starts.
const ROWS = { linear: 0.70, doubling: 0.45, red: 0.40, green: 0.35, blue: 0.30 };

// The [r, g, b] levels, 0 to 255, at a point of the card: u across from the
// left and v up from the bottom, both 0 to 1, on a card `width` pixels wide.
export function cardLevels(u, v, time, width) {
  if (v < ROWS.blue) {
    const patch = Math.min(Math.floor(u * 4), 3);
    // Two dark pixels part the patches.
    if ((u * 4 - patch) * width / 4 < 2)
      return [0, 0, 0];
    const [low, high] = BLINK_PAIRS[patch];
    const level = time % 1 < 0.5 ? low : high;
    return [level, level, level];
  }
  const bar = Math.min(Math.floor(u * 16), 15);
  // A dark pixel parts the bars, where a bar is wide enough to spare one.
  if (width / 16 >= 4 && (u * 16 - bar) * width / 16 < 1)
    return [0, 0, 0];
  if (v >= ROWS.linear)
    return [LINEAR_STEPS[bar], LINEAR_STEPS[bar], LINEAR_STEPS[bar]];
  if (v >= ROWS.doubling)
    return [DOUBLING_STEPS[bar], DOUBLING_STEPS[bar], DOUBLING_STEPS[bar]];
  if (v >= ROWS.red)
    return [LINEAR_STEPS[bar], 0, 0];
  if (v >= ROWS.green)
    return [0, LINEAR_STEPS[bar], 0];
  return [0, 0, LINEAR_STEPS[bar]];
}

// A GLSL expression choosing values[index] for a float index, which a WebGL 1
// fragment shader cannot do with an array.
function choose(index, values) {
  return values.slice(0, -1).map((value, at) => `${index} < ${at}.5 ? ${value} : `).join('') +
    values[values.length - 1];
}

const decimal = (value) => value.toFixed(2);
const pair = ([low, high]) => `vec2(${low}.0, ${high}.0)`;

export const PANEL_RANGE_PATTERN = {
  id: 'panel-range',
  // Chosen by hand only: the randomizer and the auto cycle pass over it.
  manualOnly: true,
  name: 'Panel Range',
  audio: 'None. A test card: grey, red, green and blue steps at known levels, and four patches that blink between two levels',
  glsl: `
float linearStep(float bar) { return bar * 17.0; }
float doublingStep(float bar) { return ${choose('bar', DOUBLING_STEPS.map((level) => `${level}.0`))}; }
vec2 blinkPair(float tile) { return ${choose('tile', BLINK_PAIRS.map(pair))}; }
vec3 render() {
  vec2 uv = uv01();
  if (uv.y < ${decimal(ROWS.blue)}) {
    float tile = min(floor(uv.x * 4.0), 3.0);
    vec2 levels = blinkPair(tile);
    float level = mod(u_time, 1.0) < 0.5 ? levels.x : levels.y;
    return vec3(level / 255.0) * step(2.0, (uv.x * 4.0 - tile) * u_res.x / 4.0);
  }
  float bar = min(floor(uv.x * 16.0), 15.0);
  float barWidth = u_res.x / 16.0;
  float lit = barWidth >= 4.0 ? step(1.0, (uv.x * 16.0 - bar) * barWidth) : 1.0;
  vec3 level;
  if (uv.y >= ${decimal(ROWS.linear)}) level = vec3(linearStep(bar));
  else if (uv.y >= ${decimal(ROWS.doubling)}) level = vec3(doublingStep(bar));
  else if (uv.y >= ${decimal(ROWS.red)}) level = vec3(linearStep(bar), 0.0, 0.0);
  else if (uv.y >= ${decimal(ROWS.green)}) level = vec3(0.0, linearStep(bar), 0.0);
  else level = vec3(0.0, 0.0, linearStep(bar));
  return level / 255.0 * lit;
}`,
};
