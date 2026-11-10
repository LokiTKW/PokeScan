// Perceptual image hash (pHash) – compares how two pictures look, robust to light and small shifts.

const N = 32;
const cosTable = (() => {
  const t = new Float64Array(N * N);
  for (let u = 0; u < N; u++) for (let x = 0; x < N; x++) t[u * N + x] = Math.cos(((2 * x + 1) * u * Math.PI) / (2 * N));
  return t;
})();

function grayPixels(source, region) {
  const c = document.createElement('canvas');
  c.width = N; c.height = N;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  const sw = source.naturalWidth || source.width;
  const sh = source.naturalHeight || source.height;
  const r = region || { x: 0, y: 0, w: 1, h: 1 };
  ctx.drawImage(source, r.x * sw, r.y * sh, r.w * sw, r.h * sh, 0, 0, N, N);
  const d = ctx.getImageData(0, 0, N, N).data;
  const g = new Float64Array(N * N);
  for (let i = 0; i < N * N; i++) g[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
  return g;
}

export function phash(source, region) {
  const g = grayPixels(source, region);
  const dct = [];
  for (let u = 0; u < 8; u++) {
    for (let v = 0; v < 8; v++) {
      let s = 0;
      for (let x = 0; x < N; x++) {
        const cu = cosTable[u * N + x];
        for (let y = 0; y < N; y++) s += g[x * N + y] * cu * cosTable[v * N + y];
      }
      dct.push(s);
    }
  }
  const vals = dct.slice(1);
  const med = [...vals].sort((a, b) => a - b)[Math.floor(vals.length / 2)];
  return dct.map(v => (v > med ? 1 : 0));
}

export function hamming(a, b) {
  let d = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
  return d;
}

// Artwork window of a standard card (relative coordinates)
export const ART = { x: 0.08, y: 0.11, w: 0.84, h: 0.40 };

export function fingerprint(source) {
  return { full: phash(source), art: phash(source, ART) };
}

export function distance(fa, fb) {
  return hamming(fa.full, fb.full) + hamming(fa.art, fb.art);
}
