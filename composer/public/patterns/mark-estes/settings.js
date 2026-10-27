// Copyright 2026 Anjin <anjin@skyhighatry.com>. Part of the Table Mark Estes
// port, so licensed as it is.
// SPDX-License-Identifier: Apache-2.0
// Licensed under the Apache License, Version 2.0: ../../licenses/table-mark-estes.txt.
// The settings every Table Mark Estes pattern shares (T71). They act on the
// values the sketch rolls at random for each run (runtime.js, randomize()).
// The numbers change the rolled value rather than replace it, so at their
// defaults every pattern draws exactly as the sketch would; a choice left on
// Random keeps the roll, and any other choice holds through every re-roll.

// Mirrors, as the sketch's `adjunct` codes read by adjustme(). The last five
// work in a square of the shorter side, so on a wider panel they leave the
// rest unmirrored and the square half blank; the sketch never rolls them
// there, and neither do these settings (SQUARE_ONLY_MIRRORS).
const MIRRORS = [
  ['none', 'None', 0],
  ['leftRight', 'Left to right', 4],
  ['topBottom', 'Top to bottom', 5],
  ['bottomTop', 'Bottom to top', 13],
  ['fourWays', 'Four ways', 8],
  ['pinwheel', 'Pinwheel (square panels)', 6],
  ['diagonal', 'Diagonal (square panels)', 7],
  ['otherDiagonal', 'Other diagonal (square panels)', 10],
  ['diagonalTopBottom', 'Diagonal and top to bottom (square panels)', 12],
  ['eightWays', 'Eight ways (square panels)', 3],
];
export const SQUARE_ONLY_MIRRORS = new Set([6, 7, 10, 12, 3]);

// Shifts of the whole picture each step, as the sketch's `wind` codes read by
// checkwind(). Named for the way the picture moves on screen: LEDMatrix
// counts rows from the bottom, so its ShiftUp moves this frame down.
const WINDS = [
  ['none', 'None', 0],
  ['down', 'Down', 1],
  ['downRight', 'Down and right', 2],
  ['right', 'Right', 3],
  ['upRight', 'Up and right', 4],
  ['up', 'Up', 5],
  ['upLeft', 'Up and left', 6],
  ['left', 'Left', 7],
  ['downLeft', 'Down and left', 8],
  ['leftFast', 'Left, fast', 12],
  ['upFast', 'Up, fast', 13],
  ['apartRows', 'Apart from a moving row', 9],
  ['apartColumns', 'Apart from a moving column', 10],
  ['apartCentre', 'Apart from the centre', 11],
  ['apartColumnsDown', 'Apart from a moving column, and down', 14],
  ['apartColumnsUp', 'Apart from a moving column, and up', 15],
];

// Decorations over the picture, as the sketch's `fancy` codes read by
// checkfancy() in decorations.js.
const DECORATIONS = [
  ['none', 'None', 0],
  ['rings', 'Growing rings', 8],
  ['ringsIn', 'Closing rings', 2],
  ['ringsBoth', 'Rings both ways', 29],
  ['boxes', 'Growing boxes', 4],
  ['boxesOut', 'Box trains', 5],
  ['stars', 'Growing stars', 6],
  ['starsIn', 'Closing stars', 3],
  ['triangles', 'Triangles', 1],
  ['boxesTriangles', 'Box trains and triangles', 25],
  ['pulseRing', 'Pulsing ring', 21],
  ['pulseDisc', 'Pulsing disc', 27],
  ['confetti', 'Confetti', 24],
  ['sparkles', 'Sparkles and rings', 22],
  ['confettiStar', 'Confetti and a star', 23],
  ['windBurst', 'Wind bursts', 28],
];

// The fade's colour: 0 to black, then the sketch's red, green and blue fades.
const FADE_COLOURS = [
  ['black', 'Black', 0],
  ['red', 'Red', 1],
  ['green', 'Green', 2],
  ['blue', 'Blue', 3],
];

const RANDOM = { id: 'random', name: 'Random' };
const choices = (table) => [RANDOM, ...table.map(([id, name]) => ({ id, name }))];
const codeOf = (table, id) => table.find((entry) => entry[0] === id)?.[2] ?? null;

export const TME_PARAMS = [
  { id: 'speed', name: 'Speed', min: 0.25, max: 4, step: 0.05, default: 1,
    help: 'This pattern\'s own pace, times the rate it rolled, on top of the main Speed' },
  { id: 'fade', name: 'Fade', min: 0, max: 3, step: 0.05, default: 1,
    help: 'How fast the picture fades behind what is drawn: 0 never, 1 as rolled, 2 twice as fast' },
  { id: 'paleness', name: 'Paleness', min: -255, max: 255, step: 1, default: 0,
    help: 'Added to the paleness this run rolled: above 0 whiter colours, below 0 deeper' },
  { id: 'hueShift', name: 'Colour shift', min: 0, max: 255, step: 1, default: 0,
    help: 'Moves every colour round the wheel, without turning the picture' },
  { id: 'drift', name: 'Drift', min: 0, max: 4, step: 0.05, default: 1,
    help: 'How fast the centre wanders: 0 holds it still, 1 as rolled' },
  { id: 'mirror', name: 'Mirror', type: 'choice', choices: choices(MIRRORS), default: 'random',
    help: 'Reflects the picture; Random keeps the mirror each run rolls, which is often none. Those for square panels do nothing on others' },
  { id: 'wind', name: 'Wind', type: 'choice', choices: choices(WINDS), default: 'random',
    help: 'Moves the whole picture a step at a time; Random keeps what each run rolls' },
  { id: 'decoration', name: 'Decoration', type: 'choice', choices: choices(DECORATIONS), default: 'random',
    help: 'Shapes drawn over the pattern; Random keeps what each run rolls' },
  { id: 'fadeColour', name: 'Fade colour', type: 'choice', choices: choices(FADE_COLOURS), default: 'random',
    help: 'Fades towards black, or lets one colour linger; Random keeps what each run rolls' },
];

// The settings as the runtime uses them; a choice left on Random is null.
export const TME_DEFAULT_SETTINGS = Object.freeze(resolveTmeSettings({}));

export function resolveTmeSettings(values = {}) {
  const number = (id) => {
    const param = TME_PARAMS.find((entry) => entry.id === id);
    const value = Number(values[id]);
    return Number.isFinite(value) ? Math.min(param.max, Math.max(param.min, value)) : param.default;
  };
  return {
    speed: number('speed'),
    fade: number('fade'),
    paleness: Math.round(number('paleness')),
    hueShift: Math.round(number('hueShift')),
    drift: number('drift'),
    adjunct: codeOf(MIRRORS, values.mirror),
    wind: codeOf(WINDS, values.wind),
    fancy: codeOf(DECORATIONS, values.decoration),
    fadeColour: codeOf(FADE_COLOURS, values.fadeColour),
  };
}
