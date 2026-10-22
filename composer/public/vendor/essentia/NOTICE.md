# Essentia.js, for the Essentia beat source and the audio comparison

These are two files from [Essentia.js](https://mtg.github.io/essentia.js/)
0.1.3 by the Music Technology Group, Universitat Pompeu Fabra, taken
unchanged from the npm package `essentia.js-0.1.3.tgz`. The package's
sha512, checked on 2026-10-14, matched the registry's:
`vVEPgeVMEBLRXbM5o5H5Rgu53EPHu25vyFKYg+flWLzI/nEoegJQez9FKRv8GR/KxIBwm+fXDEFL+MkQeoHaLw==`.

| File | sha256 | What |
|---|---|---|
| `essentia-wasm.es.js` | `8eab1366…ce1ea927` | Essentia compiled to WebAssembly, embedded as a data URI, as an ES module |
| `essentia.js-core.es.js` | `45f1a3cd…0e640` | The JavaScript API over it |

The licence is AGPL-3.0 (`LICENSE`, copied from the same package), accepted
for this project on 2026-10-13. Its network clause (§13) asks that anyone
using a served copy can get its source; MatrixPrism's public repository is
that source, and a modified copy served to others must offer its own.

These files are loaded by the composer only when **Beat from** is set to
Essentia (`essentia-tempo.js`, run in `essentia-worker.js`), and by the audio
comparison tools (T26, T28). Moved here from `tools/vendor/` on 2026-10-14,
unchanged, so the page can load them. Neither downloads anything when loaded.
The core's `fetch` calls are inside a helper that loads audio from a URL,
which neither the composer nor the tools use.

Essentia.js has had no release since 0.1.3 on 24 June 2021; see "Risks" in
`docs/audio-features-plan.md`. Its tempo extractor, `RhythmExtractor2013`,
takes no sample rate and expects 44.1 kHz audio.
