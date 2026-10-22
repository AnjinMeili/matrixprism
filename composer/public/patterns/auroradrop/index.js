// Composer patterns for the AuroraDrop port. See ./NOTICE.md.
import { AuroraDropAnimation } from './runtime.js';
import { EFFECTS } from './effects.js';
import { AUDIO_PATTERNS } from './audio-patterns.js';

export const AURORADROP_GROUP = 'AuroraDrop';

const entry = (id, name, description, spec) => ({
  id: `auroradrop-${id}`,
  name: `AuroraDrop ${name}`,
  group: AURORADROP_GROUP,
  audio: `${description} (AuroraDrop port; follows the audio spectrum)`,
  audioReactive: true,
  // With no audio at all most of these draw nothing.
  needsAudio: true,
  controls: [],
  createInstance: (width, height, random = Math.random) =>
    new AuroraDropAnimation(spec, width, height, random),
});

export const AURORADROP_PATTERNS = [
  // The whole thing, as AuroraDrop runs it: a processing effect and two
  // audio patterns, each replaced at random every ten seconds.
  entry('show', 'Show', 'Two random audio patterns over a random processing effect, changing every ten seconds', {
    effects: EFFECTS,
    patterns: AUDIO_PATTERNS.filter(pattern => pattern.inShow).map(pattern => pattern.Pattern),
    layers: 2,
  }),
  // Each audio pattern on its own, still over a random processing effect.
  ...AUDIO_PATTERNS.map(({ id, Pattern, description }) =>
    entry(id, Pattern.title, description, { effects: EFFECTS, patterns: [Pattern], layers: 1 })),
];
