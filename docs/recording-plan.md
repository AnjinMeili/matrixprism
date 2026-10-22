# Plan: preview recording with audio (T47)

Status: implemented, and in `main` since 2026-10-21. Record and Stop on the
Mixer view capture the final preview with the live audio and save an MP4,
with software or Mac hardware H.264. Measured in
[findings.md](findings.md#recording-the-preview).

Still open: a 30-minute run with a real input (sync drift, memory, CPU, with
streaming on and off), the HandBrake comparison, the choice of final
fidelity, and Safari.

## Goal and agreed scope

Save the final composed preview with the actual audio feeding its analysis,
compressed for sharing and feedback. The selected receiver supplies the
dimensions only. Recording must work without DDP sending or a reachable receiver,
and must not inherit a receiver's sending limit or network losses.

- Capture the final main composition, including transitions, sparkles,
  overlays, brightness, gamma and blackout. Do not record the UI or submixes.
- Keep the receiver dimensions fixed from Start until Stop. A receiver or
  size change during recording must be rejected or require stopping first.
- Use the captured audio stream, not spectra, synthetic music or a second
  independent device capture. Preserve its actual channel layout and rate;
  do not assume that the input is stereo. Missing or ended audio is an error,
  not permission to make an apparently successful silent recording.
- Save locally with bounded queues and incremental disk writes. Target
  H.264/AAC MP4; determine bitrate from measurements at panel dimensions,
  rather than adopting HD defaults. Never overwrite an existing file.
- Keep the panel's aspect ratio and pixel appearance. No HD re-rendering,
  enlargement, physical-panel simulation or receiver-side recording.
- Future live publishing should reuse capture and encoding boundaries, but
  YouTube credentials, publishing, reconnects and remote hosts are not MVP.

## Architecture decision and final review

Capture in the composer; encode and write in a small local media service
using FFmpeg. Keep capture, timestamped transport, encoder and destination
separate. The service may be a local worker process managed by the Node
server; this does not require a new network daemon or receiver application.

Browser-only MediaRecorder is a useful prototype or transport candidate, not
an assumed solution: codec support, timestamp behaviour, chunk delivery and
lossy re-encoding must be measured. HandBrake uses FFmpeg libraries and other
encoder libraries, not merely the installed FFmpeg executable. HandBrakeCLI
is an optional file-transcoding comparison, not the live service backend.

The review identifies these implementation gates:

1. **Timing is the largest risk.** Audio sample time and frame presentation
   time need one mapped timeline. Raw RGB piped at a declared frame rate
   does not preserve irregular rendering times. Use a timestamp-carrying
   transport/container, or explicitly schedule frames against the audio
   clock and duplicate the last picture for gaps. Do not speed video up to
   hide dropped frames. Test both fixed offset and drift before choosing.
2. **Capture is not analysis.** Take audio from the browser's existing input,
   not FFmpeg's macOS input capture: earlier project measurements found
   dropped samples in that capture path. Do not alter the analysis routing
   or audible monitoring. Muted Media Player videos are not an extra audio
   source in this MVP. Simulated analysis without real audio is unsupported.
3. **Avoid two lossy encodes.** Compare any browser-encoded transport with a
   timestamped raw/lossless path before settling it. Native-frame transfer
   has bandwidth and conversion costs even with hardware encoding.
4. **Hardware support must be exercised.** Listing VideoToolbox is not proof
   of a working hardware encoder at a given size. Require a hardware-only
   probe and record failures; do not silently label software fallback as
   hardware. Keep software x264 as a candidate, not an automatic default.
5. **Pixel fidelity is qualified.** H.264 with broadly compatible 4:2:0
   chroma can damage saturated one-pixel edges. Inspect enlarged frames as
   well as quality metrics. Pad odd dimensions only if required, preserving
   the content rectangle and documenting encoded versus source dimensions.
   Do not silently scale to satisfy an encoder's minimum dimensions.
6. **Failure must be bounded and visible.** Define Start/Recording/Stopping/
   Saved/Error states, queue limits, device-loss handling and process cleanup.
   Disk-full and encoder failures must not stall rendering or DDP sending.
   Use a partial-file strategy; claim Saved only after successful finalizing.
7. **A local encoder is a security boundary.** Before adding endpoints,
   review Origin/Host enforcement, session ownership, payload and dimension
   limits, safe filename handling and process limits. Spawn with argument
   arrays, never shell interpolation or arbitrary client encoder flags.
   No LAN listener, user-supplied output URL or secrets in MVP.

## Implementation stages

### 1. Capabilities and reproducible encoder comparison

Inventory FFmpeg/ffprobe and optional HandBrakeCLI versions. Encode the same
lossless source with VideoToolbox H.264 (hardware required) and software
x264. Keep the source and media artifacts outside git; retain the commands,
tool versions, source hash, logs and machine-readable results with
the report. Missing HandBrake is reported, not installed implicitly.

Begin with a deterministic synthetic A/V fixture at 256x192 and 30 fps to
exercise the toolchain. This is not evidence of composed-pattern quality,
live capture performance, or A/V synchronization. Follow with actual
composer clips at multiple receiver dimensions, including odd/small sizes.

Compare equal requested bitrates using actual output size, speed and decoded
quality, then visually matched quality at different bitrates. x264 CRF and
VideoToolbox quality numbers are not equivalent. Include sharp text/edges,
gradients, transitions and dense sparkles. Keep audio settings identical.
HandBrake comparisons must record its presets and library versions, not
attribute every difference to the frontend.

### 2. Timestamped capture proof, without production UI

Capture the existing renderer output once per frame and the shared browser
audio input. Establish the common clock, transport, backpressure and clean
Stop behaviour. Retain natural visual-analysis latency; do not apply an
arbitrary audio delay to make a test look aligned. Test deliberate frame
stalls, audio loss, size changes and stopping with data in flight.

Use known audio transients and a frame marker stamped from the same clock
to measure transport-induced offset and drift at the start and end. Initial
target: error within one recording frame plus measured codec priming, with
no accumulating drift. Separately inspect audio-reactive composition clips.

### 3. Local recorder integration

Add the local FFmpeg worker and a minimal Record/Stop/status surface using
the existing UI conventions. Recording settings are independent of DDP.
Bound the in-flight media by bytes and duration, define an explicit overload
policy and report missed frames/errors. A slow recorder must not make the
composer wait indefinitely. Use a safe configured output directory, unique
filenames and successful finalization before presenting the saved path.

Choose fragmented/segmented intermediate storage or another recoverable
strategy before relying on MP4 finalization for long sessions. The final
sharing file should play in ordinary media players without special setup.

### 4. Verification and acceptance by Anjin

- Unit tests for clock mapping, gaps, limits, state transitions and failures.
- End-to-end browser plus service test with a known audio signal, decoded
  video and audio markers, including stopped DDP and disconnected receiver.
- Measure a representative 30-minute run: start/end sync, file size, memory,
  queue depth, frame delivery and encode throughput. Compare composer/DDP
  performance with recording off and on; hardware throughput alone is not
  proof of acceptable live performance. Measure CPU where feasible.
- Inspect decoded frames and listen to the recording. Measure fidelity
  against the lossless source, but do not equate a metric with acceptance.
- Exercise disk/encoder errors, device loss, reload/disconnect and cleanup.
- Run `cd composer && npm test` before each commit; run any additional
  repository checks required by the files actually changed.
- Preserve reports and evidence as runs happen. Update this plan, the task
  record, status and usage docs with what is and is not verified.
- Anjin tries the saved file and recording workflow on the branch. Keep
  `main` unchanged until tests pass and Anjin accepts. Push separately
  only on request.

## Deferred

Higher-resolution rendering, arbitrary export sizes, receiver/remote recording,
streaming credentials, YouTube integration, broadcast reconnection, a second
audio source, pause/resume and post-recording HandBrake automation.