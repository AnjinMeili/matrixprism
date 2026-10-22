export const RECORDING_QUEUE_BYTES = 16 * 1024 * 1024;
export const RECORDING_CHUNK_BYTES = 8 * 1024 * 1024;

export class PreviewRecorder {
  constructor(onState = () => {}) {
    this.onState = onState;
    this.state = 'idle';
    this.session = null;
  }

  get busy() {
    return ['starting', 'recording', 'stopping', 'finalizing'].includes(this.state);
  }

  update(state, extra = {}) {
    this.state = state;
    this.onState({ ...this.session, state, ...extra });
  }

  async request(endpoint, options = {}) {
    const response = await fetch(endpoint, { ...options, signal: AbortSignal.timeout(15000) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `Recording HTTP ${response.status}`);
    return result;
  }

  async start(canvas, audioStream, encoder = 'software') {
    if (this.busy) return;
    const generation = this.generation = (this.generation ?? 0) + 1;
    this.recorder = null;
    this.audioTrack = null;
    this.videoTrack = null;
    this.session = null;
    this.update('starting');
    try {
      if (!globalThis.MediaRecorder || !canvas.captureStream) throw new Error('Recording requires a supported browser');
      const track = audioStream?.getAudioTracks()[0];
      if (!track || track.readyState !== 'live' || track.muted)
        throw new Error('Select a live audio input before recording');
      const mimeType = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus']
        .find((type) => MediaRecorder.isTypeSupported(type));
      if (!mimeType) throw new Error('No supported audio/video recording format');
      this.canvas = canvas;
      this.audioStream = audioStream;
      this.audioTrack = track;
      this.width = canvas.width;
      this.height = canvas.height;
      this.queue = [];
      this.pendingBytes = 0;
      this.sequence = 0;
      this.pump = null;
      this.frames = 0;
      this.session = await this.request('/api/recordings', { method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ width: this.width, height: this.height, mimeType, encoder }) });
      this.picture = canvas.captureStream(0);
      this.videoTrack = this.picture.getVideoTracks()[0];
      this.recorder = new MediaRecorder(new MediaStream([this.videoTrack, ...audioStream.getAudioTracks()]), {
        mimeType, videoBitsPerSecond: Math.max(4000000, Math.min(16000000, this.width * this.height * 48)),
        audioBitsPerSecond: 192000,
      });
      this.recorder.ondataavailable = ({ data }) => {
        if (generation !== this.generation || !data.size || !this.busy || this.state === 'finalizing') return;
        if (data.size > RECORDING_CHUNK_BYTES || this.pendingBytes + data.size > RECORDING_QUEUE_BYTES ||
            this.queue.length >= 10 || (this.queue[0] && performance.now() - this.queue[0].time > 10000)) {
          this.fail(new Error('Recording upload cannot keep up; captured media retained on server'));
          return;
        }
        this.pendingBytes += data.size;
        this.queue.push({ data, time: performance.now() });
        this.upload();
      };
      this.recorder.onerror = (event) => this.fail(new Error(event.error?.message || 'Browser recording failed'), generation);
      this.lostAudio = () => this.fail(new Error('Recording audio input was muted or ended'), generation);
      track.addEventListener('ended', this.lostAudio);
      track.addEventListener('mute', this.lostAudio);
      this.primeTimer = setTimeout(() => {
        if (this.state === 'starting') this.fail(new Error('No composed frames arrived for recording'), generation);
      }, 5000);
      this.update('starting');
    } catch (error) {
      await this.fail(error, generation);
    }
  }

  frame(audioStream) {
    if (!['starting', 'recording'].includes(this.state) || !this.recorder) return;
    try {
      if (audioStream !== this.audioStream || this.audioTrack.readyState !== 'live' || this.audioTrack.muted)
        throw new Error('Recording audio input changed or stopped');
      if (this.canvas.width !== this.width || this.canvas.height !== this.height)
        throw new Error('Recording dimensions changed');
      if (this.state === 'starting') {
        clearTimeout(this.primeTimer);
        this.recorder.start(1000);
        this.started = performance.now();
        this.update('recording');
      }
      this.videoTrack.requestFrame();
      ++this.frames;
      if (performance.now() - this.started > 3600000) this.stop();
    } catch (error) {
      this.fail(error);
    }
  }

  upload() {
    if (this.pump || !this.queue.length || !this.busy) return;
    const generation = this.generation;
    this.pump = (async () => {
      while (generation === this.generation && this.queue.length && this.busy) {
        const chunk = this.queue[0];
        await this.request(`/api/recordings/${this.session.id}/chunk?sequence=${this.sequence}`, {
          method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: chunk.data,
        });
        if (generation !== this.generation) return;
        ++this.sequence;
        this.pendingBytes -= chunk.data.size;
        this.queue.shift();
      }
    })().catch((error) => this.fail(error, generation)).finally(() => {
      if (generation === this.generation) this.pump = null;
    });
  }

  cleanup() {
    clearTimeout(this.primeTimer);
    this.videoTrack?.stop();
    this.audioTrack?.removeEventListener('ended', this.lostAudio);
    this.audioTrack?.removeEventListener('mute', this.lostAudio);
  }

  async fail(error, generation = this.generation) {
    if (generation !== this.generation || this.state === 'error') return;
    const session = this.session;
    this.update('error', { error: error.message });
    if (this.recorder?.state !== 'inactive' && this.recorder) this.recorder.stop();
    this.cleanup();
    this.queue = [];
    if (session?.id)
      await this.request(`/api/recordings/${session.id}/cancel`, { method: 'POST' }).catch(() => {});
  }

  async stop() {
    if (this.state !== 'recording') return;
    const generation = this.generation;
    this.update('stopping');
    try {
      await new Promise((resolve) => {
        this.recorder.addEventListener('stop', resolve, { once: true });
        this.recorder.stop();
      });
      if (generation !== this.generation) return;
      this.cleanup();
      await this.pump;
      if (generation !== this.generation || this.state === 'error') return;
      if (this.queue.length) {
        this.upload();
        await this.pump;
      }
      if (generation !== this.generation || this.state === 'error') return;
      const finalized = await this.request(`/api/recordings/${this.session.id}/finish`, { method: 'POST' });
      if (generation !== this.generation || this.state === 'error') return;
      this.session = finalized;
      this.update('finalizing');
      while (generation === this.generation && this.state === 'finalizing') {
        await new Promise((resolve) => setTimeout(resolve, 500));
        if (generation !== this.generation || this.state !== 'finalizing') return;
        const result = await this.request(`/api/recordings/${this.session.id}`);
        if (generation !== this.generation) return;
        this.session = result;
        if (this.session.state === 'error') throw new Error(this.session.error);
        if (this.session.state === 'saved') this.update('saved');
      }
    } catch (error) {
      await this.fail(error, generation);
    }
  }

  abandon() {
    if (this.busy && this.session?.id)
      navigator.sendBeacon(`/api/recordings/${this.session.id}/cancel`, '');
  }
}