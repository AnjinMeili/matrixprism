// NDI output, in an NDI build only (#62): the frame sent to the panel, lifted
// for video by the page as Record and Go live are (public/video-gamma.js),
// enlarged here by a whole multiple and sent as an NDI source. Nothing of NDI
// ships with MatrixPrism: the runtime is the one installed from ndi.video,
// loaded when the app starts, as NDI's documentation prefers. The calls go
// through koffi, an FFI module that only an NDI build installs (app/ndi/), so
// the composer itself keeps no dependency and the released app has no NDI.
//
// The declarations in bindNdi follow the NDI SDK 6 headers
// (Processing.NDI.Lib.h, Processing.NDI.Send.h, Processing.NDI.structs.h;
// MIT licence, Vizrt NDI AB). NDI® is a registered trademark of Vizrt NDI AB.
//
// Unlike DDP, an NDI source listens: it advertises itself by mDNS (5353) and
// receivers connect to it over TCP or reliable UDP from port 5960.
import path from 'node:path';

// NDI's terms ask for this link wherever NDI is chosen, and in the docs.
export const NDI_LINK = 'https://ndi.video/';
// NDI's own download of the runtime, per platform (Processing.NDI.Lib.h).
export const NDI_RUNTIME_LINKS = {
  darwin: 'http://ndi.link/NDIRedistV6Apple',
  win32: 'http://ndi.link/NDIRedistV6',
  linux: NDI_LINK,
};
export const NDI_SOURCE_NAME = 'MatrixPrism';
// The largest picture sent: 4K UHD.
export const NDI_MAX_WIDTH = 3840;
export const NDI_MAX_HEIGHT = 2160;

const LIBRARY = { darwin: 'libndi.dylib', win32: 'Processing.NDI.Lib.x64.dll', linux: 'libndi.so.6' };
const RUNTIME_DIR = 'NDI_RUNTIME_DIR_V6';
const FOURCC_RGBX = 0x58424752; // NDI_LIB_FOURCC('R', 'G', 'B', 'X')
const PROGRESSIVE = 1;
const TIMECODE_SYNTHESIZE = 0x7fffffffffffffffn;

// Where the runtime may be, most specific first: the folder its installer
// names, the usual place, then the system's own search by name.
export function runtimeCandidates(platform = process.platform, env = process.env) {
  const name = LIBRARY[platform];
  if (!name) return [];
  const join = platform === 'win32' ? path.win32.join : path.posix.join;
  const list = [];
  if (env[RUNTIME_DIR]) list.push(join(env[RUNTIME_DIR], name));
  if (platform === 'darwin') list.push(`/usr/local/lib/${name}`);
  if (platform === 'linux') list.push(`/usr/lib/${name}`, `/usr/local/lib/${name}`);
  list.push(name);
  return [...new Set(list)];
}

// Fills `out`, RGBX rows of width * scale, from the RGBA rows of `rgba`, each
// pixel a scale × scale block: no smoothing, so the panel's pixels stay sharp.
// The page sends alpha as 255, which is what RGBX asks for.
export function enlargeFrame(rgba, width, height, scale, out) {
  const source = new Uint32Array(rgba.buffer, rgba.byteOffset, width * height);
  const target = new Uint32Array(out.buffer, out.byteOffset, width * height * scale * scale);
  const row = width * scale;
  for (let y = 0; y < height; ++y) {
    const start = y * scale * row;
    for (let x = 0; x < width; ++x)
      target.fill(source[y * width + x], start + x * scale, start + (x + 1) * scale);
    for (let copy = 1; copy < scale; ++copy)
      target.copyWithin(start + copy * row, start, start + row);
  }
  return out;
}

