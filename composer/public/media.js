// Media playback pattern: a still image, animated image (GIF, APNG, WebP)
// or video, scaled to the panel. The loaded media is page-wide; the pattern
// instance only rasterizes its current frame at the panel resolution.
import { GifAnimation } from './gif.js';

export const MEDIA_FITS = [
  ['cover', 'Fill panel (crop edges)'],
  ['contain', 'Fit inside (black bars)'],
  ['stretch', 'Stretch to panel'],
];
const DEFAULT_FRAME_SECONDS = 0.1;
const MIN_FRAME_SECONDS = 0.02;

// Source and destination rectangles for drawing a sw x sh picture onto a
// dw x dh panel. All modes centre the picture.
export function fitRect(sw, sh, dw, dh, mode = 'cover') {
  if (![sw, sh, dw, dh].every(value => Number.isFinite(value) && value > 0))
    throw new Error('Media and panel dimensions must be positive.');
  if (!MEDIA_FITS.some(([id]) => id === mode))
    throw new Error(`Unknown media fit: ${mode}`);
  if (mode === 'cover') {
    const scale = Math.max(dw / sw, dh / sh);
    const width = dw / scale, height = dh / scale;
    return { sx: (sw - width) / 2, sy: (sh - height) / 2, sw: width, sh: height, dx: 0, dy: 0, dw, dh };
  }
  if (mode === 'contain') {
    const scale = Math.min(dw / sw, dh / sh);
    const width = sw * scale, height = sh * scale;
    return { sx: 0, sy: 0, sw, sh, dx: (dw - width) / 2, dy: (dh - height) / 2, dw: width, dh: height };
  }
  return { sx: 0, sy: 0, sw, sh, dx: 0, dy: 0, dw, dh };
}

export function mediaKind(type) {
  if (typeof type === 'string' && type.startsWith('video/')) return 'video';
  if (typeof type === 'string' && type.startsWith('image/')) return 'image';
  return null;
}

// The image and video files among a folder's { path, file } entries, in path
// order.
export function mediaEntries(entries) {
  return entries
    .filter(entry => mediaKind(entry.file.type))
    .sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));
}

// Every file under a directory handle, with its path below that directory.
export async function directoryFiles(directory, prefix = '') {
  const files = [];
  for await (const handle of directory.values()) {
    const path = prefix + handle.name;
    if (handle.kind === 'directory')
      files.push(...await directoryFiles(handle, `${path}/`));
    else
      files.push({ path, file: await handle.getFile() });
  }
  return files;
}

// Holds the one loaded piece of media and exposes its current frame.
// The composer's own GIF decoder in the shape of ImageDecoder: decode()
// resolves with a canvas holding the composed frame, and how long the frame
// is shown in microseconds.
export class GifFrames {
  constructor(gif, canvasFactory = createCanvas) {
    this.gif = gif;
    this.canvas = canvasFactory(gif.width, gif.height);
    this.context = this.canvas.getContext('2d');
    this.pixels = this.context.createImageData(gif.width, gif.height);
  }

  async decode({ frameIndex }) {
    const { rgba, duration } = this.gif.frame(frameIndex);
    this.pixels.data.set(rgba);
    this.context.putImageData(this.pixels, 0, 0);
    return { image: this.canvas, duration };
  }
}

export class MediaSource {
  constructor(canvasFactory = createCanvas) {
    this.canvasFactory = canvasFactory;
    this.reset();
  }

  reset() {
    this.kind = 'none';
    this.name = '';
    this.width = 0;
    this.height = 0;
    this.image = null;
    this.video = null;
    this.url = null;
    this.decoder = null;
    this.frameCount = 0;
    this.frameIndex = 0;
    this.frameSeconds = DEFAULT_FRAME_SECONDS;
    this.shownAt = null;
    this.decoding = false;
    this.version = 0;
    this.generation = (this.generation ?? 0) + 1;
  }

  get ready() {
    return this.kind !== 'none';
  }

  describe() {
    if (!this.ready) return 'No media loaded';
    const kind = this.kind === 'animation' ? `animation, ${this.frameCount} frames` : this.kind;
    return `${this.name} · ${this.width}×${this.height} · ${kind}`;
  }

