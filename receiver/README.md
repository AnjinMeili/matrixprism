# MatrixPrism receiver

The receiver half of [MatrixPrism](../README.md). `matrix-dmx` displays pixel
data from Art-Net, sACN (E1.31), and DDP (Distributed Display Protocol) on a
Raspberry Pi RGB LED matrix, and records and plays back what it displays.
`scene-tool` trims, recovers and sequences those recordings. It uses the
[rpi-rgb-led-matrix library](https://github.com/hzeller/rpi-rgb-led-matrix)
for matrix output.

The receiver stands alone: it takes pixel data from any Art-Net, sACN or DDP
sender, not only from the MatrixPrism [composer](../composer/README.md).

## Build

Clone the MatrixPrism repository with its matrix submodule, then build in
this directory on a supported Raspberry Pi:

```sh
git clone --recursive https://github.com/AnjinMeili/matrixprism.git
cd matrixprism/receiver
make
```

Everything the receiver needs is in this directory: its sources, its
`Makefile`, and the matrix library as the `matrix` submodule. All commands
below are run from here.

`make test` runs protocol, pixel-mapping, recording, playback, trimming, and
scene CLI tests on a regular development machine without matrix hardware.
`make scene-tool` builds just the hardware-independent scene editor.

## Run

Start the protocol listeners:

```sh
sudo ./matrix-dmx
```

The receiver listens for Art-Net on UDP 6454, sACN on UDP 5568, and DDP on UDP
4048. It also advertises itself as a WLED-compatible node via mDNS (`_http._tcp`
and `_wled._tcp`) and answers WLED's JSON API on HTTP port 80, so that apps
written for WLED, such as LedFx, can stream to panels larger than WLED itself
drives:

- `GET /json/info`, `/json/state`, `/json/si`, `/json`, `/json/cfg`,
  `/json/eff`, `/json/pal`, `/json/nodes` and `/presets.json`, and a short
  page at `/`.
- It reports WLED 0.15.0 and that version's build number (2412100). LedFx
  streams DDP to builds from 2110060 and WLED's older UDP realtime protocol
  (port 21324) below that, which this receiver does not take.
- The info response reports the logical matrix as WLED 2D dimensions
  (`leds.matrix.w` and `leds.matrix.h`), and state reports one full-panel 2D
  segment (`start`/`stop` for X, `startY`/`stopY` for Y). `/json/cfg` holds
  the identity, LED count, matrix and live-input settings that clients read.
- `POST /json/state`, `/json/si`, `/json` and `/json/cfg` are accepted and
  answered `{"success":true}`, but change nothing: what is shown comes from
  the streams. There is one effect ("Solid") and one palette ("Default").
- DDP data remains row-major RGB, starting at the top-left pixel.

mDNS replies to queries from a port other than 5353 (legacy unicast) go back
to the sender with its question repeated and without the cache-flush bit, as
RFC 6762 asks. If discovery cannot
start (for example HTTP port 80 is in use, or no IPv4 interface is up yet) the
receiver logs a warning and keeps serving Art-Net, sACN and DDP; pass
`--no-wled` to turn discovery off deliberately. mDNS replies are only sent for
queries about this node's own host and service names. Art-Net starts at
universe 0 and sACN starts at universe 1. To select
different starting universes:

```sh
sudo ./matrix-dmx --artnet-universe 1 --sacn-universe 10
```

To troubleshoot traffic, run with `--debug`. It reports received and
accepted packet counts, byte offsets, push flags, applied data and display
swaps once per second. Rejected packets are sampled with their first 24 bytes
and the standard DDP header interpretation, to identify incompatible layouts.
The summary includes measured packet/frame rates and average drawing and
VSync-wait times. Low packet rates indicate sparse incoming traffic; high
drawing or VSync times indicate receiver-side rendering delays. Debug mode
does not print a line for every display swap.
Art-Net and sACN summaries also show applied packets, frame rates, pending
universes and rendering/VSync timings.
For all three protocols, `render-fps` is the number of completed display swaps
divided by the measured log interval, including partial-frame timeout swaps.
This is the displayed content frame rate, not the panel's hardware scan refresh
rate reported by `--led-show-refresh`.

The process joins the sACN multicast groups needed for the configured matrix
size, distributing memberships across sockets to work within Linux's
per-socket multicast membership limit. It also accepts unicast sACN. Art-Net
and DDP packets are accepted on the bound network interfaces. WLED-style
discovery uses a `wled-<last-6-MAC-digits>.local` hostname. Use Ctrl-C to stop
the receiver.

Art-Net scans are supported through ArtPollReply on UDP 6454. The receiver
advertises its configured universe range in groups of up to four output ports.
Replies use the local IPv4 address routed toward the scanning controller.
With `--debug`, each answered scan logs the advertised universe range.
DDP streaming and WLED discovery do not depend on an Art-Net scan.

DMX data is interpreted as consecutive RGB triples in row-major matrix order.
Each universe carries 170 pixels (510 DMX slots); the remaining two slots are
unused. A matrix larger than 170 pixels consumes consecutive universes. Art-Net
uses its 0-based universe numbering, and sACN uses its 1-based numbering.
DDP accepts standard RGB with 8-bit components (data type `0x0b`) and the
previously supported `0x01` encoding. RGB data is written at the byte offset
in each DDP packet. DDP push flags
trigger a display update after a frame. Art-Net and sACN update the display
after all configured universes arrive, rather than redrawing once per universe;
an incomplete frame is flushed after 40 ms from its first pending update.
Additional packets do not reset this deadline, so a continuously updated
subset of universes does not prevent rendering. Queued packets are read in
bounded batches to reduce backlog without starving other protocol listeners.

### Pixel Animator 3 compatibility

Pixel Animator 3 can send either standard DDP or an observed 12-byte custom
layout. The default `--ddp-format=auto` accepts both: each packet is checked
against the strict Pixel Animator layout first, then parsed as standard DDP.
Use `--ddp-format=pixel-animator` or `--ddp-format=standard` to force one
parser. The custom layout has 16-bit sequence/output fields, the byte offset
at bytes 6-9, and the payload length at bytes 10-11. It accepts RGB data for
output ID 1.

The captured compatibility packets set the flag on every chunk, so this mode
renders when a chunk reaches the end of the configured matrix buffer, or on
the partial-frame timeout, rather than swapping on every packet. Match the
sender's pixel count to the matrix dimensions. This is compatibility with the
captured format, not a claim that these packets follow standard DDP.

Matrix options from `rpi-rgb-led-matrix` are supported, for example:

```sh
sudo ./matrix-dmx --led-rows=32 --led-cols=64 --led-chain=2 \
  --led-gpio-mapping=adafruit-hat
```

The program needs root privileges to initialize the GPIO matrix hardware. It
drops privileges after hardware initialization according to the matrix
library's runtime options.

The UDP sockets request a 4 MB receive buffer so a full-matrix DDP burst is
not dropped while the display is busy. Linux caps this at `net.core.rmem_max`
unless the process still has `CAP_NET_ADMIN`; if `--debug` shows partial
frames, raise the cap on the Pi with
`sudo sysctl -w net.core.rmem_max=4194304`.

## Save stream segments

Add `--record` to your working receiver command, keeping all your usual matrix
and sender-format options:

```sh
sudo ./matrix-dmx --record segment.mrgb --record-seconds 30
```

Recording captures each displayed logical RGB frame and its presentation
timestamp, regardless of whether it came from Art-Net, sACN, or DDP. It does
not save raw network packets. Timing starts with the **first displayed frame**,
not when the receiver starts. `--record-seconds` is optional; without it,
recording continues until Ctrl-C or SIGTERM.

At the duration limit the file is finalized automatically and the receiver
**continues displaying the live stream** without further recording. The last
frame is held through any period without new frames. Wait for the `Saved ...
frames` message before opening the file. Recording filenames must be new:
existing files are never overwritten.

Files are opened before the matrix library drops privileges. If no frame is
received, the reserved file is empty/unfinished and not playable. Interrupted
recordings (power loss, SIGKILL, or a receiver/storage error) are not finalized
and will be rejected by playback. Errors are reported; storage errors stop
the receiver rather than silently losing frames.

Storage is **uncompressed**: approximately `width * height * 3 * FPS` bytes
per second, plus small timestamp/header overhead. A 256x192 display at 30 FPS
uses about **4.4 MB/s, or 265 MB/minute**. Recording writes synchronously and
can slow reception on slow storage; prefer a fast local disk/SSD over a network
mount. Without `--record`, the live stream does no recording IO.

## Playback

Use the same matrix geometry, mapping, and hardware settings used to record:

```sh
sudo ./matrix-dmx --play segment.mrgb
sudo ./matrix-dmx --play segment.mrgb --loop
sudo ./matrix-dmx --scene show.scene --loop
```

These examples use default matrix options; append your working matrix flags
for your actual display. Playback validates the complete playlist before
displaying it, requires an exact match to the logical matrix width/height,
and does not start UDP listeners, HTTP, or mDNS discovery. It preserves frame
order and uses recorded timing with monotonic deadlines; actual presentation
is limited by matrix drawing, VSync, and storage speed. It does not drop frames
when playback falls behind. Brightness and luminance correction are controlled
by the playback matrix options, not embedded in recordings.

Playback exits after one pass, or repeats with `--loop`. Ctrl-C/SIGTERM stops
playback, including while holding a frame. The panel is cleared on exit.
`--record` cannot be combined with `--play` or `--scene`; `--loop` requires
playback, and `--record-seconds` requires `--record`.

## Minimal scene editing

A recording that was cut off before it could be finished (power loss or a
killed process) is rejected by playback. `scene-tool recover` copies its
complete frames into a new playable recording; the last frame is held for one
more frame interval because the true end time is unknown.

The `scene-tool` CLI requires neither matrix hardware nor root privileges.
Times are in seconds (fractional values accepted), and clip indices start at 1.

```sh
./scene-tool info segment.mrgb
./scene-tool trim segment.mrgb short.mrgb 2 8
./scene-tool recover interrupted.mrgb playable.mrgb
./scene-tool create show.scene short.mrgb segment.mrgb
./scene-tool list show.scene
./scene-tool range show.scene 2 5 12
./scene-tool add show.scene segment.mrgb 0 3
./scene-tool move show.scene 3 1
./scene-tool remove show.scene 2
```

`trim` creates a new recording without modifying its input. `range` changes
only a playlist entry's in/out points; `move` arranges clips, `add` appends,
and `remove` deletes an entry. A scene must retain at least one clip, all
recordings must have the same dimensions, and every range must satisfy
`0 <= start < end <= recording duration`. Ranges are end-exclusive. A trim
starting between frames uses the frame already active at its start, and
preserves the final frame hold.

`create` refuses to overwrite an existing scene. Editing replaces the scene
atomically after validation. Scenes reference recordings rather than copying
RGB data; keep the referenced files. The editor saves paths relative to the
scene directory, so moving the scene and recordings together (or using the
same mounted directory on the Mac and Pi) preserves the references. Absolute
paths are also accepted when loading a manually edited scene. Edits provide
cuts and ordering, not graphical painting, fades, or transitions.

### Recording and scene formats

`.mrgb` is a 32-byte header (`MRGB0001`, 32-bit width/height, 64-bit frame count,
64-bit total duration in microseconds), followed by records consisting of a
64-bit relative timestamp and `width * height * 3` row-major RGB bytes. All
numbers are little-endian. The first timestamp is zero, timestamps must not
decrease, and the duration must exceed the last timestamp. Dimensions are
limited to 16 million pixels and durations to one year. Unfinished, malformed,
and truncated files are rejected.

`.scene` is UTF-8-compatible plain text with first line `MATRIX-SCENE-1`;
each following line is `recording-path<TAB>start-us<TAB>end-us`.
Paths cannot contain tabs or newlines. Playback reads one RGB frame at a time
and keeps a small timestamp index, rather than loading all RGB frames into RAM.