// The NDI calls, from the runtime at `libraryPath`, through `koffi`. Throws
// when the library cannot be loaded or the CPU is not one NDI supports.
// The structs are made once for each koffi: it keeps their names, and a
// second runtime may be tried after the first fails.
const declared = new WeakMap();
function declareTypes(koffi) {
  if (!declared.has(koffi)) {
    koffi.struct('NDIlib_send_create_t', {
      p_ndi_name: 'const char *', p_groups: 'const char *', clock_video: 'bool', clock_audio: 'bool',
    });
    koffi.struct('NDIlib_video_frame_v2_t', {
      xres: 'int', yres: 'int', FourCC: 'uint32_t', frame_rate_N: 'int', frame_rate_D: 'int',
      picture_aspect_ratio: 'float', frame_format_type: 'int32_t', timecode: 'int64_t',
      p_data: 'uint8_t *', line_stride_in_bytes: 'int', p_metadata: 'const char *', timestamp: 'int64_t',
    });
    declared.set(koffi, { Source: koffi.struct('NDIlib_source_t', { p_ndi_name: 'const char *', p_url_address: 'const char *' }) });
  }
  return declared.get(koffi);
}

export function bindNdi(koffi, libraryPath) {
  const { Source } = declareTypes(koffi);
  const lib = koffi.load(libraryPath);
  const initialize = lib.func('bool NDIlib_initialize()');
  const version = lib.func('const char *NDIlib_version()');
  const create = lib.func('void *NDIlib_send_create(const NDIlib_send_create_t *settings)');
  const destroy = lib.func('void NDIlib_send_destroy(void *sender)');
  const sendVideo = lib.func('void NDIlib_send_send_video_v2(void *sender, const NDIlib_video_frame_v2_t *frame)');
  const connections = lib.func('int NDIlib_send_get_no_connections(void *sender, uint32_t timeout_ms)');
  const sourceName = lib.func('const NDIlib_source_t *NDIlib_send_get_source_name(void *sender)');
  if (!initialize()) throw new Error('this computer\'s CPU is not one NDI supports');
  return {
    version: version(),
    create(name) {
      // NDI paces nothing: the composer's frame clock does, and a clocked send
      // would wait inside the call.
      const sender = create({ p_ndi_name: name, p_groups: null, clock_video: false, clock_audio: false });
      if (!sender) throw new Error('NDI could not create the source');
      return sender;
    },
    destroy,
    // Sends one frame on a worker thread; `done(error)` is called on the main
    // thread once NDI has encoded it. The synchronous send is used, since
    // koffi's copy of the frame lasts only as long as the call.
    send(sender, { width, height, data, fps }, done) {
      sendVideo.async(sender, {
        xres: width, yres: height, FourCC: FOURCC_RGBX, frame_rate_N: fps, frame_rate_D: 1,
        picture_aspect_ratio: 0, frame_format_type: PROGRESSIVE, timecode: TIMECODE_SYNTHESIZE,
        p_data: data, line_stride_in_bytes: width * 4, p_metadata: null, timestamp: 0n,
      }, (error) => done(error));
    },
    connections: (sender) => connections(sender, 0),
    address(sender) {
      const pointer = sourceName(sender);
      return pointer ? koffi.decode(pointer, Source).p_url_address ?? '' : '';
    },
  };
}

// What the page is told about NDI: whether this build has it and whether the
// runtime loaded, with the reason and links when it did not.
export function ndiUnavailable(reason, platform = process.platform) {
  return { built: true, available: false, reason, link: NDI_LINK, runtimeLink: NDI_RUNTIME_LINKS[platform] ?? NDI_LINK };
}

// Loads the runtime through `koffi`: { status, bindings }. `koffi` is null
// in a build without NDI.
export function loadNdi(koffi, { platform = process.platform, env = process.env, bind = bindNdi } = {}) {
  if (!koffi) return { status: { built: false, available: false }, bindings: null };
  const problems = [];
  for (const candidate of runtimeCandidates(platform, env)) {
    try {
      const bindings = bind(koffi, candidate);
      return { status: { built: true, available: true, version: bindings.version, link: NDI_LINK }, bindings };
    } catch (error) {
      problems.push(`${candidate}: ${error.message}`);
    }
  }
  return {
    status: ndiUnavailable('The NDI runtime is not installed: install NDI Tools or the NDI runtime from ndi.video', platform),
    bindings: null, problems,
  };
}

