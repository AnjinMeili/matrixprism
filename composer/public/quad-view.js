// The Mixer's view, the quad mixer (T16 step 5; named Mixer on 2026-10-20): the panes of the agreed mock-up, drawn
// by the layout base (layout.js, layout-view.js). Each pane is built once and
// kept; `refresh()` brings its controls up to date with the settings, except
// a control being used, so a slider is not taken from under the pointer.
//
// The view holds no settings of its own: it reads and changes them through
// `api`, which app.js supplies:
//   patterns, blendModes, shapes, regions              lists for the menus
//   shapeOptions, tapUnits                             { outlines, spins, spinReversals, pulseBeats,
//                                                        sizeRange, edgeRange, pulseRange, defaults }
//   input(id), setInput(id, changes), resetInput(id)   { patternId, params, brightness, gamma, shape }
//   pair(id), setPair(id, changes), resetPair(id),     { enabled, mode, amount }
//     cutPair(id, to), fadePair(id)
//   master(), fading(), setMaster(changes), fade(),    the master, which the stream shows
//     resetMaster(), saveDefault()
//   swap(which)                                        'left', 'right' or 'master'
//   shared(), setShared(changes), tap(), downbeat(),    hue, speed, palette, tap unit and the rest;
//     tempo()
//                                                        setShared({ followAudio: true }) leaves manual tempo
//   output(), toggleStream(), hotsave()
//   randomizer(), setRandomizer(changes)               { enabled, unit, minWait, maxWait, tracks,
//                                                        paused, remaining: by track, in the unit }
//   waitUnits, waitLabel(amount, unit)                 the waits' units, and a wait as shown
//   edit(id)                                           opens a pattern's page, where there is one
//   palettes, beatSources, fadeTimes, fadeStarts
//   sparklePanel                                       the sparkles' settings, moved into the Main's popover
import { renderLayout } from './layout-view.js';
import { helpPopover } from './help.js';
import { buildParamControls } from './param-controls.js';
import { channelTags } from './channel-tags.js';

const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children.filter((child) => child !== null && child !== undefined && child !== false));
  return node;
};
// A label's text or class, written only when it differs: the view refreshes
// every frame, and rewriting an unchanged pill made it flash.
const setText = (node, text) => { if (node.textContent !== text) node.textContent = text; };
const setClass = (node, name) => { if (node.className !== name) node.className = name; };
const field = (label, control, extra = {}) => el('label', { className: 'qv-field', ...extra }, label, control);
const select = (options, onChange, props = {}) => {
  const node = el('select', props);
  for (const option of options) {
    if (option.group) {
      const group = el('optgroup', { label: option.group });
      group.append(...option.options.map((o) => new Option(o.label, o.value)));
      node.append(group);
    } else {
      node.append(new Option(option.label, option.value));
    }
  }
  node.addEventListener('change', () => onChange(node.value));
  return node;
};
const range = (min, max, step, onInput, props = {}) => {
  const node = el('input', { type: 'range', min, max, step, ...props });
  node.addEventListener('input', () => onInput(Number(node.value)));
  return node;
};
const button = (label, onClick, props = {}) => {
  const node = el('button', { type: 'button', textContent: label, ...props });
  node.addEventListener('click', onClick);
  return node;
};
// Places an open popover beside its button, below it or above where there is
// no room, inside the window.
const MARGIN = 8;
const placeBeside = (anchor, pop) => {
  const a = anchor.getBoundingClientRect();
  const { width, height } = pop.getBoundingClientRect();
  const below = a.bottom + 6;
  pop.style.left = `${Math.max(MARGIN, Math.min(a.left, window.innerWidth - width - MARGIN))}px`;
  pop.style.top = `${below + height <= window.innerHeight - MARGIN ? below : Math.max(MARGIN, a.top - height - 6)}px`;
};
let popovers = 0;
// Controls kept out of the way until wanted (Anjin, 2026-10-20: "with
// popovers so things do not get too dense"): a button opens a panel in the
// browser's top layer, which no pane can clip. It closes on Escape or a
// click elsewhere. Returns the button and the panel, which goes in the pane.
const popoverPanel = (label, title, ...children) => {
  const pop = el('div', { className: 'qv-pop', id: `qv-pop-${++popovers}` }, el('h3', { textContent: title }), ...children);
  pop.popover = 'auto';
  const opener = el('button', { type: 'button', className: 'qv-small qv-more', textContent: label, title });
  opener.popoverTargetElement = pop;
  pop.addEventListener('toggle', (event) => {
    if (event.newState === 'open') placeBeside(opener, pop);
  });
  return { opener, pop };
};

