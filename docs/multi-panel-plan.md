# Plan: several receivers as windows onto one canvas (T35)

**Status: for future work (2026-10-15).** Nothing is built.

## The request

Anjin, 2026-10-15:

- First: "would be interesting to support multiple panels as well".
- Then the shape of it: "multiple receivers with displays of any size,
  merged [into] a single canvas as windows".

The development setup has several receivers of different sizes on one
network already, from 96×64 to 256×192.

## What it means

- **One canvas.** The composer renders one picture, the canvas, at a size of
  its own, as it renders one panel's picture today. Patterns, the mixer,
  shapes, overlays and sparkles all work on the canvas and know nothing of
  panels.
- **Windows.** Each receiver shows a rectangle of the canvas: its window,
  with a position, and a size that is the panel's own (read from its
  `/json/info`, as T32 does). Windows may be any size. They may also:
  - leave gaps, for bezels or space between panels, so a line runs on across
    the gap as it would through a window;
  - overlap, to show the same part twice;
  - sit anywhere, to make a wall, a strip or a scatter.
- **One composer drives all of them.** Each receiver gets its own window's
  pixels, every frame, from the same render. Two composers on one panel
  already fight over it (see "The panel against the preview" in [findings.md](findings.md#the-panel-against-the-preview)); one composer
  for many panels avoids that by design.

## How it could work

- **Settings:** a list of panels replaces the one host and size:
  `panels: [{ host, ddpPort, x, y, width, height, enabled }]`, plus the
  canvas size.
  - **Migration:** settings from before become a canvas the size of the one
    panel, with that panel as its only window.
  - **The command line:** `--ddp` could take several hosts.
- **Sizes:** each window's size is read from its receiver before streaming
  (T32), one by one. A receiver that cannot be read keeps the size set, with
  a warning naming it.
- **Rendering:** at the canvas size, read back once a frame.
- **Cutting and sending:** either side could cut the windows out.
  - **In the server (preferred):** the page sends the whole canvas as now,
    and the server keeps a DDP target per panel and sends each its window's
    rows. One WebSocket message a frame, and the cutting stays beside the DDP
    code. It sends the canvas over the local socket even where it has gaps,
    which is cheap on one machine.
  - **In the page:** it sends each window as its own message. Less data
    where the canvas has gaps, but more messages.
- **The preview** shows the canvas with each window outlined and named, and
  greys out what no panel shows.
- **A layout editor:** each window as a rectangle on the canvas, to drag
  into place and nudge by the pixel. Its size comes from the panel, and a
  button sets the canvas to just cover the windows.
- **Per-panel settings,** since panels differ:
  - brightness and gamma (see "The panel against the preview" in [findings.md](findings.md#the-panel-against-the-preview));
  - rotation and mirroring, for panels mounted on their side;
  - on or off.
- **Status per panel:** reachable or not, its size, frames sent.

## Questions for Anjin when this is taken up

- **Scale:** is a window always one canvas pixel to one panel pixel, or can a
  small panel show a larger region scaled down (or a large one a small region
  scaled up)? Pixels one to one keep lines continuous across panels of the
  same pitch; scaling allows panels of different pitch to line up by size.
- **The layout:** how the panels sit physically, and whether the gaps
  between them should count in the canvas.
- **Receivers:** whether they all run `matrix-dmx`, or some are other WLED
  devices. Both speak DDP and answer `/json/info`.
- **Patterns at odd shapes:** a canvas that is a long strip or a sparse
  scatter suits some patterns better than others, which ties in with
  categories (T33): "for the wall", "for the strip".
- **Timing:** frames go to every panel in the same tick, but over Wi-Fi they
  may land a frame apart. Is that acceptable, or is a dedicated network
  wanted first (as already noted for bigger packets)?

## Steps

1. **Settings, migration and the panel list.** The page still streams one
   panel, now as the only window of a canvas.
2. **The server:** a target per panel, and cutting windows from the canvas,
   with tests on the cutting (edges, gaps, overlaps, windows that run past
   the canvas).
3. **The size read for every panel** before streaming, and per-panel status.
4. **The layout editor** and the outlined preview.
5. **Per-panel brightness, gamma, rotation and mirroring.**
6. **Several hosts on the command line.**

Since the server relays to more targets, step 2 needs the security review
that `AGENTS.md` asks for on `server.js`.

## Relation to other plans

- **T34 (UI):** the panel list and layout editor belong to the cleaned-up
  Setup.
- **T33 (library):** categories could mark patterns that suit a layout.
- **T16 (paired mixer):** an alternative to one canvas would be a different
  composition per panel. Anjin chose one canvas with windows; that
  alternative is left aside.