// The NDI source of one page: started and stopped by the page, fed its
// lifted frames. One frame is sent at a time; a frame that arrives while the
// last is still being sent is skipped, so the main thread never waits for NDI.
export class NdiOutput {
  constructor(bindings, { name = NDI_SOURCE_NAME } = {}) {
    Object.assign(this, { bindings, name });
    this.sender = null;
    this.size = null;
    this.busy = false;
    this.closing = null;
    this.sent = 0;
    this.skipped = 0;
    this.failure = '';
    this.connections = 0;
    this.countDue = false;
    this.buffer = null;
  }

  get on() {
    return this.size !== null;
  }

  // The source's size: the panel's width and height and the whole multiple
  // to enlarge by. Throws for a size outside the limits.
  start({ width, height, scale, fps }) {
    if (![width, height, scale].every(Number.isInteger) || width < 1 || height < 1 || scale < 1 ||
        width * scale > NDI_MAX_WIDTH || height * scale > NDI_MAX_HEIGHT)
      throw new Error('invalid NDI size');
    if (!this.bindings) throw new Error('NDI is not available');
    this.sender ??= this.bindings.create(this.name);
    this.size = { width, height, scale, fps: Number.isInteger(fps) && fps > 0 && fps <= 240 ? fps : 60 };
    this.failure = '';
    return { width: width * scale, height: height * scale, address: this.address() };
  }

  // The number of bytes of a frame the page sends: RGBA at the panel's size.
  get frameBytes() {
    return this.size ? this.size.width * this.size.height * 4 : 0;
  }

  frame(rgba) {
    if (!this.size || this.closing || rgba.length !== this.frameBytes) return false;
    if (this.busy) {
      this.skipped += 1;
      return false;
    }
    const { width, height, scale, fps } = this.size;
    // One buffer is enough: it is not filled again until NDI is done with it.
    const bytes = width * height * scale * scale * 4;
    if (this.buffer?.length !== bytes) this.buffer = new Uint8Array(bytes);
    const data = scale === 1 ? rgba : enlargeFrame(rgba, width, height, scale, this.buffer);
    this.busy = true;
    this.bindings.send(this.sender, { width: width * scale, height: height * scale, data, fps }, (error) => {
      this.busy = false;
      if (error) this.failure = error.message;
      else this.sent += 1;
      if (this.countDue) this.countConnections();
      this.settle?.();
    });
    return true;
  }

  stop() {
    this.size = null;
  }

  address() {
    try {
      return this.sender ? this.bindings.address(this.sender) : '';
    } catch {
      return '';
    }
  }

  // What the page shows: on or off, receivers connected, frames sent and skipped.
  // The receivers connected, asked for on the main thread with no frame being
  // sent. While one is, it is asked for as soon as that send is done: when
  // NDI is busy with every frame (4K on a slow computer) it would otherwise
  // never be asked for at all.
  countConnections() {
    this.countDue = false;
    if (this.sender) this.connections = this.bindings.connections(this.sender);
  }

  takeStats() {
    if (this.busy) this.countDue = true;
    else this.countConnections();
    const stats = { on: this.on, connections: this.connections, sent: this.sent, skipped: this.skipped,
      ...(this.failure ? { error: this.failure } : {}) };
    this.sent = 0;
    this.skipped = 0;
    return stats;
  }

  // Stops, waits for a frame being sent and destroys the source, which
  // receivers then see go.
  close() {
    this.size = null;
    this.closing ??= new Promise((resolve) => {
      const finish = () => {
        if (this.sender) this.bindings.destroy(this.sender);
        this.sender = null;
        this.buffer = null;
        resolve();
      };
      if (this.busy) this.settle = finish;
      else finish();
    });
    return this.closing;
  }
}
