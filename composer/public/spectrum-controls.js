import { FFT_SIZES, SPECTRUM_PRESETS, spectrumOptions } from './spectrum-plot.js';
import { PALETTES } from './palettes.js';

const FIELDS = [
  ['layout', 'Display', [['bars', 'Bar graph'], ['line', 'Line'], ['area', 'Filled curve'], ['mirror', 'Mirrored ribbon'], ['circle', 'Circle / crown'], ['spiral', 'Spiral']]],
  ['bands', 'Frequency bands', [['log', 'Logarithmic'], ['linear', 'Linear'], ['octave', 'Octave'], ['third', '1/3 octave'], ['sixth', '1/6 octave']]],
  ['count', 'Band count (linear/log modes)', 4, 256, 1],
  ['fftSize', 'FFT window samples', FFT_SIZES.map(n => [n, `${n} samples / ${n / 2} bins`])],
  ['minHz', 'Minimum frequency (Hz)', 10, 20000, 1],
  ['maxHz', 'Maximum frequency (Hz)', 20, 24000, 1],
  ['aggregation', 'Band detector', [['power', 'Mean power (RMS magnitude)'], ['peak', 'Maximum bin magnitude']]],
  ['floorDb', 'Display floor (dB)', -140, -1, 1],
  ['ceilingDb', 'Display ceiling (dB)', -100, 0, 1],
  ['gainDb', 'Analysis gain (dB)', -30, 30, 0.5],
  ['slope', 'Slope compensation (dB/octave)', -12, 12, 0.5],
  ['attack', 'Attack time (ms)', 0, 2000, 5],
  ['release', 'Release time (ms)', 0, 5000, 10],
  ['peaks', 'Peak hold indicators', 'check'],
  ['hold', 'Peak hold time (ms)', 0, 10000, 50],
  ['fall', 'Peak fall rate (dB/s)', 1, 120, 1],
  ['curve', 'Line / curve interpolation', [['linear', 'Straight segments / radial bars'], ['smooth', 'Smooth bounded cubic curve']]],
  ['thickness', 'Line / peak thickness (panel pixels)', 0.5, 8, 0.5],
  ['gap', 'Bar gap fraction', 0, 0.9, 0.05],
  ['rotation', 'Circle / spiral rotation (degrees)', 0, 360, 1],
  ['turns', 'Spiral turns', 1, 5, 0.25],
  ['colour', 'Colour mapping', [['frequency', 'Frequency gradient'], ['level', 'Level gradient'], ['solid', 'Single colour']]],
  ['paletteId', 'Colour palette', PALETTES.filter(p => p.id !== 'original').map(p => [p.id, p.name])],
  ['grid', 'Show 10 dB reference grid', 'check'],
  ['labels', 'Show scale labels (larger rectangular panels)', 'check'],
];

// Returns { set(options) } to show settings changed elsewhere.
export function bindSpectrumControls(container, initial, changed, showError) {
  let current = spectrumOptions(initial);
  const controls = new Map();
  const makeOptions = (select, choices) => {
    for (const [value, text] of choices) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = text;
      select.appendChild(option);
    }
  };
  const presetLabel = document.createElement('label');
  presetLabel.textContent = 'Starting preset';
  const preset = document.createElement('select');
  preset.id = 'spectrum-preset';
  makeOptions(preset, [['custom', 'Custom tuning'], ...Object.keys(SPECTRUM_PRESETS).map(name => [name, name])]);
  presetLabel.appendChild(preset);
  container.appendChild(presetLabel);
  const groups = [
    ['Acquisition and frequency bands', ['bands', 'count', 'fftSize', 'minHz', 'maxHz', 'aggregation']],
    ['Levels and response', ['floorDb', 'ceilingDb', 'gainDb', 'slope', 'attack', 'release']],
    ['Peak indicators', ['peaks', 'hold', 'fall']],
    ['Geometry and colour', ['curve', 'thickness', 'gap', 'rotation', 'turns', 'colour', 'paletteId', 'grid', 'labels']],
  ];
  const sections = new Map();
  for (const [name, keys] of groups) {
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = name;
    details.appendChild(summary);
    keys.forEach(key => sections.set(key, details));
  }
  const sync = () => {
    for (const [key, input] of controls) {
      if (input.type === 'checkbox') input.checked = current[key];
      else input.value = current[key];
    }
  };
  for (const [key, title, type, max, step] of FIELDS) {
    const label = document.createElement('label');
    const input = document.createElement(Array.isArray(type) ? 'select' : 'input');
    input.id = `spectrum-${key}`;
    if (Array.isArray(type)) makeOptions(input, type);
    else if (type === 'check') { input.type = 'checkbox'; label.className = 'check'; }
    else {
      input.type = 'number'; input.min = type; input.max = max; input.step = step; input.required = true;
    }
    label.appendChild(document.createTextNode(title));
    if (input.type === 'checkbox') label.prepend(input);
    else label.appendChild(input);
    if (key === 'layout') container.appendChild(label);
    else sections.get(key).appendChild(label);
    controls.set(key, input);
    input.addEventListener(input.tagName === 'SELECT' || input.type === 'checkbox' ? 'change' : 'input', () => {
      try {
        if (!input.checkValidity()) throw new Error(`Invalid ${title.toLowerCase()}.`);
        const value = input.type === 'checkbox' ? input.checked :
          typeof current[key] === 'number' ? Number(input.value) : input.value;
        const next = spectrumOptions({ ...current, [key]: value });
        changed(next);
        current = next;
        preset.value = 'custom';
        showError('');
      } catch (error) { showError(error.message); }
    });
  }
  for (const section of new Set(sections.values())) container.appendChild(section);
  preset.addEventListener('change', () => {
    if (preset.value === 'custom') return;
    try {
      const next = spectrumOptions(SPECTRUM_PRESETS[preset.value]);
      changed(next);
      current = next;
      sync();
      showError('');
    } catch (error) { showError(error.message); }
  });
  sync();
  // Shows other settings, such as a playlist entry's, without calling `changed`.
  return {
    set(next) {
      current = spectrumOptions(next);
      preset.value = 'custom';
      sync();
    },
  };
}
