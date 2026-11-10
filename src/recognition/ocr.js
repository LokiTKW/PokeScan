// Text recognition (Tesseract OCR), fully offline and free.
import { createWorker } from 'tesseract.js';
import { prepareForOcr, CARD_W, CARD_H } from './opencv';

let workerPromise = null;

function getWorker() {
  if (!workerPromise) {
    workerPromise = createWorker('eng', 1, {
      workerPath: '/vendor/tesseract/worker.min.js',
      corePath: '/vendor/tesseract/core',
      langPath: '/vendor/tesseract/lang',
      gzip: true,
      workerBlobURL: false,
    });
  }
  return workerPromise;
}

export function warmUpOcr() { getWorker().catch(() => {}); }

async function read(canvas, whitelist, psm) {
  const w = await getWorker();
  await w.setParameters({ tessedit_char_whitelist: whitelist || '', tessedit_pageseg_mode: psm || '6' });
  const { data } = await w.recognize(canvas);
  return data.text || '';
}

const NUM_RE = /(?:^|[^0-9])(\d{1,3})\s*[\/|lI]\s*(\d{2,3})(?![0-9])/;
const SET_CODE_RE = /([A-Z]{3})\s*(?:EN|PL|DE|FR|IT|ES)(?=\s|\d|$)/;

function parseNumber(text) {
  const m = text.replace(/[oO]/g, '0').match(NUM_RE);
  if (!m) return null;
  const number = parseInt(m[1], 10);
  const total = parseInt(m[2], 10);
  if (!(total >= 10 && total <= 400) || number < 1 || number > 500) return null;
  return { number, total, raw: `${m[1]}/${m[2]}` };
}

const STOP = new Set(['BASIC', 'STAGE', 'STAGEL', 'STAGE1', 'STAGE2', 'HP', 'EX', 'VMAX', 'VSTAR', 'TERA', 'EVOLVES', 'FROM', 'TRAINER', 'ITEM', 'SUPPORTER', 'POKEMON', 'POKÉMON']);

function parseName(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  let best = '';
  for (const line of lines) {
    const words = line.replace(/[^A-Za-zÀ-ž' .-]/g, ' ').split(/\s+/).filter(w => w.length >= 2);
    const kept = [];
    for (const w of words) {
      const up = w.toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (STOP.has(up) && !kept.length) continue;
      kept.push(w);
    }
    const cand = kept.join(' ').trim();
    if (cand.replace(/[^A-Za-z]/g, '').length > best.replace(/[^A-Za-z]/g, '').length) best = cand;
  }
  // "Gengar ex" style suffixes are part of the name
  return best.split(' ').slice(0, 3).join(' ');
}

/**
 * Reads collector number + set code (bottom of the card) and the card name (top).
 * @param {HTMLCanvasElement} card straightened card 630x880
 */
export async function readCard(card) {
  const result = { number: null, total: null, numberRaw: '', setCode: '', name: '', texts: [] };

  const bottomRegions = [
    { x: CARD_W * 0.02, y: CARD_H * 0.91, w: CARD_W * 0.5, h: CARD_H * 0.07 }, // new cards: bottom-left
    { x: CARD_W * 0.5, y: CARD_H * 0.91, w: CARD_W * 0.48, h: CARD_H * 0.07 }, // older cards: bottom-right
    { x: 0, y: CARD_H * 0.87, w: CARD_W, h: CARD_H * 0.12 },
  ];
  outer: for (const r of bottomRegions) {
    for (const img of await prepareForOcr(card, r, 3)) {
      const text = await read(img, '0123456789/ABCDEFGHIJKLMNOPQRSTUVWXYZ', '6');
      result.texts.push(text);
      const code = text.match(SET_CODE_RE);
      if (code && !result.setCode) result.setCode = code[1];
      const n = parseNumber(text);
      if (n) { Object.assign(result, { number: n.number, total: n.total, numberRaw: n.raw }); break outer; }
    }
  }

  const top = { x: CARD_W * 0.04, y: CARD_H * 0.025, w: CARD_W * 0.72, h: CARD_H * 0.085 };
  for (const img of await prepareForOcr(card, top, 2.5)) {
    const text = await read(img, '', '7');
    result.texts.push(text);
    const name = parseName(text);
    if (name.replace(/[^A-Za-z]/g, '').length > result.name.replace(/[^A-Za-z]/g, '').length) result.name = name;
  }
  return result;
}

export { parseNumber, parseName };