// Sets a control's value unless it is being used.
const show = (control, value) => {
  if (document.activeElement === control) return;
  if (control.type === 'checkbox') control.checked = !!value;
  else if (String(control.value) !== String(value)) control.value = value;
};

export function buildQuadView(container, layout, api) {
  const syncs = [];
  const canvases = {};
  const previewCanvas = (name, label) => {
    const canvas = el('canvas', { className: 'qv-preview', width: 1, height: 1 });
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', label);
    canvases[name] = canvas;
    return canvas;
  };
  const patternOptions = () => {
    const groups = new Map();
    for (const pattern of api.patterns) {
      const name = pattern.group ?? 'Patterns';
      if (!groups.has(name)) groups.set(name, []);
      groups.get(name).push({ value: pattern.id, label: pattern.name });
    }
    return [...groups].map(([group, options]) => ({ group, options }));
  };
  const blendOptions = () => [['transition', 'Crossfades'], ['combine', 'Combine']].map(([kind, group]) => ({
    group, options: api.blendModes.filter((mode) => mode.kind === kind).map((mode) => ({ value: mode.id, label: mode.name })),
  }));
  const pairOf = (id) => (['a', 'b'].includes(id) ? 'left' : 'right');
  // A randomizer item (TRACKS in randomizer.js) in the pane it changes, with
  // the time to its next change: "idle" while it waits for something, such
  // as B for Left to mix.
  const randomItem = (track, label, title) => {
    const box = el('input', { type: 'checkbox' });
    box.addEventListener('change', () =>
      api.setRandomizer({ tracks: { ...api.randomizer().tracks, [track]: box.checked } }));
    const wait = el('output', { className: 'qv-wait' });
    syncs.push(() => {
      const random = api.randomizer();
      const seconds = random.remaining[track];
      show(box, random.tracks[track]);
      wait.textContent = !random.enabled || !random.tracks[track] ? '' : random.paused ? 'paused' :
        seconds === null ? 'idle' : api.waitLabel(seconds, random.unit);
    });
    return el('label', { className: 'qv-check qv-random', title }, box, ` ${label}`, wait);
  };
  const airPill = (pairId) => {
    const pill = el('span', { className: 'qv-pill' });
    syncs.push(() => {
      const position = api.master().position;
      const onAir = pairId === 'left' ? position < 1 : position > 0;
      setText(pill, onAir ? 'on air' : 'cued');
      setClass(pill, `qv-pill ${onAir ? 'qv-live' : 'qv-cue'}`);
    });
    return pill;
  };

  const components = {
    input(pane) {
      const id = pane.of;
      const name = el('h2', { className: 'qv-name' });
      const editButton = button('Edit', () => api.edit(id), { className: 'qv-small', hidden: !api.canEdit(id) });
      editButton.setAttribute('aria-label', `Edit input ${id.toUpperCase()}'s pattern on its own page`);
      const resetButton = button(`Reset ${id.toUpperCase()}`, () => api.resetInput(id), { className: 'qv-small' });
      const resetTitle = 'Back to just the pattern, unmodified: its settings, shape, region, area, border, spin, pulse, ' +
        'brightness, gamma and hue to their defaults. The randomizer then waits a whole wait before changing it';
      resetButton.title = resetTitle;
      const patternSelect = select(patternOptions(), (value) => api.setInput(id, { patternId: value }));
      const shapeSelect = select(api.shapes.map((s) => ({ value: s.id, label: s.name })),
        (value) => api.setInput(id, { shape: { ...api.input(id).shape, shape: value } }));
      const regionSelect = select(api.regions.map((r) => ({ value: r.id, label: r.name })),
        (value) => api.setInput(id, { shape: { ...api.input(id).shape, region: value } }));
      const brightness = range(0, 1, 0.01, (value) => api.setInput(id, { brightness: value }));
      const gamma = range(0.5, 2.8, 0.05, (value) => api.setInput(id, { gamma: value }));
      const brightnessOut = el('output'), gammaOut = el('output');
      // Hue: the main's (Hue shift, under All inputs) while Follow main is
      // ticked, else this input's own, starting from the main's so nothing
      // jumps.
      const hue = range(0, 1, 0.01, (value) => api.setInput(id, { hue: value }));
      const hueOut = el('output');
      const follow = el('input', { type: 'checkbox' });
      follow.setAttribute('aria-label', 'Follow the main\'s hue');
      follow.addEventListener('change', () => api.setInput(id, { hue: follow.checked ? null : api.shared().hue }));
      // The rest of the shape, as the Mixer view has it, in a popover: the
      // area's outline, size and border, and spin and pulse on the tempo.
      const options = api.shapeOptions;
      const setShape = (changes) => api.setInput(id, { shape: { ...api.input(id).shape, ...changes } });
      const outline = select(options.outlines, (value) => setShape({ outline: value }));
      const sized = (key, [min, max]) => range(min, max, 0.01, (value) => setShape({ [key]: value }));
      const width = sized('width', options.sizeRange), height = sized('height', options.sizeRange);
      const edge = sized('edge', options.edgeRange), pulse = sized('pulse', options.pulseRange);
      const widthOut = el('output'), heightOut = el('output'), edgeOut = el('output'), pulseOut = el('output');
      const proportional = el('input', { type: 'checkbox' });
      proportional.addEventListener('change', () => setShape({ proportional: proportional.checked }));
      const spin = select(options.spins, (value) => setShape({ spin: Number(value) }));
      const spinReverse = select(options.spinReversals, (value) => setShape({ spinReverse: Number(value) }));
      const pulseBeats = select(options.pulseBeats, (value) => setShape({ pulseBeats: Number(value) }));
      const outlineField = field('Area outline', outline), widthField = field(el('span', {}, 'Width ', widthOut), width);
      const heightField = field(el('span', {}, 'Height ', heightOut), height);
      const edgeField = field(el('span', {}, 'Border softness ', edgeOut), edge);
      const proportionalField = el('label', { className: 'qv-check' }, proportional, ' Same size both ways');
      const spinReverseField = field('Reverse the spin', spinReverse, { className: 'qv-field qv-wide' });
      const pulseBeatsField = field('Pulse every', pulseBeats);
      const more = popoverPanel('More…', `${id.toUpperCase()}'s shape: area, border, spin and pulse`,
        el('div', { className: 'qv-pop-grid' }, outlineField, proportionalField, widthField, heightField, edgeField,
          field('Spin with the tempo', spin, { className: 'qv-field qv-wide' }), spinReverseField,
          field(el('span', {}, 'Pulse on the beat ', pulseOut), pulse),
          pulseBeatsField),
        el('p', { className: 'qv-note', textContent: 'A region limits the input to the area or to outside it; its outline also sets how a bend curves. ' +
          'Opposite regions with the same area and softness share the panel and crossfade across the border. Spin and pulse follow the tempo.' }));
      // The channel's modifiers as chips under its name (channel-tags.js),
      // or "unmodified", so the line keeps its place.
      const tagLine = el('div', { className: 'qv-tags' });
      let tagsFor = null;
      syncs.push(() => {
        const input = api.input(id);
        const tags = channelTags(input, api.patterns.find((p) => p.id === input.patternId));
        const key = JSON.stringify(tags);
        if (key === tagsFor) return;
        tagsFor = key;
        tagLine.replaceChildren(...(tags.length ? tags.map((tag) => el('span', { className: 'qv-tag', textContent: tag.text, title: tag.title }))
          : [el('span', { className: 'qv-note', textContent: 'unmodified' })]));
      });
      const params = el('div', { className: 'qv-params' });
      let paramsFor = null;
      syncs.push(() => {
        const shape = api.input(id).shape;
        const inArea = shape.region !== 'full';
        show(outline, shape.outline);
        show(width, shape.width);
        show(height, shape.height);
        show(edge, shape.edge);
        show(proportional, shape.proportional);
        show(spin, shape.spin);
        show(spinReverse, shape.spinReverse);
        show(pulse, shape.pulse);
        show(pulseBeats, shape.pulseBeats);
        widthOut.textContent = `${Math.round(shape.width * 100)}%`;
        heightOut.textContent = `${Math.round(shape.height * 100)}%`;
        edgeOut.textContent = shape.edge === 0 ? 'hard line' : `${Math.round(shape.edge * 100)}%`;
        pulseOut.textContent = shape.pulse === 0 ? 'off' : `${Math.round(shape.pulse * 100)}% larger`;
        // As in the Mixer view: the area's fields only where they matter.
        outlineField.hidden = !inArea && shape.shape === 'normal';
        widthField.hidden = edgeField.hidden = proportionalField.hidden = !inArea;
        heightField.hidden = !inArea || shape.proportional;
        spinReverseField.hidden = shape.spin === 0;
        pulseBeatsField.hidden = shape.pulse === 0;
        // Marked while anything in it differs from the defaults, so it is
        // not forgotten.
        more.opener.classList.toggle('qv-set', Object.keys(options.defaults)
          .some((key) => !['shape', 'region'].includes(key) && shape[key] !== options.defaults[key]));
      });
      syncs.push(() => {
        const input = api.input(id);
        const pattern = api.patterns.find((p) => p.id === input.patternId);
        name.textContent = pattern?.name ?? input.patternId;
        show(patternSelect, input.patternId);
        show(shapeSelect, input.shape.shape);
        show(regionSelect, input.shape.region);
        show(brightness, input.brightness);
        show(gamma, input.gamma);
        brightnessOut.textContent = `${Math.round(input.brightness * 100)}%`;
        gammaOut.textContent = input.gamma.toFixed(2);
        const following = input.hue === null;
        const shownHue = following ? api.shared().hue : input.hue;
        show(follow, following);
        show(hue, shownHue);
        hue.disabled = following;
        hueOut.textContent = `${Math.round(shownHue * 360)}°`;
        // The Pattern settings are rebuilt when the pattern changes.
        const key = `${input.patternId} ${JSON.stringify(input.params)}`;
        if (pattern && paramsFor !== key && !params.contains(document.activeElement)) {
          paramsFor = key;
          params.replaceChildren();
          if (pattern.params?.length)
            buildParamControls(params, pattern, input.params, (next) => {
              paramsFor = `${input.patternId} ${JSON.stringify(next)}`;
              api.setInput(id, { params: next });
            }, '', false);
        }
      });
      return el('section', { className: 'qv-pane qv-input' },
        el('div', { className: 'qv-head mirrorable' },
          el('div', { className: 'qv-title mirrorable' }, el('span', { className: 'qv-badge', textContent: id.toUpperCase() }),
            name, editButton),
          el('div', { className: 'qv-tools mirrorable' }, airPill(pairOf(id)), resetButton)),
        tagLine,
        previewCanvas(id, `Input ${id.toUpperCase()} preview`),
        el('div', { className: 'qv-row qv-shape-row mirrorable' }, field('Pattern', patternSelect), field('Shape', shapeSelect),
          field('Region', regionSelect), more.opener),
        more.pop,
        el('div', { className: 'qv-row mirrorable' },
          field(el('span', {}, 'Brightness ', brightnessOut), brightness), field(el('span', {}, 'Gamma ', gammaOut), gamma),
          el('div', { className: 'qv-field qv-hue' },
            el('span', { className: 'qv-hue-head' }, 'Hue ', hueOut,
              el('label', { className: 'qv-follow', title: 'Follow the main\'s hue, the Hue shift under All inputs' }, follow, 'main')),
            hue),
          helpPopover('This input\'s own brightness, gamma and hue, applied before it is mixed. The receiver\'s brightness and gamma still apply to the whole picture. Hue follows the main\'s (Hue shift, under All inputs) while "main" is ticked; untick it to give this input its own. Key colours still turn it with the key.', 'brightness, gamma and hue')),
        el('div', { className: 'qv-row qv-randoms mirrorable' },
          randomItem(`pattern${id.toUpperCase()}`, 'Random pattern', `The randomizer changes ${id.toUpperCase()}'s pattern. ` +
            'Untick it to keep the pattern, such as the Media Player, whose file the randomizer can still change'),
          randomItem(`shape${id.toUpperCase()}`, 'Random shape', `The randomizer changes ${id.toUpperCase()}'s shape and region`)),
        params);
    },

    pair(pane) {
      const id = pane.of;
      const [first, second] = id === 'left' ? ['A', 'B'] : ['C', 'D'];
      const blend = select(blendOptions(), (value) => api.setPair(id, { mode: value, enabled: true }));
      const fader = range(0, 1, 0.01, (value) => api.setPair(id, { amount: value, enabled: true }));
      fader.setAttribute('aria-label', `Crossfader ${first} to ${second}`);
      const resetButton = button('Reset', () => api.resetPair(id), { className: 'qv-small' });
      resetButton.title = `Show ${first} alone, with a plain crossfade; the patterns are kept`;
      // Whether this pair mixes at all, as the Mixer view's "Mix a second
      // pattern"; moving the fader or choosing a blend turns it on.
      const mix = el('input', { type: 'checkbox' });
      mix.addEventListener('change', () => api.setPair(id, { enabled: mix.checked }));
      const swapButton = button('Swap', () => api.swap(id), { className: 'qv-small' });
      swapButton.title = `${first} and ${second} trade patterns, settings, shapes and trims, and the fader moves so ` +
        'the picture stays. With a combine blend the fader is kept, and Stencil or Overlay change the picture';
      syncs.push(() => {
        const pair = api.pair(id);
        show(blend, pair.mode);
        show(fader, pair.enabled ? pair.amount : 0);
        show(mix, pair.enabled);
      });
      return el('section', { className: 'qv-pane qv-pair' },
        el('div', { className: 'qv-strip mirrorable' },
          previewCanvas(id, `${id === 'left' ? 'Left' : 'Right'} mix preview`),
          el('div', { className: 'qv-strip-lines' },
            el('div', { className: 'qv-line mirrorable' },
              el('div', { className: 'qv-label' }, el('h2', { textContent: id === 'left' ? 'Left' : 'Right' }), airPill(id)),
              el('div', { className: 'qv-fader' }, el('span', { textContent: first }), fader, el('span', { textContent: second }))),
            el('div', { className: 'qv-line mirrorable' }, field('Blend', blend),
              el('div', { className: 'qv-buttons' },
                button(first, () => api.cutPair(id, 0), { className: 'qv-small', title: `Cut to ${first}` }),
                button('Fade', () => api.fadePair(id), { className: 'qv-small', title: 'Fade to the other input over the fade time' }),
                button(second, () => api.cutPair(id, 1), { className: 'qv-small', title: `Cut to ${second}` }),
                swapButton, resetButton)),
            el('div', { className: 'qv-line mirrorable' },
              el('label', { className: 'qv-check', title: `Mix ${second} with ${first}; unticked, ${first} shows alone` }, mix, ` Mix ${second}`),
              randomItem(id === 'left' ? 'blend' : 'blendRight', 'Random blend and amount',
                `The randomizer changes ${id === 'left' ? 'Left' : 'Right'}'s blend and amount while it is mixing`)))));
    },

    master() {
      const fader = range(0, 1, 0.01, (value) => api.setMaster({ position: value }));
      fader.setAttribute('aria-label', 'Main, Left to Right');
      const blend = select(blendOptions(), (value) => api.setMaster({ mode: value }));
      const fadeTime = select(api.fadeTimes.map((s) => ({ value: s, label: `${s} s` })), (value) => api.setMaster({ fadeSeconds: Number(value) }));
      const fadeStart = select(api.fadeStarts, (value) => api.setMaster({ fadeStart: value }));
      const fade = button('Fade', () => api.fade(), { className: 'qv-primary',
        title: 'Fade the main across to the other side over the fade time, starting when Starts says' });
      const swap = button('Swap', () => api.swap('master'), {
        title: 'Left and Right trade places: A with C, B with D, each pair whole; the main\'s fader moves so the picture stays. ' +
          'With a combine blend the fader is kept, and Stencil or Overlay change the picture' });
      const blackout = button('Blackout', () => api.setMaster({ blackout: !api.master().blackout }), { className: 'qv-danger' });
      const reset = button('Reset main', () => api.resetMaster(), { className: 'qv-small' });
      reset.title = 'Everything back to the default look, shared settings included';
      const saveDefault = button('Save as default', () => api.saveDefault(), { className: 'qv-small' });
      saveDefault.title = 'Make the look on screen the default that Reset main brings back';
      const liveCanvas = el('canvas', { className: 'qv-preview', width: 1, height: 1 });
      liveCanvas.setAttribute('role', 'img');
      liveCanvas.setAttribute('aria-label', 'Live: what the stream is sending');
      canvases.live = liveCanvas;
      const liveLabel = el('span', { className: 'qv-pill qv-live' });
      const spectrum = el('canvas', { className: 'qv-mini', width: 128, height: 36 });
      spectrum.setAttribute('role', 'img');
      spectrum.setAttribute('aria-label', 'Audio spectrum');
      // The input gain (Setup's slider, labelled Reactivity there) as a thin
      // vertical slider in the gap between the two small displays it shapes
      // the spectrum of: no height of its own, and the same setting as Setup's.
      const gain = range(0, 4, 0.05, (value) => api.setShared({ gain: value }));
      gain.setAttribute('aria-label', 'Gain');
      gain.setAttribute('aria-orientation', 'vertical');
      const gainBox = el('span', { className: 'qv-gain-box' }, gain);
      const spectrumCaption = el('figcaption', {}, 'Spectrum');
      const beatMap = el('canvas', { className: 'qv-mini', width: 256, height: 192 });
      beatMap.setAttribute('role', 'img');
      beatMap.setAttribute('aria-label', 'Beat map: the last bars, beats lined up across');
      canvases.spectrum = spectrum;
      canvases.beatMap = beatMap;
      // Sparkles, drawn once over the final mix out: the one place for them
      // (Anjin, 2026-10-20). The button, lit while they are on, opens
      // their settings, the on/off first; a row of their own took the Live
      // monitor's room.
      const sparkleSettings = popoverPanel('Sparkles', 'Sparkles over the final mix', api.sparklePanel);
      syncs.push(() => {
        const master = api.master(), fading = api.fading();
        show(fader, master.position);
        fade.textContent = fading ? 'Fading…' : master.position < 0.5 ? 'Fade to Right' : 'Fade to Left';
        show(blend, master.mode);
        const level = api.shared().gain;
        show(gain, level);
        setText(spectrumCaption, `Spectrum · gain ${level.toFixed(2)}×`);
        gain.title = `Gain ${level.toFixed(2)}×: the input's gain, the same as Reactivity on Setup`;
        show(fadeTime, master.fadeSeconds);
        show(fadeStart, master.fadeStart);
        blackout.classList.toggle('qv-on', master.blackout);
        blackout.textContent = master.blackout ? 'Blackout on' : 'Blackout';
        setText(liveLabel, `Live · on stream${fading ? ' · fading' : ''}`);
        const sparklesOn = api.shared().sparklesOn;
        sparkleSettings.opener.classList.toggle('qv-set', sparklesOn);
        sparkleSettings.opener.title = `Sparkles ${sparklesOn ? 'on' : 'off'}: their settings, over the final mix`;
      });
      return el('section', { className: 'qv-pane qv-master' },
        el('div', { className: 'qv-head' }, el('h2', { textContent: 'Main' }),
          helpPopover('The main mixes Left and Right for the stream; every change goes out as you make it. Fade moves it across to the other side over the fade time, at once or from the next beat, bar or phrase.', 'the main'),
          el('div', { className: 'qv-tools' }, saveDefault, reset)),
        el('div', { className: 'qv-monitors' },
          el('figure', { className: 'qv-monitor' }, el('figcaption', {}, liveLabel), liveCanvas)),
        el('div', { className: 'qv-minis' },
          el('figure', { className: 'qv-mini-box' }, spectrum, spectrumCaption),
          gainBox,
          el('figure', { className: 'qv-mini-box' }, beatMap, el('figcaption', {}, 'Beat map'))),
        el('div', { className: 'qv-fader qv-master-fader' }, el('span', { textContent: 'Left' }), fader, el('span', { textContent: 'Right' })),
        el('div', { className: 'qv-row' }, field('Blend', blend), field('Fade', fadeTime), field('Starts', fadeStart)),
        el('div', { className: 'qv-row qv-main-buttons' }, fade, swap, blackout, sparkleSettings.opener),
        sparkleSettings.pop);
    },

    all() {
      const tempo = el('output', { className: 'qv-tempo' });
      const tapUnit = select(api.tapUnits, (value) => api.setShared({ tapUnit: value }));
      // The press, not the release, is the beat; Enter and Space count too.
      const tap = el('button', { type: 'button', textContent: 'Tap (T)' });
      tap.addEventListener('pointerdown', (event) => {
        if (event.button === 0) api.tap();
      });
      tap.addEventListener('keydown', (event) => {
        if ((event.key === 'Enter' || event.key === ' ') && !event.repeat) {
          event.preventDefault();
          api.tap();
        }
      });
      const downbeat = el('button', { type: 'button', className: 'qv-small', textContent: 'Downbeat (D)',
        title: 'Mark this moment as the first beat of the bar; the tempo stays the tracker\'s' });
      downbeat.addEventListener('pointerdown', (event) => {
        if (event.button === 0) api.downbeat();
      });
      downbeat.addEventListener('keydown', (event) => {
        if ((event.key === 'Enter' || event.key === ' ') && !event.repeat) {
          event.preventDefault();
          api.downbeat();
        }
      });
      const follow = button('Detect', () => api.setShared({ followAudio: true }), { className: 'qv-small',
        title: 'Go back to the tempo detected from the audio' });
      const beat = select(api.beatSources, (value) => api.setShared({ beatSource: value }));
      const hue = range(0, 1, 0.01, (value) => api.setShared({ hue: value }));
      const speed = range(0, 3, 0.05, (value) => api.setShared({ speed: value }));
      const hueOut = el('output'), speedOut = el('output');
      // The brightness and gamma of the final picture: the same settings as
      // Brightness and Gamma under Look, kept for each receiver; an input's
      // own sliders trim only that input.
      const brightness = range(0, 1, 0.01, (value) => api.setShared({ brightness: value }));
      brightness.setAttribute('aria-label', 'Main brightness');
      const gamma = range(1, 2.8, 0.05, (value) => api.setShared({ gamma: value }));
      gamma.setAttribute('aria-label', 'Main gamma');
      const brightnessOut = el('output'), gammaOut = el('output');
      const palette = select(api.palettes, (value) => api.setShared({ paletteId: value }));
      const keyColours = el('input', { type: 'checkbox' });
      keyColours.addEventListener('change', () => api.setShared({ keyColours: keyColours.checked }));
      syncs.push(() => {
        const shared = api.shared();
        tempo.textContent = api.tempo();
        show(tapUnit, shared.tapUnit);
        follow.hidden = !shared.tempoManual;
        show(beat, shared.beatSource);
        show(hue, shared.hue);
        show(speed, shared.speed);
        hueOut.textContent = `${Math.round(shared.hue * 360)}°`;
        speedOut.textContent = `${shared.speed.toFixed(2)}×`;
        show(brightness, shared.brightness);
        show(gamma, shared.gamma);
        setText(brightnessOut, `${Math.round(shared.brightness * 100)}%`);
        setText(gammaOut, shared.gamma.toFixed(2));
        show(palette, shared.paletteId);
        show(keyColours, shared.keyColours);
      });
      return el('section', { className: 'qv-pane qv-all' },
        // The downbeat beside the beat count it sets, so it takes no row.
        el('div', { className: 'qv-head' }, el('h2', { textContent: 'All inputs' }), tempo, downbeat),
        el('div', { className: 'qv-row' }, field('Beat from', beat), field('Each tap is', tapUnit),
          tap, follow,
          helpPopover('Tap, or press T, in time with the music: on every beat, or on the first beat of every bar. Two or more taps set the tempo by hand and put it in charge; every tap also pulls the beat, or the bar line, into step. Detect goes back to the tempo found in the audio. Downbeat, or D, marks the first beat of a bar: while the tempo is detected it moves only which beat is first, so the beats stay the tracker\'s; on the manual tempo it sets the bar line from the press. The other tempo settings are on the Setup view.', 'tap tempo')),
        el('div', { className: 'qv-row' }, field(el('span', {}, 'Hue shift ', hueOut), hue), field(el('span', {}, 'Speed ', speedOut), speed)),
        el('div', { className: 'qv-row qv-all-look' },
          field(el('span', {}, 'Brightness ', brightnessOut), brightness,
            { title: 'How bright the final picture is, for the stream and the preview. The same setting as Brightness under Look, kept for each receiver' }),
          field(el('span', {}, 'Gamma ', gammaOut), gamma,
            { title: 'The final picture\'s gamma: raise it to dim the shadows of a panel that looks washed out. The same setting as Gamma under Look, kept for each receiver' })),
        el('div', { className: 'qv-row' }, field('Palette', palette),
          el('label', { className: 'qv-check' }, keyColours, ' Key colours')),
        el('div', { className: 'qv-row' }, randomItem('colour', 'Random hue shift and palette',
          'The randomizer changes the Hue shift and the palette')));
    },

    output() {
      const stream = button('', () => api.toggleStream(), { className: 'qv-primary' });
      const status = el('span', { className: 'qv-note' });
      const randomizer = el('input', { type: 'checkbox' });
      randomizer.addEventListener('change', () => api.setRandomizer({ enabled: randomizer.checked }));
      // The waits every randomizer item draws from, whole numbers in their
      // unit: seconds, beats or bars.
      const wait = (key) => {
        const input = el('input', { type: 'number', min: 1, max: 3600, step: 1, required: true });
        input.addEventListener('change', () => {
          if (input.checkValidity()) api.setRandomizer({ [key]: Number(input.value) });
        });
        syncs.push(() => show(input, api.randomizer()[key]));
        return input;
      };
      const unit = select(api.waitUnits, (value) => api.setRandomizer({ unit: value }));
      syncs.push(() => show(unit, api.randomizer().unit));
      syncs.push(() => {
        const output = api.output();
        stream.textContent = output.streaming ? 'Stop streaming' : 'Start streaming';
        status.textContent = output.status;
        show(randomizer, api.randomizer().enabled);
      });
      return el('section', { className: 'qv-pane qv-output' },
        el('div', { className: 'qv-head' }, el('h2', { textContent: 'Output and sequencing' })),
        el('div', { className: 'qv-row' }, stream, button('Hotsave', () => api.hotsave())),
        status,
        // Two rows, as before the unit: the switches, then the waits.
        el('div', { className: 'qv-row qv-random-row' }, el('label', { className: 'qv-check' }, randomizer, ' Randomizer'),
          randomItem('media', 'Random Media Player file',
            'While an input shows the Media Player, the randomizer changes its file from the folder chosen on the Patterns view')),
        el('div', { className: 'qv-row qv-wait-row' },
          field('Shortest wait', wait('minWait')), field('Longest wait', wait('maxWait')), field('Counted in', unit),
          helpPopover('Each ticked Random item, in the pane it changes, waits a new time between the shortest and longest wait after every change, counted in seconds, or in beats or bars of the tempo, ending on a beat or a bar line. B\'s items and Left\'s blend run while Left is mixing, D\'s and Right\'s while Right is; "idle" means waiting for that. A playlist playing pauses the randomizer.', 'the randomizer')),
        el('p', { className: 'qv-note', textContent: 'Receiver, audio input and playlists are on the Setup and Playlist views.' }));
    },
  };

  const view = renderLayout(container, layout, components);
  const refresh = () => syncs.forEach((sync) => sync());
  refresh();

  // Draws the previews from the renderer's strip (readPreviews), each tile
  // into its canvas, top row first.
  const drawPreviews = (names, pixels, tileWidth, tileHeight) => {
    const stride = tileWidth * names.length * 4;
    names.forEach((name, i) => {
      const canvas = canvases[name];
      if (!canvas || canvas.offsetParent === null) return;
      if (canvas.width !== tileWidth || canvas.height !== tileHeight) {
        canvas.width = tileWidth;
        canvas.height = tileHeight;
      }
      const context = canvas.getContext('2d');
      const image = context.createImageData(tileWidth, tileHeight);
      for (let y = 0; y < tileHeight; ++y) {
        const from = (tileHeight - 1 - y) * stride + i * tileWidth * 4;
        image.data.set(pixels.subarray(from, from + tileWidth * 4), y * tileWidth * 4);
      }
      context.putImageData(image, 0, 0);
    });
  };

  // The stream's frame, as sent, into the Live monitor.
  const drawLive = (rgb, width, height) => {
    const canvas = canvases.live;
    if (canvas.offsetParent === null) return;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const context = canvas.getContext('2d');
    const image = context.createImageData(width, height);
    for (let i = 0, j = 0; i < rgb.length; i += 3, j += 4) {
      image.data[j] = rgb[i];
      image.data[j + 1] = rgb[i + 1];
      image.data[j + 2] = rgb[i + 2];
      image.data[j + 3] = 255;
    }
    context.putImageData(image, 0, 0);
  };

  return { refresh, drawPreviews, drawLive, canvases, update: (next) => view.update(next) };
}
