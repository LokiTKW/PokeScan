// Loads OpenCV (computer vision, runs offline in the app) and finds the card in a photo.

let cvPromise = null;

export async function loadOpenCV() {
  return (await loadWrapped()).cv;
}

function loadWrapped() {
  if (cvPromise) return cvPromise;
  cvPromise = new Promise((resolve, reject) => {
    // The OpenCV module object has a .then() method; resolving a promise with it directly
    // makes the promise chase it forever, so hand it over wrapped.
    const done = cv => {
      try { delete cv.then; } catch {}
      if (typeof cv.then === 'function') cv.then = undefined;
      resolve({ cv });
    };
    const s = document.createElement('script');
    s.src = '/vendor/opencv.js';
    s.async = true;
    s.onerror = () => reject(new Error('opencv_load'));
    s.onload = async () => {
      const cv = window.cv;
      if (cv instanceof Promise) { cv.then(m => { window.cv = m; done(m); }); return; }
      if (cv && typeof cv.then === 'function' && !cv.Mat) { cv.onRuntimeInitialized = () => done(window.cv); return; }
      if (cv && cv.Mat) return done(cv);
      cv.onRuntimeInitialized = () => done(window.cv);
    };
    document.head.appendChild(s);
  });
  return cvPromise;
}

export const CARD_W = 630;
export const CARD_H = 880;

function orderPoints(pts) {
  // pts: [{x,y}] x4 -> [tl, tr, br, bl]
  const sum = pts.map(p => p.x + p.y);
  const diff = pts.map(p => p.y - p.x);
  const tl = pts[sum.indexOf(Math.min(...sum))];
  const br = pts[sum.indexOf(Math.max(...sum))];
  const tr = pts[diff.indexOf(Math.min(...diff))];
  const bl = pts[diff.indexOf(Math.max(...diff))];
  return [tl, tr, br, bl];
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function findQuad(cv, src, scale) {
  const gray = new cv.Mat();
  const blur = new cv.Mat();
  const edges = new cv.Mat();
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  const kernel = cv.Mat.ones(5, 5, cv.CV_8U);
  let best = null;
  try {
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, blur, new cv.Size(5, 5), 0);
    const imgArea = src.cols * src.rows;

    const tryEdges = () => {
      cv.findContours(edges, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
      const cands = [];
      for (let i = 0; i < contours.size(); i++) {
        const c = contours.get(i);
        const area = cv.contourArea(c);
        if (area > imgArea * 0.12) cands.push({ c, area });
        else c.delete();
      }
      cands.sort((a, b) => b.area - a.area);
      for (const { c, area } of cands) {
        if (best) { c.delete(); continue; }
        const peri = cv.arcLength(c, true);
        for (const eps of [0.02, 0.03, 0.05]) {
          const approx = new cv.Mat();
          cv.approxPolyDP(c, approx, eps * peri, true);
          if (approx.rows === 4 && cv.isContourConvex(approx)) {
            const pts = [];
            for (let k = 0; k < 4; k++) pts.push({ x: approx.data32S[k * 2] / scale, y: approx.data32S[k * 2 + 1] / scale });
            best = pts;
          }
          approx.delete();
          if (best) break;
        }
        if (!best && area > imgArea * 0.2) {
          // fall back to the rotated bounding box of the biggest shape
          const rect = cv.minAreaRect(c);
          const r = rect.size.width / rect.size.height;
          const ratio = r > 1 ? 1 / r : r;
          if (ratio > 0.6 && ratio < 0.82) {
            const v = cv.RotatedRect.points(rect);
            best = v.map(p => ({ x: p.x / scale, y: p.y / scale }));
          }
        }
        c.delete();
      }
    };

    cv.Canny(blur, edges, 40, 140);
    cv.dilate(edges, edges, kernel);
    tryEdges();
    if (!best) {
      cv.adaptiveThreshold(blur, edges, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY_INV, 31, 5);
      cv.morphologyEx(edges, edges, cv.MORPH_CLOSE, kernel);
      tryEdges();
    }
  } finally {
    gray.delete(); blur.delete(); edges.delete(); contours.delete(); hierarchy.delete(); kernel.delete();
  }
  return best;
}

/**
 * Finds the card and returns it straightened as a 630x880 canvas, plus whether it was found.
 * @param {HTMLCanvasElement} canvas full photo
 */
export async function extractCard(canvas) {
  const cv = await loadOpenCV();
  const maxSide = 900;
  const scale = Math.min(1, maxSide / Math.max(canvas.width, canvas.height));
  const small = document.createElement('canvas');
  small.width = Math.round(canvas.width * scale);
  small.height = Math.round(canvas.height * scale);
  small.getContext('2d').drawImage(canvas, 0, 0, small.width, small.height);

  const src = cv.imread(small);
  let quad = null;
  try { quad = findQuad(cv, src, scale); } finally { src.delete(); }

  const out = document.createElement('canvas');
  out.width = CARD_W;
  out.height = CARD_H;
  if (!quad) {
    // No clear card outline: centre-crop to card proportions so OCR/matching still has a chance.
    const r = CARD_W / CARD_H;
    let w = canvas.width, h = canvas.height;
    if (w / h > r) w = h * r; else h = w / r;
    out.getContext('2d').drawImage(canvas, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h, 0, 0, CARD_W, CARD_H);
    return { canvas: out, found: false };
  }

  let [tl, tr, br, bl] = orderPoints(quad);
  // Landscape outline -> card is lying sideways: rotate corners so the long side is vertical
  if (dist(tl, tr) > dist(tl, bl)) [tl, tr, br, bl] = [bl, tl, tr, br];

  const full = cv.imread(canvas);
  const srcPts = cv.matFromArray(4, 1, cv.CV_32FC2, [tl.x, tl.y, tr.x, tr.y, br.x, br.y, bl.x, bl.y]);
  const dstPts = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, CARD_W, 0, CARD_W, CARD_H, 0, CARD_H]);
  const M = cv.getPerspectiveTransform(srcPts, dstPts);
  const warped = new cv.Mat();
  try {
    cv.warpPerspective(full, warped, M, new cv.Size(CARD_W, CARD_H), cv.INTER_CUBIC, cv.BORDER_REPLICATE);
    cv.imshow(out, warped);
  } finally {
    full.delete(); srcPts.delete(); dstPts.delete(); M.delete(); warped.delete();
  }
  return { canvas: out, found: true };
}

