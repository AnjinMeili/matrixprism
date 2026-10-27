# README artwork and screenshots

The images used by the top-level [README](../../README.md): a banner,
section headers, feature tiles, a pattern gallery, screenshots of the
composer and contact sheets of pattern frames. The drawn ones are SVG made
by code ([src/build.mjs](src/build.mjs)) and rendered to PNG in headless
Chrome; the rest come from the composer's own tools. Everything is a still:
no video or animation.

Colours: near-black blue and purple grounds, an LED dot grid, neon cyan
`#2ee6ff`, magenta `#ff4fd8`, green `#4dff9e`, violet `#9b7bff`, blue
`#4d8dff` and rose `#ff5c8a`. Type: [Exo 2](src/fonts/OFL.txt) (SIL Open
Font License 1.1; see [CREDITS.md](../../CREDITS.md)), kept as real text in
the SVGs. The SVGs load the font from `src/fonts/` by a relative path, so
opened elsewhere they fall back to a system sans; the PNGs are what the
README uses.

## Files

| File | Pixels | What it is for | How it was made |
|------|--------|----------------|-----------------|
| `banner.png` | 1280×320 | The top of the README: the wordmark and the line "Music-driven visuals for LED matrix panels" | `build.mjs` (`--only banner`), from `svg/banner.svg` |
| `header-quick-start.png` | 1280×120 | Section header, Quick start | `build.mjs` (`--only headers`) |
| `header-composer.png` | 1280×120 | Section header, What the composer does | as above |
| `header-patterns.png` | 1280×120 | Section header, Patterns | as above |
| `header-receivers.png` | 1280×120 | Section header, Receivers | as above |
| `header-going-live.png` | 1280×120 | Section header, Going live | as above |
| `tile-patterns.png` | 256×256 | Feature tile: Patterns, "140+ at the panel's size" | `build.mjs` (`--only tiles`) |
| `tile-quad-mixer.png` | 256×256 | Feature tile: Quad mixer, A and B to Left, C and D to Right, then the main | as above |
| `tile-tempo-key.png` | 256×256 | Feature tile: Tempo & key, beat, BPM and the Camelot key | as above |
| `tile-spectrum.png` | 256×256 | Feature tile: Spectrum, stereo spectra and bands | as above |
| `tile-midi.png` | 256×256 | Feature tile: MIDI, pads for Tap and Downbeat | as above |
| `tile-record.png` | 256×256 | Feature tile: Record, the preview and audio to MP4 | as above |
| `tile-go-live.png` | 256×256 | Feature tile: Go live, to YouTube in the panel's shape | as above |
| `tile-receivers.png` | 256×256 | Feature tile: Receivers over DDP, WLED or `matrix-dmx` | as above |
| `tile-desktop-app.png` | 256×256 | Feature tile: the desktop app, macOS, Windows and Linux | as above |
| `pattern-gallery.png` | 1280×676 | Eight patterns, one frame each, with their names and where they come from | `build.mjs` (`--only gallery`) writes `src/gallery.html`, which crops one frame from each contact sheet below, and renders it |
| `patterns/<id>.png` | 1044×396 | Contact sheets, eight frames each, of `spectrum-lab`, `aurora-curtains`, `fire-2d`, `kaleido`, `aurora-flowfield`, `auroradrop-show`, `fibonacci-bloom` and `tme-67` | In `composer/`: `node tools/pattern-frames.mjs <id> ../docs/media/patterns/<id>.png --size 256x192 --frames 8 --scale 1` (the real renderer on simulated audio; scale 1 keeps the files small) |
| `screens/mixer.png` | 2036×1183 | The Mixer view: inputs A to D with their previews, the Left and Right pairs, the main | A screenshot by the maintainer of a look in use; checked: no receiver, host, audio device or stream key shown (the key field says only "set") |
| `screens/monitor.png` | 1440×757 | The Monitor view: the preview, the pattern picker and the Key panel's Camelot wheel | In `composer/`: `npm run check-monitor-key -- --screenshot <file.png>` |
| `contact-sheet.png` | 1324×1910 | Every file above on one sheet, to look at them all at once; not used by the README | `node docs/media/src/build.mjs --sheet <out.png>`, then halved: `ffmpeg -i <out.png> -vf scale=1324:-1:flags=lanczos -pix_fmt rgb24 -pred mixed -compression_level 9 docs/media/contact-sheet.png` |

`svg/` holds the SVG behind each drawn PNG. `src/` holds the build script,
the generated gallery page, the font and `optimise.sh`.

## Making them again

From the repository's root, with Chrome installed (set `CHROME` if it is
not found) and FFmpeg for the last step:

```sh
node docs/media/src/build.mjs      # SVGs, banner, headers, tiles, gallery
sh docs/media/src/optimise.sh      # re-encode the PNGs losslessly, smaller
```

`optimise.sh` keeps a re-encoded PNG only if its decoded pixels have the
same MD5 as before. The contact sheets and screenshots are made by the
composer's tools as in the table; run them before the gallery.

## Checks made

- **Privacy.** Every screenshot was looked at before it was kept: none
  shows a receiver or host name, an audio device, a file path or a user
  name. The checks run their own server with no receiver set and Chrome's
  fake audio device in a throwaway profile; the only stream key text is
  the page's generic "Set YOUTUBE_STREAM_KEY to go live". The files' bytes
  were also searched for paths, user names and network addresses, with no
  match.
- **Accuracy.** Every claim on the artwork is taken from the README,
  `composer/README.md` or `docs/roadmap.md`. Pattern names and sources are
  those in `composer/public/patterns.js` and `CREDITS.md`. "140+" is used
  instead of an exact count.
- **Light and dark.** The PNGs were laid out on white and on GitHub's dark
  background (`#0d1117`) and looked at; frames have transparent corners and
  read on both.
- Not checked: how GitHub itself renders the README (the images were only
  seen in headless Chrome), and the SVGs opened on their own.