  clear() {
    if (this.video) {
      this.video.pause();
      this.video.removeAttribute('src');
      this.video.load();
    }
    if (this.url) URL.revokeObjectURL(this.url);
    this.image?.close?.();
    this.decoder?.close?.();
    this.reset();
  }

  // Takes over what another source has loaded, leaving that one empty. A
  // replacement can then be decoded in full before the current picture goes.
  adopt(other) {
    this.clear();
    Object.assign(this, other, { generation: this.generation });
    other.reset();
  }

  // Replaces the current media with a File or Blob. Throws if the browser
  // cannot decode it, leaving nothing loaded.
  async load(file) {
    const kind = mediaKind(file?.type);
    if (!kind) throw new Error('Choose an image, animated GIF or video file.');
    this.clear();
    const generation = this.generation;
    try {
      if (kind === 'video') await this.loadVideo(file);
      else await this.loadImage(file);
    } catch (error) {
      if (generation === this.generation) this.clear();
      throw error;
    }
    this.name = file.name || kind;
  }

  async loadVideo(file) {
    const video = document.createElement('video');
    // Muted, inline playback is allowed to start without a click.
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    this.url = URL.createObjectURL(file);
    this.video = video;
    await new Promise((resolve, reject) => {
      video.addEventListener('loadeddata', resolve, { once: true });
      video.addEventListener('error', () =>
        reject(new Error('This browser cannot play that video format.')), { once: true });
      video.src = this.url;
    });
    this.kind = 'video';
    this.width = video.videoWidth;
    this.height = video.videoHeight;
    video.play().catch(() => {});
  }

  async loadImage(file) {
    // GIFs are decoded here, so they animate in every browser.
    if (file.type === 'image/gif' && await this.loadGif(file)) return;
    if (typeof ImageDecoder !== 'undefined' && await ImageDecoder.isTypeSupported(file.type)) {
      const decoder = new ImageDecoder({ data: await file.arrayBuffer(), type: file.type });
      await decoder.tracks.ready;
      await decoder.completed;
      await this.startAnimation(decoder, decoder.tracks.selectedTrack.frameCount);
      return;
    }
    // Without ImageDecoder only the first frame of an animated WebP or PNG
    // is available.
    const bitmap = await createImageBitmap(file);
    this.image = bitmap;
    this.width = bitmap.width;
    this.height = bitmap.height;
    this.kind = 'image';
    this.version++;
  }

  // Returns false if the file cannot be read as a GIF, which leaves it to
  // the browser's own decoders.
  async loadGif(file) {
    let frames;
    try {
      const gif = new GifAnimation(await file.arrayBuffer());
      gif.frame(0);
      frames = new GifFrames(gif, this.canvasFactory);
    } catch {
      return false;
    }
    await this.startAnimation(frames, frames.gif.frameCount);
    return true;
  }

  async startAnimation(decoder, frameCount) {
    this.decoder = decoder;
    this.frameCount = frameCount;
    await this.showFrame(0);
    this.kind = frameCount > 1 ? 'animation' : 'image';
  }

  async showFrame(index) {
    const generation = this.generation;
    const { image, duration = image.duration } = await this.decoder.decode({ frameIndex: index });
    if (generation !== this.generation) {
      image.close?.();
      return;
    }
    this.image?.close?.();
    this.image = image;
    this.width = image.displayWidth ?? image.width;
    this.height = image.displayHeight ?? image.height;
    // Frame durations are in microseconds; some files leave them at zero.
    this.frameSeconds = Math.max(MIN_FRAME_SECONDS,
      duration ? duration / 1e6 : DEFAULT_FRAME_SECONDS);
    this.frameIndex = index;
    this.shownAt = null;
    this.version++;
  }

  // Advances an animation on the caller's clock. Decoding is asynchronous, so
  // the next frame appears on a later call.
  update(seconds) {
    if (this.kind !== 'animation' || this.decoding) return;
    if (this.shownAt === null) {
      this.shownAt = seconds;
      return;
    }
    if (seconds - this.shownAt + 1e-6 < this.frameSeconds) return;
    this.decoding = true;
    const generation = this.generation;
    this.showFrame((this.frameIndex + 1) % this.frameCount)
      .catch(() => {})
      .finally(() => { if (generation === this.generation) this.decoding = false; });
  }

