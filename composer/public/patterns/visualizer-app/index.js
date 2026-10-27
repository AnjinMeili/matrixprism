// Composer patterns for the visualizer-app port. See ./NOTICE.md.
import { Runner } from './runtime.js';
import { Multiband2 } from './multiband2.js';
import { RAYMARCHING_GLSL, Raymarching } from './raymarching.js';
import { JULIA_GLSL, JuliaFlow } from './julia.js';

export const VISUALIZER_APP_GROUP = 'Visualizer App';

// `port` is false for a pattern made here rather than ported from the demo.
const entry = (id, name, description, extra, port = true) => ({
  id: `visualizer-app-${id}`,
  name,
  group: VISUALIZER_APP_GROUP,
  audio: port ? `${description} (port of a 2013 visualizer demo)` : description,
  audioReactive: true,
  controls: [],
  ...extra,
});

const canvas = (Visualisation) => ({
  createInstance: (width, height, random = Math.random) =>
    new Runner(new Visualisation(width, height, random)),
});

export const VISUALIZER_APP_PATTERNS = [
  entry('multiband2', 'Bars 2', 'The left channel\'s bars up from the centre and the right\'s down, behind white outlines', canvas(Multiband2)),
  entry('raymarching', 'Raymarching', 'A flight through a lattice of beams; hits surge it forward and turn its colours', {
    glsl: RAYMARCHING_GLSL,
    // The shader's own state, stepped in JavaScript (renderer.js).
    stateUniforms: ['vz_rot', 'vz_z', 'vz_beattime', 'vz_color1', 'vz_color2'],
    createState: (random = Math.random) => new Raymarching(random),
    params: [
      {
        id: 'motion', name: 'Motion', type: 'choice', default: 'flow', state: true,
        choices: [{ id: 'flow', name: 'Flow' }, { id: 'jump', name: 'Jump (original)' }],
        help: 'Flow: a hit is a surge of speed that eases off, and the colours turn slowly. Jump: a hit jumps the flight 5 to 35 seconds ahead, as the original did',
      },
      {
        id: 'surge', name: 'Surge', min: 0, max: 4, step: 0.1, default: 1.5, state: true,
        help: 'In Flow, how much faster a low hit makes the flight, easing off over about a second',
      },
      {
        id: 'hits', name: 'Hits from', type: 'choice', default: 'original', state: true,
        choices: [{ id: 'original', name: 'The original\'s detector' }, { id: 'composer', name: 'The composer\'s beat' }],
        help: 'The original detector watches three bass bands; with the composer\'s, each beat drives the flight, each bar turns one colour and high hits the other',
      },
    ],
  }),
  entry('julia', 'Julia Flow', 'A Julia set morphing as its constant travels the Mandelbrot set\'s edge; beats surge it on, the bass breaks it into filaments (created by Claude)', {
    glsl: JULIA_GLSL,
    stateUniforms: ['julia_c', 'julia_turn', 'julia_zoom'],
    createState: (random = Math.random) => new JuliaFlow(random),
    params: [
      { id: 'zoom', name: 'Zoom', min: 0.5, max: 8, step: 0.05, default: 1, help: 'How close in: 1 shows the whole set, higher looks into its edge' },
      { id: 'spin', name: 'Spin', min: -0.5, max: 0.5, step: 0.01, default: 0.03, state: true, help: 'How fast the picture rotates, either way, in radians a second; 0 holds it still' },
      { id: 'detail', name: 'Detail', min: 32, max: 256, step: 1, default: 96, help: 'Iterations: more shows finer filaments near the set\'s edge, and wants more when zoomed in; costs more' },
      { id: 'shift', name: 'Colour shift', min: 0, max: 1, step: 0.01, default: 0, help: 'Moves every colour round the palette' },
      { id: 'drift', name: 'Colour speed', min: -0.2, max: 0.2, step: 0.005, default: 0.02, state: true, help: 'How fast the colours cycle round the palette, either way; 0 holds them' },
      { id: 'bands', name: 'Colour bands', min: 0.01, max: 0.2, step: 0.005, default: 0.05, help: 'How quickly the colour changes toward the set\'s edge: higher gives more, narrower bands' },
      { id: 'segments', name: 'Segments', min: 1, max: 16, step: 1, default: 1, help: 'Mirrored wedges round the centre, as a kaleidoscope; 1 is off' },
      { id: 'surge', name: 'Surge', min: 0, max: 4, step: 0.1, default: 1.5, state: true, help: 'How much faster a beat sends the shape along, easing off over about a second' },
    ],
  }, false),
];
