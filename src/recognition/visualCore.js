// Visual card search: every card in the database gets a tiny "picture fingerprint"
// (16x22 brightness grid + 8x11 colour grid, 528 bytes). A photo is compared with all of them,
// which works even when no text on the card can be read (full-art cards, sleeves, blur).
// Shared by the main thread and the index-building worker (no DOM access here).

export const GW = 16, GH = 22;     // brightness grid
export const CW = 8, CH = 11;      // colour grid (2 channels)
export const DESC = GW * GH + CW * CH * 2; // 528 bytes
export const SW = 64, SH = 88;     // size the card is drawn at before averaging

/**
 * Fingerprint from RGBA pixels of the card drawn at SW x SH.
 * @param {Uint8ClampedArray} px
 * @param {Uint8Array} [out]
 */
export function describePixels(px, out = new Uint8Array(DESC)) {
  const L = new Float32Array(GW * GH), A = new Float32Array(CW * CH), B = new Float32Array(CW * CH);
  for (let y = 0; y < SH; y++) {
    for (let x = 0; x < SW; x++) {
      const i = (y * SW + x) * 4;
      const r = px[i], g = px[i + 1], b = px[i + 2];
      L[((y >> 2) * GW) + (x >> 2)] += 0.299 * r + 0.587 * g + 0.114 * b;
      const ci = (y >> 3) * CW + (x >> 3);
      A[ci] += r - g;
      B[ci] += (r + g) / 2 - b;
    }
  }
  // brightness: normalised (mean 128, std 40) so exposure and contrast do not matter
  let mean = 0;
  for (let i = 0; i < L.length; i++) { L[i] /= 16; mean += L[i]; }
  mean /= L.length;
  let v = 0;
  for (let i = 0; i < L.length; i++) v += (L[i] - mean) ** 2;
  const std = Math.sqrt(v / L.length) || 1;
  for (let i = 0; i < L.length; i++) out[i] = clamp(128 + ((L[i] - mean) / std) * 40);
  // colour: opponent channels, kept absolute (the overall colour of a card is very telling)
  const o = GW * GH;
  for (let i = 0; i < A.length; i++) {
    out[o + i * 2] = clamp(128 + A[i] / 64 / 2);
    out[o + i * 2 + 1] = clamp(128 + B[i] / 64 / 2);
  }
  return out;
}

const clamp = v => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));

const LCAP = 60, CCAP = 40, CWEIGHT = 1.5;
/** Robust distance (big local differences such as glare are capped). Lower = more similar. */
export function descDistance(q, data, offset, limit = Infinity) {
  let d = 0;
  const n = GW * GH;
  for (let i = 0; i < n; i++) {
    const e = q[i] - data[offset + i];
    d += e < 0 ? (e < -LCAP ? LCAP : -e) : (e > LCAP ? LCAP : e);
  }
  if (d > limit) return d;
  let c = 0;
  for (let i = n; i < DESC; i++) {
    const e = q[i] - data[offset + i];
    c += e < 0 ? (e < -CCAP ? CCAP : -e) : (e > CCAP ? CCAP : e);
  }
  return d + c * CWEIGHT;
}

export const MAX_DISTANCE = GW * GH * LCAP + CW * CH * 2 * CCAP * CWEIGHT;