  // The picture to draw now, or null when nothing can be shown yet.
  current() {
    if (this.kind === 'video') {
      const video = this.video;
      if (video.readyState < 2) return null;
      if (video.paused) video.play().catch(() => {});
      return { image: video, width: video.videoWidth, height: video.videoHeight, version: video.currentTime };
    }
    if (!this.ready || !this.image) return null;
    return { image: this.image, width: this.width, height: this.height, version: this.version };
  }
}

export const media = new MediaSource();

function createCanvas(width, height) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

export class MediaPattern {
  constructor(width, height, source = media, canvasFactory = createCanvas) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1)
      throw new Error('Media pattern dimensions must be positive integers');
    this.width = width;
    this.height = height;
    this.source = source;
    this.canvasFactory = canvasFactory;
    this.rgb = new Uint8Array(width * height * 3);
    this.context = null;
    this.drawn = null;
  }

  renderFrame(state) {
    const fit = state.mediaFit ?? 'cover';
    this.source.update(state.audioTime ?? 0);
    const frame = this.source.current();
    if (!frame) {
      if (this.drawn !== null) this.rgb.fill(0);
      this.drawn = null;
      return this.rgb;
    }
    // Still pictures and repeated video frames need no new rasterization.
    const key = `${this.source.generation}/${frame.version}/${frame.width}x${frame.height}/${fit}`;
    if (key === this.drawn) return this.rgb;
    this.context ??= this.canvasFactory(this.width, this.height)
      .getContext('2d', { willReadFrequently: true });
    const c = this.context;
    const r = fitRect(frame.width, frame.height, this.width, this.height, fit);
    c.imageSmoothingEnabled = true;
    c.imageSmoothingQuality = 'high';
    c.fillStyle = '#000';
    c.fillRect(0, 0, this.width, this.height);
    c.drawImage(frame.image, r.sx, r.sy, r.sw, r.sh, r.dx, r.dy, r.dw, r.dh);
    const rgba = c.getImageData(0, 0, this.width, this.height).data;
    for (let i = 0, out = 0; i < rgba.length; i += 4) {
      this.rgb[out++] = rgba[i];
      this.rgb[out++] = rgba[i + 1];
      this.rgb[out++] = rgba[i + 2];
    }
    this.drawn = key;
    return this.rgb;
  }
}

export const MEDIA_PATTERN = {
  id: 'media-player', name: 'Media Player',
  audio: 'Plays a loaded image, animated GIF or video, resized to the panel (no audio modulation)',
  controls: ['media'],
  // Lets auto cycle pass over the pattern while nothing is loaded.
  isReady: () => media.ready,
  createInstance: (width, height) => new MediaPattern(width, height),
};

// ---------- remembering the file across reloads ----------

const DATABASE = 'matrix-companion-media', STORE = 'files', KEY = 'current', FOLDER_KEY = 'folder';

function withStore(mode, action) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DATABASE, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(STORE);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const database = open.result;
      const transaction = database.transaction(STORE, mode);
      const request = action(transaction.objectStore(STORE));
      transaction.oncomplete = () => { database.close(); resolve(request?.result); };
      transaction.onerror = transaction.onabort = () => { database.close(); reject(transaction.error); };
    };
  });
}

export const rememberMediaFile = (file) =>
  withStore('readwrite', store => store.put({ blob: file, name: file.name, type: file.type }, KEY));
export const forgetMediaFile = () => withStore('readwrite', store => store.delete(KEY));
export async function recallMediaFile() {
  const saved = await withStore('readonly', store => store.get(KEY));
  if (!saved?.blob) return null;
  // Blobs come back without a name; keep the one the user picked.
  return Object.assign(saved.blob.slice(0, saved.blob.size, saved.type), { name: saved.name });
}

// A folder is remembered as its directory handle, not its contents. The
// browser may ask for permission again before the handle can be read.
export const rememberMediaFolder = (handle) => withStore('readwrite', store => store.put(handle, FOLDER_KEY));
export const forgetMediaFolder = () => withStore('readwrite', store => store.delete(FOLDER_KEY));
export const recallMediaFolder = () => withStore('readonly', store => store.get(FOLDER_KEY));
