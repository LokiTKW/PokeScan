// Main-thread side of the visual search: loads the fingerprints and finds the most similar cards.
import { describePixels, descDistance, DESC, SW, SH, MAX_DISTANCE } from './visualCore';

let index = null;          // { entries: [[id,name,localId,image,missing]], data: Uint8Array }
let loading = null;
let version = 0;

export async function loadIndex(force = false) {
  if (index && !force) return index;
  if (loading && !force) return loading;
  loading = (async () => {
    const [meta, bin] = await Promise.all([
      fetch('/api/visual-index/meta').then(r => r.json()),
      fetch('/api/visual-index/bin').then(r => r.arrayBuffer()),
    ]);
    const data = new Uint8Array(bin);
    const n = Math.min(meta.entries.length, Math.floor(data.length / DESC));
    index = { entries: meta.entries.slice(0, n), data };
    version++;
    return index;
  })().finally(() => { loading = null; });
  return loading;
}

export function indexSize() { return index ? index.entries.length : 0; }

/** Fingerprint of a region of a canvas (region in pixels). */
function describeRegion(src, r, rotate180 = false) {
  const c = document.createElement('canvas');
  c.width = SW; c.height = SH;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, SW, SH);
  if (rotate180) { ctx.translate(SW, SH); ctx.rotate(Math.PI); }
  ctx.drawImage(src, r.x, r.y, r.w, r.h, 0, 0, SW, SH);
  return describePixels(ctx.getImageData(0, 0, SW, SH).data);
}

/**
 * Query fingerprints for a straightened card picture. The detected outline may be a bit
 * too big (sleeve, toploader, shadow) or shifted, so several crops are tried.
 */
function queryVariants(canvas) {
  const W = canvas.width, H = canvas.height;
  const out = [];
  for (const s of [1, 0.95, 0.9, 0.85]) {
    for (const [dx, dy] of [[0, 0], [-0.02, 0], [0.02, 0], [0, -0.02], [0, 0.02]]) {
      const w = W * s, h = H * s;
      const r = { x: (W - w) / 2 + dx * W, y: (H - h) / 2 + dy * H, w, h };
      out.push({ s, dx, dy, rot: false, coarse: dx === 0 && dy === 0, desc: describeRegion(canvas, r) });
    }
  }
  // upside-down card
  out.push({ s: 1, dx: 0, dy: 0, rot: true, coarse: true, desc: describeRegion(canvas, { x: 0, y: 0, w: W, h: H }, true) });
  out.push({ s: 0.9, dx: 0, dy: 0, rot: true, coarse: true, desc: describeRegion(canvas, { x: W * 0.05, y: H * 0.05, w: W * 0.9, h: H * 0.9 }, true) });
  return out;
}

/**
 * Most similar cards in the index.
 * @param {HTMLCanvasElement[]} canvases straightened card pictures (630x880 or any card-shaped crop)
 * @returns {{id,name,localId,image,dist,score}[]} best first; score 0..1 (1 = identical)
 */
export function visualSearch(canvases, k = 12, setId = null) {
  if (!index || !index.entries.length) return [];
  const { entries, data } = index;
  const variants = canvases.flatMap(queryVariants);
  const coarse = variants.filter(v => v.coarse);
  const n = entries.length;

  // stage 1: a few crops against everything
  const best1 = new Float32Array(n).fill(Infinity);
  const prefix = setId ? `${setId}-` : null;
  for (let i = 0; i < n; i++) {
    if (entries[i][4] || (prefix && !entries[i][0].startsWith(prefix))) continue;
    let b = Infinity;
    for (const v of coarse) { const d = descDistance(v.desc, data, i * DESC, b); if (d < b) b = d; }
    best1[i] = b;
  }
  const order = Array.from(best1.keys()).filter(i => best1[i] < Infinity).sort((a, b) => best1[a] - best1[b]).slice(0, 400);

  // stage 2: all crops against the closest 400
  const scored = order.map(i => {
    let b = best1[i];
    for (const v of variants) { const d = descDistance(v.desc, data, i * DESC, b); if (d < b) b = d; }
    const [id, name, localId, image] = entries[i];
    return { id, name, localId, image, dist: b, score: 1 - b / MAX_DISTANCE };
  });
  scored.sort((a, b) => a.dist - b.dist);
  return scored.slice(0, k);
}

/** Visual distance of specific cards (e.g. the ones found by OCR). Returns Map id -> {dist, score}. */
export function visualScores(canvases, ids) {
  const out = new Map();
  if (!index || !index.entries.length || !ids.length) return out;
  const want = new Set(ids);
  const variants = canvases.flatMap(queryVariants);
  index.entries.forEach((e, i) => {
    if (!want.has(e[0]) || e[4]) return;
    let b = Infinity;
    for (const v of variants) { const d = descDistance(v.desc, index.data, i * DESC, b); if (d < b) b = d; }
    out.set(e[0], { dist: b, score: 1 - b / MAX_DISTANCE });
  });
  return out;
}
