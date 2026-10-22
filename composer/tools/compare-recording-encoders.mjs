import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';

export function optionsFrom(args) {
  const options = { width: 256, height: 192, fps: 30, seconds: 10, bitrate: 1000000 };
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!value) throw new Error(`Missing value for ${name}`);
    if (name === '--out') options.out = path.resolve(value);
    else if (name === '--size') {
      if (!/^\d+x\d+$/.test(value)) throw new Error('Size must be WIDTHxHEIGHT');
      [options.width, options.height] = value.split('x').map(Number);
    } else if (['--fps', '--seconds', '--bitrate'].includes(name)) {
      options[name.slice(2)] = Number(value);
    } else throw new Error(`Unknown option ${name}`);
  }
  if (!options.out) throw new Error('--out must name a new evidence directory');
  for (const [name, minimum, maximum] of [
    ['width', 1, 4096], ['height', 1, 4096], ['fps', 1, 120],
    ['seconds', 1, 120], ['bitrate', 10000, 100000000],
  ]) {
    const value = options[name];
    if (!Number.isInteger(value) || value < minimum || value > maximum)
      throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`);
  }
  return options;
}

export function encodeArgs(encoder, options, source, target) {
  if (!['libx264', 'h264_videotoolbox'].includes(encoder))
    throw new Error(`Unsupported encoder ${encoder}`);
  return [
    '-hide_banner', '-nostdin', '-n', '-i', source,
    '-map', '0:v:0', '-map', '0:a:0',
    '-vf', 'pad=ceil(iw/2)*2:ceil(ih/2)*2:0:0:black,format=yuv420p',
    '-c:v', encoder, '-b:v', String(options.bitrate), '-g', String(options.fps * 2),
    ...(encoder === 'libx264' ? ['-preset', 'veryfast']
      : ['-allow_sw', '0', '-require_sw', '0', '-realtime', '1']),
    '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', target,
  ];
}

export function runComparison(options) {
  fs.mkdirSync(options.out);
  const media = fs.mkdtempSync(path.join(os.tmpdir(), 'matrixprism-encoders-'));
  const commands = [];
  const results = {
    created: new Date().toISOString(),
    platform: { system: os.platform(), release: os.release(), arch: os.arch(), cpu: os.cpus()[0]?.model },
    options, media,
    limitations: [
      'Synthetic testsrc and mono sine, not composed patterns or captured input.',
      'Offline end-to-end transcode wall time, not isolated encoder time or live performance.',
      'Requested bitrates are equal; actual rate control and output sizes may differ.',
      'SSIM includes conversion to 4:2:0 but is not a visual acceptance test.',
      'No audio/video marker synchronization, CPU or composer/DDP performance measurement.',
      'HandBrakeCLI is inventoried only; its encoding comparison is deferred.',
    ],
    encoders: [],
  };
  function execute(label, executable, args, required = true) {
    const start = performance.now();
    const processResult = spawnSync(executable, args, {
      encoding: 'utf8', timeout: 120000, maxBuffer: 16 * 1024 * 1024,
    });
    const seconds = (performance.now() - start) / 1000;
    const command = {
      label, executable, args, seconds, status: processResult.status,
      signal: processResult.signal, error: processResult.error?.message,
    };
    commands.push(command);
    fs.writeFileSync(path.join(options.out, `${label}.log`),
      `${processResult.stdout ?? ''}${processResult.stderr ?? ''}${processResult.error?.message ?? ''}`);
    fs.writeFileSync(path.join(options.out, 'commands.json'), JSON.stringify(commands, null, 2) + '\n');
    if (required && (processResult.error || processResult.status !== 0))
      throw new Error(`${label} failed; see ${options.out}`);
    return { ...command, stdout: processResult.stdout ?? '', stderr: processResult.stderr ?? '' };
  }
  try {
    execute('ffmpeg-version', 'ffmpeg', ['-version']);
    execute('ffprobe-version', 'ffprobe', ['-version']);
    const handbrake = execute('handbrake-version', 'HandBrakeCLI', ['--version'], false);
    results.handbrakeAvailable = handbrake.status === 0 && !handbrake.error;
    execute('videotoolbox-options', 'ffmpeg', ['-hide_banner', '-h', 'encoder=h264_videotoolbox']);
    const source = path.join(media, 'source.mkv');
    execute('source', 'ffmpeg', [
      '-hide_banner', '-nostdin', '-n',
      '-f', 'lavfi', '-i', `testsrc=size=${options.width}x${options.height}:rate=${options.fps}`,
      '-f', 'lavfi', '-i', 'sine=frequency=1000:sample_rate=48000',
      '-t', String(options.seconds), '-c:v', 'ffv1', '-level', '3', '-pix_fmt', 'bgr0',
      '-c:a', 'pcm_s16le', source,
    ]);
    results.source = { path: source, sha256: createHash('sha256').update(fs.readFileSync(source)).digest('hex') };
    for (const encoder of ['libx264', 'h264_videotoolbox']) {
      const target = path.join(media, `${encoder}.mp4`);
      const encoding = execute(encoder, 'ffmpeg', encodeArgs(encoder, options, source, target), false);
      const result = { encoder, ok: encoding.status === 0 && !encoding.error, seconds: encoding.seconds };
      results.encoders.push(result);
      if (!result.ok) continue;
      const probe = execute(`${encoder}-probe`, 'ffprobe', [
        '-v', 'error', '-count_frames', '-show_streams', '-show_format', '-of', 'json', target,
      ]);
      result.probe = JSON.parse(probe.stdout);
      const video = result.probe.streams.find((stream) => stream.codec_type === 'video');
      const audio = result.probe.streams.find((stream) => stream.codec_type === 'audio');
      const frames = Number(video?.nb_read_frames);
      if (video?.codec_name !== 'h264' || audio?.codec_name !== 'aac' ||
          video.width !== options.width + options.width % 2 ||
          video.height !== options.height + options.height % 2 ||
          frames !== options.seconds * options.fps ||
          audio.sample_rate !== '48000' || audio.channels !== 1)
        throw new Error(`${encoder}: unexpected dimensions, frame count or audio/video format`);
      result.bytes = fs.statSync(target).size;
      result.mediaSeconds = Number(result.probe.format.duration);
      result.fps = frames / encoding.seconds;
      result.realtimeMultiple = options.seconds / encoding.seconds;
      result.totalBitsPerSecond = result.bytes * 8 / result.mediaSeconds;
      const quality = execute(`${encoder}-ssim`, 'ffmpeg', [
        '-hide_banner', '-nostdin', '-i', source, '-i', target,
        '-filter_complex',
        `[0:v]pad=ceil(iw/2)*2:ceil(ih/2)*2:0:0:black,format=yuv444p,setpts=PTS-STARTPTS[reference];` +
        '[1:v]format=yuv444p,setpts=PTS-STARTPTS[encoded];[reference][encoded]ssim=shortest=1[quality]',
        '-map', '[quality]', '-an', '-f', 'null', '-',
      ]);
      const match = quality.stderr.match(/All:([\d.]+)/);
      if (!match) throw new Error(`${encoder}: missing SSIM result`);
      result.ssim = Number(match[1]);
    }
    if (!results.encoders.some((result) => result.ok)) throw new Error('No encoder succeeded');
    console.log(`Media retained outside git: ${media}`);
    console.log('| Encoder | Result | File bytes | Transcode fps | Realtime multiple | SSIM |');
    console.log('| --- | --- | --- | --- | --- | --- |');
    for (const result of results.encoders) {
      console.log(`| ${result.encoder} | ${result.ok ? 'encoded' : 'FAILED (see log)'} | ` +
        `${result.bytes ?? '-'} | ${result.fps?.toFixed(1) ?? '-'} | ` +
        `${result.realtimeMultiple?.toFixed(2) ?? '-'} | ${result.ssim ?? '-'} |`);
    }
    console.log('Synthetic offline probe only; see results.json for scope and limitations.');
    return results;
  } catch (error) {
    results.error = error.message;
    throw error;
  } finally {
    fs.writeFileSync(path.join(options.out, 'results.json'), JSON.stringify(results, null, 2) + '\n');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const results = runComparison(optionsFrom(process.argv.slice(2)));
    if (results.encoders.some((result) => !result.ok)) process.exitCode = 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}