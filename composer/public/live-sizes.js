// The sizes Go live offers (#6): whole multiples of the panel, in the panel's own
// shape, so its pixels stay square and evenly sized when enlarged; YouTube
// frames a picture of another shape itself, so no bars are added. From 240 to
// 1080 high and at most 1920 wide, even in both directions as the encoder
// needs; at most six, keeping those nearest the usual heights when a small
// panel would offer more. The default is the one nearest 720 high.
const STANDARD_HEIGHTS = [360, 480, 720, 1080];
const MAX_SIZES = 6;

export function liveSizes(width, height) {
  const sizes = [];
  for (let scale = 1; height * scale <= 1080 && width * scale <= 1920; ++scale) {
    const w = width * scale, h = height * scale;
    if (h >= 240 && w % 2 === 0 && h % 2 === 0) sizes.push({ width: w, height: h, scale });
  }
  if (sizes.length <= MAX_SIZES) return sizes;
  const kept = new Set(STANDARD_HEIGHTS.map((target) =>
    sizes.reduce((best, size) => (Math.abs(size.height - target) < Math.abs(best.height - target) ? size : best))));
  return sizes.filter((size) => kept.has(size));
}

export function defaultLiveSize(sizes) {
  return sizes.reduce((best, size) => (Math.abs(size.height - 720) < Math.abs(best.height - 720) ? size : best), sizes[0]);
}
