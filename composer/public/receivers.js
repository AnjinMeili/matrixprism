// Settings kept for each receiver, by its host: brightness and gamma, since
// panels answer differently, and the most frames a second to send it, since
// some cannot take every frame. An Adafruit Matrix Portal S3, for one, loses
// Wi-Fi to interference from its own display refresh, and fewer frames ease
// it. The page draws at its own frame rate; this only skips sending.

export const RECEIVER_DEFAULTS = { brightness: 0.8, gamma: 1, maxFps: null };
export const MAX_FPS_RANGE = [1, 60];

// The key a host is kept under. The same panel reached by name and by
// address has two keys.
export const receiverKey = (host) => (typeof host === 'string' ? host.trim().toLowerCase() : '');

// One receiver's settings, from what is given and the defaults. Throws on a
// value out of the controls' ranges.
export function receiverProfile(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Receiver settings must be an options object.');
  const result = { ...RECEIVER_DEFAULTS, ...value };
  if (!Number.isFinite(result.brightness) || result.brightness < 0 || result.brightness > 1)
    throw new Error('Receiver brightness must be between 0 and 1.');
  if (!Number.isFinite(result.gamma) || result.gamma < 1 || result.gamma > 2.8)
    throw new Error('Receiver gamma must be between 1 and 2.8.');
  const maxFps = result.maxFps ?? null;
  if (maxFps !== null && !(Number.isInteger(maxFps) && maxFps >= MAX_FPS_RANGE[0] && maxFps <= MAX_FPS_RANGE[1]))
    throw new Error(`Frames a second sent must be no limit or a whole number from ${MAX_FPS_RANGE[0]} to ${MAX_FPS_RANGE[1]}.`);
  return { brightness: result.brightness, gamma: result.gamma, maxFps };
}

// All receivers' settings, by key. A receiver whose settings are invalid is
// dropped and named in `dropped`, so the others are kept.
export function receiverSettings(value = {}) {
  const receivers = {}, dropped = [];
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [host, profile] of Object.entries(value)) {
      const key = receiverKey(host);
      try {
        if (key) receivers[key] = receiverProfile(profile);
      } catch {
        dropped.push(host);
      }
    }
  }
  return { receivers, dropped };
}

// Lets frames through at no more than `maxFps` a second on average, however
// fast they come. Each send is due one interval after the last was due, not
// after the frame that took it, so a rate that does not divide the frame rate
// still comes out right (20 of 30 a second is two frames in three). A frame
// within half a frame of the time due counts, so jitter in drawing does not
// push sends to the frame after. After a pause the schedule starts afresh
// rather than sending a burst. With no limit, every frame goes.
export class SendLimiter {
  constructor() {
    this.reset();
  }

  reset() {
    this.last = null;
    this.due = null;
  }

  // Whether the frame at `now` (milliseconds) should be sent.
  allow(now, maxFps) {
    const frame = this.last === null ? 0 : now - this.last;
    this.last = now;
    if (!maxFps) return true;
    const interval = 1000 / maxFps;
    if (this.due !== null && now < this.due - Math.min(frame, interval) / 2) return false;
    // Due a whole interval or more ago: start afresh from now.
    this.due = this.due === null || now - this.due >= interval ? now + interval : this.due + interval;
    return true;
  }
}
