// Reads the Beatport EDM Key Dataset (Ángel Faraldo, 2017,
// doi:10.5281/zenodo.1101082) as a list of tracks for the audio comparison
// (T26). The folder holds audio/ (MP3 previews), keys/ (one label each),
// meta/ (Beatport's metadata for about half the tracks, with its BPM and
// key) and Beatport-EDM-Key-Dataset.xlsx (the labels with a confidence, key
// changes, genre and comments). Nothing here is copied into the repository.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const NOTE_INDEX = {
  C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6,
  G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11,
};

// "C# minor" or Beatport's "Db maj" as { tonic, mode }; null for anything
// else, such as "X", a mode name or two keys.
export function parseKey(label) {
  const text = String(label ?? '').trim().replace(/♯/g, '#').replace(/♭/g, 'b');
  const match = /^([A-G][#b]?)\s*(major|minor|maj|min)$/.exec(text);
  if (!match || !(match[1] in NOTE_INDEX)) return null;
  return { tonic: NOTE_INDEX[match[1]], mode: match[2].startsWith('maj') ? 'major' : 'minor' };
}

// The files of a zip archive, by name, as Buffers.
function unzip(buffer) {
  let end = buffer.length - 22;
  while (end >= 0 && buffer.readUInt32LE(end) !== 0x06054b50) --end;
  if (end < 0) throw new Error('not a zip archive');
  const files = {};
  let at = buffer.readUInt32LE(end + 16);
  for (let i = buffer.readUInt16LE(end + 10); i > 0; --i) {
    if (buffer.readUInt32LE(at) !== 0x02014b50) throw new Error('bad zip directory');
    const method = buffer.readUInt16LE(at + 10), size = buffer.readUInt32LE(at + 20);
    const nameLength = buffer.readUInt16LE(at + 28);
    const name = buffer.toString('utf8', at + 46, at + 46 + nameLength);
    const local = buffer.readUInt32LE(at + 42);
    const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    const data = buffer.subarray(start, start + size);
    files[name] = method === 8 ? zlib.inflateRawSync(data) : data;
    at += 46 + nameLength + buffer.readUInt16LE(at + 30) + buffer.readUInt16LE(at + 32);
  }
  return files;
}

const unescapeXml = (text) => text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'").replace(/&amp;/g, '&');

// The first sheet of an .xlsx file as rows of { column letter: text }.
export function readSheet(file) {
  const files = unzip(fs.readFileSync(file));
  const shared = (files['xl/sharedStrings.xml']?.toString('utf8').match(/<si>[\s\S]*?<\/si>/g) ?? [])
    .map((si) => unescapeXml((si.match(/<t[^>]*>([\s\S]*?)<\/t>/g) ?? []).map((t) => t.replace(/<[^>]+>/g, '')).join('')));
  const sheet = files['xl/worksheets/sheet1.xml'].toString('utf8');
  return (sheet.match(/<row[^>]*>[\s\S]*?<\/row>/g) ?? []).map((row) => {
    const cells = {};
    for (const [, column, attributes, body] of row.matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const value = body?.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      const inline = body?.match(/<t[^>]*>([\s\S]*?)<\/t>/)?.[1];
      cells[column] = / t="s"/.test(attributes) && value !== undefined ? shared[Number(value)] :
        unescapeXml(value ?? inline ?? '');
    }
    return cells;
  });
}

// The dataset's tracks: { id, file, label, key, confidence, changes, genre,
// comment, bpm, beatportKey, set }. `set` is 'clear' (one major or minor key,
// no change, confidence 2), 'unsure' (the same at confidence 1), 'none'
// (labelled X, no key) or 'other' (modal, ambiguous, changing, or confidence 0).
export function readBeatport(folder) {
  const audio = new Map(fs.readdirSync(path.join(folder, 'audio'))
    .filter((name) => name.endsWith('.mp3')).map((name) => [name.split(' ')[0], name]));
  const meta = new Map();
  for (const name of fs.readdirSync(path.join(folder, 'meta'))) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(folder, 'meta', name), 'utf8'));
      meta.set(String(data.id ?? name.split(' ')[0]), data);
    } catch {
      // About a dozen metadata files are not valid JSON; those tracks have no BPM.
    }
  }
  const [head, ...rows] = readSheet(path.join(folder, 'Beatport-EDM-Key-Dataset.xlsx'));
  const column = Object.fromEntries(Object.entries(head).map(([letter, name]) => [name, letter]));
  return rows.filter((row) => row[column.id]).map((row) => {
    const id = row[column.id];
    const label = row[column.main_key];
    const key = parseKey(label);
    const confidence = Number(row[column.confidence]);
    const changes = [row[column.change1], row[column.change2]].filter(Boolean).length;
    const set = label === 'X' ? 'none' : key && !changes && confidence === 2 ? 'clear' :
      key && !changes && confidence === 1 ? 'unsure' : 'other';
    const info = meta.get(id);
    return {
      id, file: audio.has(id) ? path.join(folder, 'audio', audio.get(id)) : null, label, key, confidence,
      changes, genre: row[column.genres] || info?.genres?.[0]?.name || '', comment: row[column.comments] || '',
      bpm: Number(info?.bpm) || null, beatportKey: parseKey(info?.key), set,
    };
  });
}
