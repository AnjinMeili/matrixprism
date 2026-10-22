#!/usr/bin/env node
// Measures how much colour each pattern sends. Every pattern but the Media
// Player is drawn through the real Renderer in headless Chrome (see
// headless.mjs), with the composer's simulated audio, and a frame in every
// six is counted. Run with `npm run measure-colours`; it prints a Markdown
// report. The columns:
//
//   colours    distinct RGB colours in a frame, the median over the frames
//   seen       distinct colours over the whole of a run
//   hues       how many of 24 hue bands of 15 degrees hold at least 0.5% of
//              the pixels that have colour (at least 32 bright, 25% saturated)
//   levels     distinct brightness levels, max(r, g, b), of the 256 possible
//   peak       the brightest level sent
//   lit        the share of pixels at least 16 bright, on average
//
// Options: --width 256 --height 192 --seconds 3 --patterns id,id
// --palette original --hue 0 --brightness 1 --gamma 1 --seed 1 --runs 3, and
// --tsv for the raw rows of every run. Patterns that draw at random are given
// a seeded Math.random, so the same options give the same figures. Chance
// still matters a great deal for many patterns, so each figure is the median
// of several runs, one per seed from --seed up, and the report gives the range
// of colours per frame over the runs. It measures the composer's output only,
// not what the panel shows.
import { parseArgs } from 'node:util';
import { runPage } from './headless.mjs';

const { values } = parseArgs({
  options: {
    width: { type: 'string', default: '256' }, height: { type: 'string', default: '192' },
    seconds: { type: 'string', default: '3' }, patterns: { type: 'string', default: '' },
    palette: { type: 'string', default: 'original' }, hue: { type: 'string', default: '0' },
    brightness: { type: 'string', default: '1' }, gamma: { type: 'string', default: '1' },
    seed: { type: 'string', default: '1' }, runs: { type: 'string', default: '3' },
    tsv: { type: 'boolean', default: false },
  },
});

const median = (list) => {
  const sorted = [...list].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
};
const COLUMNS = ['colours', 'most', 'seen', 'hues', 'levels', 'peak', 'lit'];

try {
  const runs = Number(values.runs);
  if (!Number.isInteger(runs) || runs < 1)
    throw new Error('--runs must be a whole number of at least 1.');
  const page = Object.entries(values).filter(([key, value]) => !['tsv', 'runs', 'seed'].includes(key) && value !== '');
  // One run for each seed, from --seed up.
  const results = [];
  for (let run = 0; run < runs; ++run) {
    const seed = Number(values.seed) + run;
    const query = new URLSearchParams([...page, ['seed', String(seed)]]).toString();
    const text = await runPage('colour-measure.html', { query, budgetMs: 600000, timeoutMs: 900000 });
    if (text.startsWith('FAIL'))
      throw new Error(text);
    results.push(...text.split('\n').map((line) => [seed, ...line.split('\t')]));
  }
  if (values.tsv) {
    console.log(['seed', 'id', 'name', 'family', ...COLUMNS].join('\t'));
    console.log(results.map((row) => row.join('\t')).join('\n'));
    process.exit(0);
  }
  const failed = results.filter((row) => row[4] === 'ERROR');
  const byPattern = new Map();
  for (const [, id, name, family, ...numbers] of results.filter((row) => row[4] !== 'ERROR')) {
    if (!byPattern.has(id))
      byPattern.set(id, { id, name, family, runs: [] });
    byPattern.get(id).runs.push(Object.fromEntries(COLUMNS.map((column, i) => [column, Number(numbers[i])])));
  }
  // Each figure is the median over the runs; the range shows how much the
  // colours per frame depend on chance.
  const measured = [...byPattern.values()].map((pattern) => {
    const of = (column) => pattern.runs.map((run) => run[column]);
    return {
      ...pattern, ...Object.fromEntries(COLUMNS.map((column) => [column, median(of(column))])),
      low: Math.min(...of('colours')), high: Math.max(...of('colours')), peak: Math.max(...of('peak')),
    };
  });
  const families = [...new Set(measured.map((row) => row.family))];
  const lines = [
    `Measured ${measured.length} patterns at ${values.width} by ${values.height}, ${values.seconds} s each, ` +
      `${runs} run${runs === 1 ? '' : 's'} (seeds ${values.seed} to ${Number(values.seed) + runs - 1}), ` +
      `simulated audio, palette ${values.palette}, hue ${values.hue}, brightness ${values.brightness}, ` +
      `gamma ${values.gamma}. Figures are medians over the runs.`,
    '',
    '| Family | Patterns | Colours per frame | Hue bands of 24 | Brightness levels |',
    '| --- | ---: | ---: | ---: | ---: |',
    ...families.map((family) => {
      const members = measured.filter((row) => row.family === family);
      return `| ${family} | ${members.length} | ${median(members.map((row) => row.colours))} | ` +
        `${median(members.map((row) => row.hues))} | ${median(members.map((row) => row.levels))} |`;
    }),
    '',
    '| Pattern | Id | Family | Colours per frame | Range over runs | Seen | Hues | Levels | Peak | Lit % |',
    '| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...measured.sort((a, b) => a.colours - b.colours || a.hues - b.hues).map((row) =>
      `| ${row.name} | \`${row.id}\` | ${row.family} | ${row.colours} | ${row.low}–${row.high} | ${row.seen} | ` +
      `${row.hues} | ${row.levels} | ${row.peak} | ${row.lit} |`),
  ];
  if (failed.length)
    lines.push('', ...failed.map(([seed, id, , , , message]) => `- \`${id}\` failed with seed ${seed}: ${message}`));
  console.log(lines.join('\n'));
  process.exit(failed.length ? 1 : 0);
} catch (error) {
  console.error(error.message);
  process.exit(2);
}