/** Grayscale + upscale (+ Otsu threshold) for OCR. Returns [grayscale, binary, inverted] canvases. */
export async function prepareForOcr(canvas, region, upscale = 3) {
  const cv = await loadOpenCV();
  const crop = document.createElement('canvas');
  crop.width = Math.round(region.w * upscale);
  crop.height = Math.round(region.h * upscale);
  const ctx = crop.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(canvas, region.x, region.y, region.w, region.h, 0, 0, crop.width, crop.height);
  const m = cv.imread(crop);
  const g = new cv.Mat();
  const t = new cv.Mat();
  const outs = [];
  try {
    cv.cvtColor(m, g, cv.COLOR_RGBA2GRAY);
    // 1) contrast-stretched grayscale: Tesseract binarizes well on its own
    const clahe = new cv.CLAHE(2.0, new cv.Size(8, 8));
    const eq = new cv.Mat();
    clahe.apply(g, eq);
    const e = document.createElement('canvas'); cv.imshow(e, eq); outs.push(e);
    eq.delete(); clahe.delete();
    cv.GaussianBlur(g, g, new cv.Size(3, 3), 0);
    cv.threshold(g, t, 0, 255, cv.THRESH_BINARY | cv.THRESH_OTSU);
    const a = document.createElement('canvas'); cv.imshow(a, t); outs.push(a);
    cv.bitwise_not(t, t);
    const b = document.createElement('canvas'); cv.imshow(b, t); outs.push(b);
  } finally { m.delete(); g.delete(); t.delete(); }
  return outs;
}
