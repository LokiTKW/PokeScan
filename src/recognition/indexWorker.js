// Builds the visual card index in the background: downloads the small image of every card
// from the free TCGdex database (once) and stores its fingerprint on this computer.
import { describePixels, DESC, SW, SH } from './visualCore';

const CONCURRENCY = 12;
const SAVE_EVERY = 400;
let stopped = false;

const canvas = new OffscreenCanvas(SW, SH);
const ctx = canvas.getContext('2d', { willReadFrequently: true });
ctx.imageSmoothingQuality = 'high';

async function describeUrl(base) {
  let blob = null;
  for (const ext of ['low.webp', 'low.png']) {
    const r = await fetch(`/api/img?u=${encodeURIComponent(`${base}/${ext}`)}`);
    if (r.ok) { blob = await r.blob(); break; }
    if (r.status !== 404 && r.status !== 403) throw new Error('http ' + r.status);
  }
  if (!blob) return null;
  const bmp = await createImageBitmap(blob);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, SW, SH);
  ctx.drawImage(bmp, 0, 0, SW, SH);
  bmp.close && bmp.close();
  return describePixels(ctx.getImageData(0, 0, SW, SH).data);
}

function b64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

async function run() {
  const [cards, meta] = await Promise.all([
    fetch('/api/tcg/all-cards').then(r => (r.ok ? r.json() : Promise.reject(new Error('cards ' + r.status)))),
    fetch('/api/visual-index/meta').then(r => r.json()),
  ]);
  const have = new Set(meta.entries.map(e => e[0]));
  // newest cards first: they are scanned most often
  const todo = cards.filter(c => c.image && !have.has(c.id)).reverse();
  const total = have.size + todo.length;
  let done = have.size, failed = 0;
  postMessage({ type: 'progress', done, total, building: todo.length > 0 });
  if (!todo.length) { postMessage({ type: 'done', total: done }); return; }

  let batch = [];
  let saving = Promise.resolve();
  const flush = () => {
    if (!batch.length) return saving;
    const part = batch; batch = [];
    const bin = new Uint8Array(part.length * DESC);
    part.forEach((e, i) => bin.set(e.desc, i * DESC));
    const body = JSON.stringify({ entries: part.map(e => [e.id, e.name, e.localId, e.image, e.missing ? 1 : 0]), data: b64(bin) });
    saving = saving.then(() => fetch('/api/visual-index/append', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })).then(() => postMessage({ type: 'saved' }));
    return saving;
  };

  let next = 0;
  async function workerLoop() {
    while (!stopped && next < todo.length) {
      const c = todo[next++];
      let desc = null, missing = false;
      for (let attempt = 0; attempt < 3 && !desc && !missing; attempt++) {
        try { desc = await describeUrl(c.image); if (!desc) missing = true; }
        catch { await new Promise(r => setTimeout(r, 1500 * (attempt + 1))); }
      }
      if (!desc && !missing) { failed++; continue; } // network trouble: try again next start
      batch.push({ id: c.id, name: c.name, localId: c.localId, image: c.image, desc: desc || new Uint8Array(DESC), missing });
      done++;
      if (batch.length >= SAVE_EVERY) flush();
      if (done % 20 === 0) postMessage({ type: 'progress', done, total, building: true });
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, workerLoop));
  await flush();
  postMessage({ type: 'progress', done, total, building: false, failed });
  postMessage({ type: 'done', total: done, failed });
}

onmessage = e => {
  if (e.data === 'start') run().catch(err => postMessage({ type: 'error', message: String(err && err.message || err) }));
  if (e.data === 'stop') stopped = true;
};
