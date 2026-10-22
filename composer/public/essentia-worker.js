// The Essentia beat source's worker (T28): takes the input's samples from
// pcm-capture-worklet.js, by way of the page, and every two seconds runs
// Essentia's tempo extractor on the last ten (essentia-tempo.js), off the
// page's thread. Messages in: { type: 'start', sampleRate } and
// { type: 'samples', samples, end }, where `end` is the audio context's time
// at the last sample. Messages out: { type: 'ready' } once Essentia has
// loaded, { type: 'estimate', bpm, confidence, lastBeat, end }, and
// { type: 'error', message }.
import { EssentiaTempo, loadEssentia } from './essentia-tempo.js';

let essentia = null, tempo = null, sampleRate = null;

loadEssentia(new URL('./vendor/essentia/', import.meta.url).href).then((loaded) => {
  essentia = loaded;
  if (sampleRate) tempo = new EssentiaTempo(essentia, sampleRate);
  postMessage({ type: 'ready' });
}, (error) => postMessage({ type: 'error', message: `Essentia did not load: ${error.message || error}` }));

onmessage = ({ data }) => {
  try {
    if (data.type === 'start') {
      sampleRate = data.sampleRate;
      tempo = essentia ? new EssentiaTempo(essentia, sampleRate) : null;
    } else if (data.type === 'samples' && tempo) {
      tempo.push(data.samples);
      if (tempo.due) postMessage({ type: 'estimate', ...tempo.estimate(), end: data.end });
    }
  } catch (error) {
    postMessage({ type: 'error', message: String(error.message || error) });
  }
};
