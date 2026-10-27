# Plan: recording and live streaming from the app, on Windows, Linux and macOS (T66)

**Status: a plan, researched on 2026-10-25. One platform (macOS) was measured;
Windows and Linux are not, and a method to measure them is given.** It extends
[packaging-plan.md](packaging-plan.md) (the app as Electron, track A).

## What exists today

The page captures its own final picture and the audio input, not the screen:
`canvas.captureStream` and `MediaRecorder` make WebM (VP9 or VP8 with Opus), and
the chunks are uploaded to the relay. The relay writes a recording by piping
them to FFmpeg, which encodes H.264 and AAC into an MP4 (software `libx264`, or
`h264_videotoolbox` on a Mac). Go live does the same, enlarges the picture and
sends it to YouTube over RTMP. FFmpeg is an external install.

That design is the reason this is easier than "video capture in Electron"
sounds. **No screen capture is needed**, so none of its platform differences
(macOS screen-recording consent, Wayland's picker and its one-source limit,
system-audio loopback by OS) apply. Everything below is about encoding and
sending what the page already has.

## What was found

**Measured, macOS, Electron 45.0.0 (Chromium 156)** (`app/probe-capture.mjs`;
the codecs read from the recorded bytes, not taken from the type asked for):

| What | Result |
| --- | --- |
| `MediaRecorder` to WebM: VP9, VP8, AV1 with Opus | works |
| `MediaRecorder` to **MP4 with H.264 and AAC** | **works**; the file holds `avc1` and `mp4a` |
| `MediaRecorder` to MP4 with H.264 and Opus; plain `video/mp4` | works (plain MP4 gives H.264 with Opus, not AAC) |
| H.264 asked for inside WebM | comes out as Matroska |
| HEVC in MP4 by `MediaRecorder` | refused (WebCodecs accepts HEVC) |
| WebCodecs `VideoEncoder`, H.264 (`avc1.640028`) | supported, hardware preferred accepted |
| WebCodecs VP8, VP9, AV1 | supported in software only (hardware preferred is refused) |
| WebCodecs `AudioEncoder`, AAC and Opus | supported |

Electron's own tracker says MP4 with AAC was missing in early 2024 and works
from Electron 36. `require-hardware` is not a valid setting in this Chromium
(only `no-preference`, `prefer-hardware`, `prefer-software`).

**From sources, not measured here** (trust in the research report):

- YouTube takes RTMP, RTMPS, HLS and DASH; YouTube, Twitch and Kick do not take
  WebRTC (WHIP). A page or Electron cannot push RTMP by itself.
- No maintained RTMP *publisher* for Node was found, only servers.
- FFmpeg builds for Windows and Linux (x64 and Arm) exist from BtbN in `gpl` and
  `lgpl` variants (the `lgpl` ones leave out x264 and x265), as large as about
  160 MB for one static Windows build. Hardware-encoder content of these builds,
  and macOS builds, were not checked.
- On Ubuntu 24.04 and later, AppArmor's restriction on unprivileged user
  namespaces makes an Electron AppImage fail at start-up unless it is run with
  `--no-sandbox`; a `.deb` is reported to work.

## What this means

1. **Recording needs no FFmpeg if the page's MP4 is good enough.** The page can
   record H.264 and AAC itself and the main process can write the chunks to
   disk. That removes the external install for recording on any OS where the
   same probe passes. Open: whether 4:2:0 H.264 at a panel's size keeps the
   pixels as the FFmpeg path did (the recording work measured this); the picture
   is enlarged by drawing it, unsmoothed, into a larger canvas before capture.
2. **Live needs something to speak RTMP.** The options:
   - *FFmpeg as a remuxer only.* The page records H.264 and AAC; FFmpeg copies
     the stream into the RTMP wrapper without encoding (`-c copy`). This needs
     a tiny FFmpeg with no encoders (a small LGPL build, simple to ship and to
     license) or the user's own. To test: that MediaRecorder's MP4 chunks can be
     streamed through a pipe this way, and that YouTube accepts the keyframe
     interval MediaRecorder gives.
   - *HLS push, no FFmpeg.* YouTube accepts HLS ingest; the details (segment
     length, upload method, keyframes) were not reached in this research.
     Needs WebCodecs for key-frame control and our own muxing.
   - *Our own RTMP publisher.* Possible, not recommended: a protocol to write
     and maintain, with no library to lean on.
3. **Hardware encoding** comes from the operating system through Chromium, not
   from bundling an encoder: shown on macOS only (H.264 hardware preferred is
   accepted). On Windows and Linux it is unknown.
4. **FFmpeg, where it is kept, can stay a user-installed program** (as in the
   packaging plan) with the page's own recording as the fallback; or a small
   LGPL build can be bundled and signed with the app.

## Audio in the stream, and the copyright limit

A music visualizer wants the music in the stream, and music that is not the
streamer's own to broadcast cannot go to YouTube. A stream that carries other
people's music can draw a Content ID claim (the video blocked in some
territories, which is not a copyright strike) and a Community guidelines
warning under YouTube's third-party content policy; if the warnings given
during the stream are not acted on, the stream is removed. The policy says live
streams should be actively monitored by the channel owner and problems
corrected in good time, and suggests asking the rights holder to allowlist the
channel in Content ID. The warnings are shown in YouTube's Live Control Room,
which the composer cannot see, so a long stream left unwatched will run into
this.

