// Shared by check-stream-out.mjs and check-live.mjs: a known signal (a white
// flash and a 1 kHz beep together, once a second) as the WebM the composer's
// recorder uploads, and a measurement of where each flash and beep land in
// what came out.
import { execFileSync } from 'node:child_process';

export const FRAME_MS = 1000 / 30;

export function makeSource(file, seconds) {
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', `nullsrc=s=64x48:r=30,geq=lum='if(lt(mod(T,1),0.1),255,0)':cb=128:cr=128`,
    '-f', 'lavfi', '-i', `aevalsrc='if(lt(mod(t,1),0.1),0.8*sin(2*PI*1000*t),0)':s=48000:d=${seconds}`,
    '-t', String(seconds), '-c:v', 'libvpx', '-b:v', '1M', '-c:a', 'libopus', file]);
}

function onsets(values, times, level) {
  const found = [];
  values.forEach((value, i) => { if (value > level && (i === 0 || values[i - 1] <= level)) found.push(times[i]); });
  return found;
}

export function analyse(file) {
  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,width,height',
    '-of', 'json', file]).toString());
  const video = probe.streams.find((s) => s.codec_type === 'video');
  const stats = execFileSync('ffmpeg', ['-hide_banner', '-i', file, '-map', '0:v:0', '-vf',
    'signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-', '-f', 'null', '-'], { maxBuffer: 1 << 26 }).toString();
  const times = [...stats.matchAll(/pts_time:([\d.]+)/g)].map((m) => Number(m[1]));
  const luma = [...stats.matchAll(/YAVG=([\d.]+)/g)].map((m) => Number(m[1]));
  const pcm = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-map', '0:a:0', '-ac', '1', '-ar', '8000',
    '-f', 's16le', '-'], { maxBuffer: 1 << 28 });
  const samples = new Int16Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.length / 2));
  const loud = [], loudTimes = [];
  for (let i = 0; i + 80 <= samples.length; i += 80) {
    let peak = 0;
    for (let j = i; j < i + 80; j++) peak = Math.max(peak, Math.abs(samples[j]));
    loud.push(peak); loudTimes.push(i / 8000);
  }
  return { width: video?.width, height: video?.height,
    flashes: onsets(luma, times, 128), beeps: onsets(loud, loudTimes, 3000) };
}


// Reports on `file`: the size asked for, flashes and beeps found, and each
// flash against its beep. `report(ok, message)` records a pass or a failure.
export function verify(name, file, size, report) {
  const result = analyse(file);
  const [width, height] = size.split('x').map(Number);
  report(result.width === width && result.height === height, `${name}: picture is ${result.width}x${result.height}, asked ${size}`);
  const pairs = Math.min(result.flashes.length, result.beeps.length);
  report(pairs >= 5, `${name}: ${result.flashes.length} flashes and ${result.beeps.length} beeps found`);
  const offsets = Array.from({ length: pairs }, (_, i) => (result.beeps[i] - result.flashes[i]) * 1000);
  console.log(`      beep minus flash, ms: ${offsets.map((o) => o.toFixed(0)).join(' ')}`);
  report(offsets.every((o) => Math.abs(o) <= FRAME_MS * 1.5), `${name}: every flash meets its beep within one frame`);
  report(Math.max(...offsets) - Math.min(...offsets) <= FRAME_MS * 1.5, `${name}: no drift over the run`);
}
