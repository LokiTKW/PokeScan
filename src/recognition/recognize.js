// Free card recognition pipeline (no AI, no keys):
// 1) OpenCV finds and straightens the card  2) Tesseract OCR reads number "104/091", set code and name
// 3) visual search compares the picture with the fingerprints of all cards (works without any text)
// 4) the free TCGdex database gives candidates for the number/name  5) pHash re-checks the best ones.
import { api, imgProxy } from '../api';
import { extractCard } from './opencv';
import { readCard } from './ocr';
import { fingerprint, distance } from './phash';
import { loadIndex, visualSearch, visualScores, indexSize } from './visual';
import { CARD_W, CARD_H } from './opencv';

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('img_load'));
    img.src = src;
  });
}

function toCanvas(img) {
  const c = document.createElement('canvas');
  c.width = img.naturalWidth || img.width;
  c.height = img.naturalHeight || img.height;
  c.getContext('2d').drawImage(img, 0, 0);
  return c;
}

function nameSimilarity(a, b) {
  const n = s => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const x = n(a), y = n(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (y.includes(x) || x.includes(y)) return 0.8;
  // bigram overlap
  const grams = s => new Set(Array.from({ length: s.length - 1 }, (_, i) => s.slice(i, i + 2)));
  const gx = grams(x), gy = grams(y);
  let inter = 0;
  gx.forEach(g => { if (gy.has(g)) inter++; });
  return (2 * inter) / (gx.size + gy.size || 1);
}

const toInt = s => { const m = String(s ?? '').match(/\d+/); return m ? parseInt(m[0], 10) : NaN; };

function cropToCard(photo, box) {
  const c = document.createElement('canvas');
  c.width = CARD_W; c.height = CARD_H;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  const [x, y, w, h] = box;
  ctx.drawImage(photo, x * photo.width, y * photo.height, w * photo.width, h * photo.height, 0, 0, CARD_W, CARD_H);
  return c;
}

/**
 * @param {string} dataUrl photo
 * @param {(step: string) => void} onStep progress callback
 * @param {{box?: number[]}} [opts] box = where the phone saw the card (fractions x,y,w,h)
 */
export async function recognize(dataUrl, onStep = () => {}, opts = {}) {
  const t0 = performance.now();
  onStep('Szukam karty na zdjęciu…');
  const photo = toCanvas(await loadImage(dataUrl));
  const { canvas: found0, found } = await extractCard(photo);
  const boxCard = opts.box ? cropToCard(photo, opts.box) : null;
  const card = found || !boxCard ? found0 : boxCard;
  const views = [card, boxCard && card !== boxCard ? boxCard : null].filter(Boolean);
  const cardUrl = card.toDataURL('image/jpeg', 0.9);

  onStep('Odczytuję numer i nazwę…');
  const ocr = await readCard(card);

  onStep('Porównuję obraz z bazą kart…');
  try { await loadIndex(); } catch {}
  // scanning into a Pokédex: look only at that set (much more accurate); fall back to all cards
  // if nothing in the set looks alike
  const inSet = id => !opts.setId || String(id).startsWith(`${opts.setId}-`);
  let visual = indexSize() ? visualSearch(views, 12, opts.setId || null) : [];
  let restricted = !!opts.setId;
  if (restricted && (!visual.length || visual[0].score < VIS_FLOOR + 0.1)) { visual = indexSize() ? visualSearch(views, 12) : []; restricted = false; }

  onStep('Szukam w bazie kart…');
  let candidates = [];
  if (ocr.number && ocr.total) candidates = await api.match({ number: ocr.number, total: ocr.total, name: ocr.name }).catch(() => []);
  if (!candidates.length && ocr.name.replace(/[^A-Za-z]/g, '').length >= 3) {
    // try the first word of the name (e.g. "Gengar" from "Gengar ex")
    candidates = await api.match({ name: ocr.name }).catch(() => []);
    if (!candidates.length) candidates = await api.match({ name: ocr.name.split(' ')[0] }).catch(() => []);
  }
  const byNumberIds = new Set(ocr.number && ocr.total ? candidates.filter(c => toInt(c.localId) === ocr.number).map(c => c.id) : []);

  // candidate pool: text matches + visually similar cards
  const pool = new Map();
  for (const c of candidates.filter(c => !restricted || inSet(c.id)).slice(0, 16)) pool.set(c.id, { ...c });
  for (const v of visual) {
    const base = v.image;
    const c = pool.get(v.id) || { id: v.id, name: v.name, localId: v.localId, image: `${base}/low.png`, imageHigh: `${base}/high.png`, set: null };
    pool.set(v.id, { ...c, vdist: v.dist, vscore: v.score });
  }
  const missingVis = [...pool.values()].filter(c => c.vscore == null).map(c => c.id);
  if (missingVis.length && indexSize()) {
    const extra = visualScores(views, missingVis);
    for (const [id, v] of extra) Object.assign(pool.get(id), { vdist: v.dist, vscore: v.score });
  }

  onStep(`Sprawdzam ${Math.min(pool.size, 16)} najbardziej podobnych kart…`);
  const fp = fingerprint(card);
  const list = [...pool.values()].sort((a, b) => (b.vscore ?? 0) - (a.vscore ?? 0)).slice(0, 16);
  const scored = await Promise.all(list.map(async c => {
    let dist = 128;
    try { dist = distance(fp, fingerprint(await loadImage(imgProxy(c.image)))); } catch {}
    const nameScore = nameSimilarity(ocr.name, c.name);
    const numberMatch = byNumberIds.has(c.id);
    const v = c.vscore ?? 0.5;
    // lower is better
    const score = (1 - v) * VIS_WEIGHT + dist * 0.5 - nameScore * 12 - (numberMatch ? 30 : 0);
    return { ...c, dist, nameScore, numberMatch, score };
  }));
  scored.sort((a, b) => a.score - b.score);

  let best = scored[0] || null;
  let confidence = 0;
  if (best) {
    // how clearly the picture stands out from the next most similar card
    const v = best.vscore ?? 0;
    const rivalV = visual.filter(c => c.id !== best.id).reduce((m, c) => Math.max(m, c.score), 0);
    const gap = indexSize() ? v - rivalV : 0;
    const textPart = best.numberMatch ? 0.45 : best.nameScore >= 0.8 ? 0.2 : 0;
    const clamp01 = x => Math.max(0, Math.min(1, x));
    confidence = clamp01(textPart + clamp01(gap / VIS_GAP) * 0.45 + clamp01((v - VIS_FLOOR) / 0.3) * 0.15);
    // nothing read and the picture is not like any card: better to say "not recognized"
    if (!best.numberMatch && best.nameScore < 0.5 && v < VIS_FLOOR) { best = null; confidence = 0; }
  }
  if (best && !best.set) {
    try { const d = await api.card(best.id); if (d && d.set) best = { ...best, set: { id: d.set.id, name: d.set.name, total: d.set.total, logo: d.set.logo } }; } catch {}
  }

  const ms = Math.round(performance.now() - t0);
  api.log(`recognize ${ms}ms set=${opts.setId || '-'}${restricted ? '' : opts.setId ? '(fallback)' : ''} found=${found} box=${!!boxCard} ocr=${JSON.stringify({ n: ocr.numberRaw, code: ocr.setCode, name: ocr.name })} index=${indexSize()} text=${candidates.length} visual=${visual.slice(0, 3).map(v => `${v.id}:${v.score.toFixed(3)}`).join(',')} best=${best ? `${best.id} v=${(best.vscore ?? 0).toFixed(3)} d=${best.dist}` : '-'} conf=${confidence.toFixed(2)} texts=${JSON.stringify(ocr.texts).slice(0, 200)}`);

  return { best, alternatives: scored.filter(c => c !== best).slice(0, 8), ocr, cardFound: found || !!boxCard, cardUrl, confidence, ms };
}

// Calibrated on 150 test photos (perspective, sleeves, glare, blur) against 1500 cards:
// the right card scores 0.6–0.95, and when it is clearly ahead of the next card by >= 0.12 it was always right.
const VIS_WEIGHT = 400;  // weight of the visual score in the ranking
const VIS_FLOOR = 0.6;   // below this the picture is not like any card
const VIS_GAP = 0.12;    // lead over the next card that counts as certain