So stream music you have the rights to broadcast, or music whose licence
allows live rebroadcast. The maintainer's suggestion is
[L-L-M Radio](https://llmradio.net), songs written, sung and announced by
language models around the clock; it publishes no licence or terms of use
(read 27 October 2026), so check with its operators before relying on it.

What the sources say (vendor and guide posts, not the platforms' own policy
pages, except where noted):

- **YouTube** checks live audio against Content ID as it goes out. The reported
  sequence is a warning in the Live Control Room, then the picture replaced with
  a still and the audio muted, then the stream ended if it goes on. The archive
  is scanned again afterwards and sections can be muted or the whole video
  blocked. Strikes can bar live streaming for a time (the lengths differ between
  sources). A licence may not be enough: the rights holder may have to allowlist
  the channel. YouTube also needs an audio stream on a live broadcast, so a
  stream with no sound should carry a silent AAC track (44.1 kHz, mono or
  stereo, one stream).
- **Twitch** has an opt-in DJ Program for DJ sets, with licensed music and a
  shared cost for monetised DJs. Its terms turn off VODs, highlights and uploads
  for the DJs category; clips arrived on 1 September 2026, and those found to
  contain music are not published. Outside the programme, DJ sets risk takedowns.
- **Mixcloud Live** (with a Mixcloud Pro subscription) says it has direct licences
  with the major labels and Merlin and that its fingerprinting keeps shows and
  live streams clear of takedowns. Whether it takes a stream over RTMP or only
  from its own WebRTC studio could not be confirmed from current pages.
- A licensed platform is the only route that puts other people's music in the
  stream legally; the other routes are the streamer's own or cleared music, or
  no music.

What this means for the app (after the first release, not part of it):

1. **Go live must not default to sending the music.** The audio choice is
   explicit: *None* (a silent AAC track, so YouTube accepts the stream),
   *Input* (what the page hears now) with a plain warning that copyrighted music
   will probably be blocked on YouTube, and, later, a file of the streamer's own
   or cleared music.
2. **The destination decides what is allowed.** The default destination (YouTube)
   gets the visuals with no music unless the streamer says the music is theirs.
   Any RTMP address can be named, which is how a licensed service that takes RTMP
   would be reached.
3. **Local recording keeps its audio.** A recording for the maker's own feedback
   is unaffected; posting that recording publicly has the same limit.
4. **A live stream needs someone watching it.** A stream that sends other
   people's music is warned about in the Live Control Room and removed if the
   warnings are ignored. The page says so next to the audio choice, and a
   stream longer than a short time asks for a check.
5. **Most uses never stream.** The panel in the room needs no stream at all.
6. **A visualizer without the music** is still useful for a venue's screen, a
   loop or a clip over cleared music; the audience hears the room's sound.

## A method to measure the other two systems

Run `app/probe-capture.mjs` on each of Windows, Linux and macOS and keep the
JSON. On GitHub, a workflow with a matrix of `windows-latest`, `ubuntu-24.04`
(with a virtual display such as `xvfb`) and `macos-15` can run it on every tag,
with the result uploaded as an artifact. It would run in the public repository,
like the release workflow; running it in the private development repository
would spend its Actions minutes. Add, in the same job: record ten seconds to
MP4, check it with `ffprobe` (codecs, duration, frame count), and pipe the
chunks through `ffmpeg -c copy` to a local RTMP receiver (as `check-stream-out`
does).

## Steps, each with its check

1. **Probe all three systems** with the method above. *Check:* the table above,
   filled in for Windows and Linux, including whether H.264 and AAC MP4 record
   and whether hardware is chosen.
2. **Record to MP4 in the page and write it in the main process.** *Check:* a
   ten-second recording plays, `ffprobe` shows H.264, AAC and the right size;
   the same checks as `check-recording` pass on a panel's size; the picture is
   compared with the FFmpeg path.
3. **Live through an FFmpeg remuxer, with an audio choice.** None sends a
   silent AAC track; Input sends the music with a warning. *Check:*
   `check-stream-out` and `check-live` against the new path, with no re-encode
   (`-c copy`), flash and beep within a frame and no drift; a stream with None
   has an audio track that is silent and that a receiver accepts.
4. **Decide FFmpeg's place:** user-installed, or a small LGPL build bundled and
   signed.
5. **Linux:** ship a `.deb` and an AppImage, state the AppArmor workaround for
   the second, and test the sandbox on Ubuntu 24.04.
6. **HLS ingest, only if** the remuxer is unwanted: read YouTube's HLS rules,
   then spike.

## What the research did not establish

- Windows and Linux: every codec, encoder and hardware fact above is macOS only.
- Whether `MediaRecorder`'s MP4 stream is fragmented in a way FFmpeg accepts on
  a pipe, and its keyframe interval.
- YouTube's HLS ingest rules, and FFmpeg builds for macOS.
- Whether the H.264 MP4 keeps a small panel's pixels as well as FFmpeg's
  encode did.
- Whether the platforms' own current policy pages agree with the guide posts
  above, and whether YouTube's API lets an app read a stream's content warnings
  (not looked at).
- A webcam or capture card as an *input* to the composer (`getUserMedia` video):
  not researched.
