// Local server for PokéScan 2.
// - serves the desktop UI (dist/) and vendor files (OpenCV, Tesseract) to the app window
// - serves the phone page (/phone) and receives photos from the phone (needs the QR pairing code)
// - card database + prices (TCGdex, NBP), Allegro/Vinted prices (via the built-in browser)
// - stores the collection in a JSON file

const http = require('http');
const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const QRCode = require('qrcode');
const tcg = require('./tcg');

const DEFAULT_PORT = 8766;
const MAX_PHOTO_BYTES = 15 * 1024 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.wasm': 'application/wasm',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.svg': 'image/svg+xml',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.gz': 'application/gzip', '.map': 'application/json',
};

const INDEX_DESC = 528; // bytes per card fingerprint (src/recognition/visualCore.js)

function lanAddresses() {
  const list = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      const virtual = /virtual|vmware|vbox|hyper-v|vethernet|wsl|docker|loopback|bluetooth/i.test(name);
      list.push({ name, address: a.address, virtual });
    }
  }
  const prio = a => (a.virtual ? 10 : 0) + (/^192\.168\./.test(a.address) ? 0 : /^10\./.test(a.address) ? 1 : 2);
  return list.sort((a, b) => prio(a) - prio(b));
}

function isLocal(req) {
  const ip = req.socket.remoteAddress || '';
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > limit) { reject(Object.assign(new Error('too_large'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJson(req, limit = 2 * 1024 * 1024) {
  const b = await readBody(req, limit);
  return b.length ? JSON.parse(b.toString('utf8')) : {};
}

function serveFile(res, full) {
  try {
    if (!fs.statSync(full).isFile()) return false;
  } catch { return false; }
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(full).toLowerCase()] || 'application/octet-stream',
    'Cache-Control': full.includes(`${path.sep}assets${path.sep}`) || full.includes(`${path.sep}vendor${path.sep}`) ? 'max-age=31536000' : 'no-cache',
  });
  fs.createReadStream(full).pipe(res);
  return true;
}

/**
 * @param {{ webDir: string, vendorDir: string, dataDir: string, port?: number, prices?: any, log?: Function, onOpenExternal?: Function }} opts
 */
/** Self-signed certificate for the phone page, generated once and kept in the data folder. */
function loadCertificate(dataDir, log) {
  const file = path.join(dataDir, 'https-cert.json');
  try {
    const c = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (c.private && c.cert && c.expires > Date.now() + 30 * 86400000) return c;
  } catch {}
  const selfsigned = require('selfsigned');
  const altNames = [{ type: 2, value: 'localhost' }, { type: 7, ip: '127.0.0.1' }, ...lanAddresses().map(a => ({ type: 7, ip: a.address }))];
  const pems = selfsigned.generate([{ name: 'commonName', value: 'PokeScan 2' }], {
    keySize: 2048, days: 3650, algorithm: 'sha256',
    extensions: [{ name: 'basicConstraints', cA: false }, { name: 'keyUsage', digitalSignature: true, keyEncipherment: true }, { name: 'extKeyUsage', serverAuth: true }, { name: 'subjectAltName', altNames }],
  });
  const c = { private: pems.private, cert: pems.cert, expires: Date.now() + 3650 * 86400000 };
  try { fs.writeFileSync(file, JSON.stringify(c)); } catch {}
  log('[https] new certificate generated');
  return c;
}

function startServer(opts) {
  const port = opts.port || Number(process.env.POKESCAN_PORT) || DEFAULT_PORT;
  const dataDir = opts.dataDir;
  fs.mkdirSync(dataDir, { recursive: true });
  const logFile = path.join(dataDir, 'pokescan.log');
  const log = (...a) => {
    console.log(...a);
    try {
      try { if (fs.statSync(logFile).size > 1024 * 1024) fs.renameSync(logFile, logFile + '.old'); } catch {}
      fs.appendFileSync(logFile, `${new Date().toISOString()} ${a.map(x => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')}\n`);
    } catch {}
  };

  // The pairing code is kept between starts, so a phone link or home-screen icon keeps working.
  const tokenFile = path.join(dataDir, 'phone-token.txt');
  let token = '';
  try { token = fs.readFileSync(tokenFile, 'utf8').trim(); } catch {}
  if (!/^[A-Za-z0-9_-]{12,64}$/.test(token)) {
    token = crypto.randomBytes(12).toString('base64url');
    try { fs.writeFileSync(tokenFile, token); } catch {}
  }
  const listeners = new Set();
  const photos = new Map();
  let lastPhoneSeen = 0;

  const pokedexFile = path.join(dataDir, 'pokedex.json');
  const readJsonFile = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } };
  const writeJsonFile = (file, data) => { const tmp = file + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(data, null, 1)); fs.renameSync(tmp, file); };
  const indexMetaFile = path.join(dataDir, 'visual-index.json');
  const indexBinFile = path.join(dataDir, 'visual-index.bin');

  // ---------- collection storage ----------
  const collectionFile = path.join(dataDir, 'collection.json');
  const readCollection = () => {
    try { return JSON.parse(fs.readFileSync(collectionFile, 'utf8')); } catch { return []; }
  };
  const writeCollection = list => {
    const tmp = collectionFile + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(list, null, 1));
    fs.renameSync(tmp, collectionFile);
  };

  // ---------- price lookups (sequential, cached) ----------
  const priceCache = new Map();
  let priceChain = Promise.resolve();
  function lookupPrice(source, q) {
    const key = `${source}|${q.query}|${q.number || ''}`;
    const hit = priceCache.get(key);
    if (hit && Date.now() - hit.at < 3600 * 1000) return Promise.resolve({ ...hit.data, cached: true });
    const run = priceChain.then(() => opts.prices.lookup(source, q));
    priceChain = run.catch(() => {});
    return run.then(data => {
      if (!data.blocked) priceCache.set(key, { at: Date.now(), data });
      log(`[price] ${source} "${q.query}" -> ${data.count}/${data.raw} items, median ${data.median}`);
      return data;
    });
  }

  function broadcast(event) {
    const data = `data: ${JSON.stringify(event)}\n\n`;
    for (const res of listeners) res.write(data);
  }

  // The live camera on the phone (getUserMedia) only works on https pages,
  // so the phone gets an https address with a self-signed certificate.
  let httpsPort = null;
  function phoneUrl() {
    const ip = (lanAddresses()[0] || {}).address || 'localhost';
    return httpsPort ? `https://${ip}:${httpsPort}/phone?t=${token}` : `http://${ip}:${port}/phone?t=${token}`;
  }

  const handler = async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const p = url.pathname;
    const fromPhone = url.searchParams.get('t') === token;

    try {
      // ===== phone (LAN, pairing code required) =====
      if (p === '/phone') {
        if (!fromPhone) { res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Kod parowania jest nieaktualny. Zeskanuj ponownie kod QR z aplikacji PokéScan 2 na komputerze.'); return; }
        lastPhoneSeen = Date.now();
        broadcast({ type: 'phone', connected: true });
        res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-store' });
        res.end(fs.readFileSync(path.join(__dirname, 'phone.html'), 'utf8').replace(/__TOKEN__/g, token));
        return;
      }
      if (p === '/phone.webmanifest') {
        if (!fromPhone) { res.writeHead(403); res.end(); return; }
        res.writeHead(200, { 'Content-Type': 'application/manifest+json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({
          name: 'PokéScan – skaner',
          short_name: 'PokéScan',
          start_url: `/phone?t=${token}`,
          scope: '/',
          display: 'standalone',
          orientation: 'portrait',
          background_color: '#07070d',
          theme_color: '#07070d',
          icons: [{ src: '/phone-icon.png', sizes: '1024x1024', type: 'image/png', purpose: 'any' }],
        }));
        return;
      }
      if (p === '/phone-icon.png') {
        const icon = path.join(__dirname, 'icon.png');
        if (!fs.existsSync(icon)) { res.writeHead(404); res.end(); return; }
        res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'max-age=86400' });
        fs.createReadStream(icon).pipe(res);
        return;
      }
      if (p === '/api/photo' && req.method === 'POST') {
        if (!fromPhone) return sendJson(res, 403, { error: 'bad_token' });
        const body = await readBody(req, MAX_PHOTO_BYTES);
        if (body.length < 1000) return sendJson(res, 400, { error: 'empty' });
        const id = crypto.randomBytes(6).toString('hex');
        lastPhoneSeen = Date.now();
        photos.set(id, { state: 'queued', text: '', at: Date.now() });
        const box = String(req.headers['x-card-box'] || '').split(',').map(Number);
        broadcast({ type: 'photo', id, base64: body.toString('base64'), box: box.length === 4 && box.every(v => Number.isFinite(v) && v > -0.5 && v < 1.5) ? box : null });
        log(`[phone] photo ${id} ${Math.round(body.length / 1024)} KB, windows: ${listeners.size}`);
        return sendJson(res, 200, { id, desktopConnected: listeners.size > 0 });
      }
      if (p === '/api/photo-status' && req.method === 'GET') {
        if (!fromPhone) return sendJson(res, 403, { error: 'bad_token' });
        lastPhoneSeen = Date.now();
        const out = {};
        for (const id of (url.searchParams.get('ids') || '').split(',').filter(Boolean)) out[id] = photos.get(id) || null;
        return sendJson(res, 200, out);
      }

      // ===== everything else: this computer only =====
      if (!isLocal(req)) { res.writeHead(403); res.end(); return; }

      if (p.startsWith('/vendor/')) {
        const rel = decodeURIComponent(p.slice('/vendor/'.length));
        const full = path.join(opts.vendorDir, rel);
        if (full.startsWith(path.resolve(opts.vendorDir)) && serveFile(res, full)) return;
        res.writeHead(404); res.end(); return;
      }

      if (p.startsWith('/api/')) {
        if (p === '/api/pairing') {
          const link = phoneUrl();
          const qr = await QRCode.toDataURL(link, { margin: 1, width: 360, color: { dark: '#0b0b14', light: '#ffffff' } });
          return sendJson(res, 200, { url: link, secure: link.startsWith('https:'), fallbackUrl: `http://${(lanAddresses()[0] || {}).address || 'localhost'}:${port}/phone?t=${token}`, qr, addresses: lanAddresses().map(a => `${a.name}: ${a.address}`), phoneConnected: Date.now() - lastPhoneSeen < 30000, pricesAvailable: !!opts.prices });
        }
        if (p === '/api/events') {
          res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
          res.write(`data: ${JSON.stringify({ type: 'hello', phoneConnected: Date.now() - lastPhoneSeen < 30000 })}\n\n`);
          listeners.add(res);
          const ping = setInterval(() => res.write(': ping\n\n'), 15000);
          req.on('close', () => { clearInterval(ping); listeners.delete(res); });
          return;
        }
        if (p === '/api/photo-status' && req.method === 'POST') {
          const { id, state, text } = await readJson(req);
          if (photos.has(id)) photos.set(id, { state: String(state), text: String(text || '').slice(0, 300), at: Date.now() });
          return sendJson(res, 200, { ok: true });
        }
        if (p === '/api/log' && req.method === 'POST') {
          const { msg } = await readJson(req);
          log('[ui]', String(msg).slice(0, 1000));
          return sendJson(res, 200, { ok: true });
        }

        // --- card database ---
        if (p === '/api/tcg/match') {
          const n = parseInt(url.searchParams.get('number') || '', 10);
          const t = parseInt(url.searchParams.get('total') || '', 10);
          const cards = await tcg.matchCards({ number: n, total: t, name: url.searchParams.get('name') || '' });
          return sendJson(res, 200, cards);
        }
        if (p === '/api/tcg/search') {
          return sendJson(res, 200, await tcg.searchByName(url.searchParams.get('q') || ''));
        }
        if (p.startsWith('/api/tcg/card/')) {
          const card = await tcg.cardDetail(decodeURIComponent(p.slice('/api/tcg/card/'.length)));
          return card ? sendJson(res, 200, card) : sendJson(res, 404, { error: 'not_found' });
        }
        if (p === '/api/tcg/sets') return sendJson(res, 200, await tcg.setList());
        if (p.startsWith('/api/tcg/set/')) {
          const set = await tcg.setWithCards(decodeURIComponent(p.slice('/api/tcg/set/'.length)));
          return set ? sendJson(res, 200, set) : sendJson(res, 404, { error: 'not_found' });
        }

        // --- Pokédex: one per set ---
        if (p === '/api/pokedex' && req.method === 'GET') return sendJson(res, 200, readJsonFile(pokedexFile, []));
        if (p === '/api/pokedex' && req.method === 'POST') {
          let { setId, name, logo, symbol, total, official } = await readJson(req);
          if (!setId) return sendJson(res, 400, { error: 'setId' });
          if (total == null || official == null || !logo) {
            // created automatically from a card: take the details from the set itself
            const set = await tcg.setWithCards(String(setId)).catch(() => null);
            if (set) { name = set.name; logo = logo || set.logo; symbol = symbol || set.symbol; total = set.total; official = set.official; }
          }
          const list = readJsonFile(pokedexFile, []);
          if (!list.some(d => d.setId === setId)) list.push({ setId: String(setId), name: String(name || setId), logo: String(logo || ''), symbol: String(symbol || ''), total: total ?? null, official: official ?? null, createdAt: new Date().toISOString() });
          writeJsonFile(pokedexFile, list);
          return sendJson(res, 200, list);
        }
        if (p.startsWith('/api/pokedex/') && req.method === 'DELETE') {
          const setId = decodeURIComponent(p.slice('/api/pokedex/'.length));
          const list = readJsonFile(pokedexFile, []).filter(d => d.setId !== setId);
          writeJsonFile(pokedexFile, list);
          return sendJson(res, 200, list);
        }

        if (p === '/api/tcg/all-cards') return sendJson(res, 200, await tcg.allCards());

        // --- visual index (fingerprints of all card images, built once on this computer) ---
        if (p === '/api/visual-index/meta') {
          let entries = [];
          try { entries = JSON.parse(fs.readFileSync(indexMetaFile, 'utf8')).entries || []; } catch {}
          let binLen = 0;
          try { binLen = fs.statSync(indexBinFile).size; } catch {}
          const n = Math.min(entries.length, Math.floor(binLen / INDEX_DESC));
          return sendJson(res, 200, { entries: entries.slice(0, n) });
        }
        if (p === '/api/visual-index/bin') {
          res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store' });
          try { res.end(fs.readFileSync(indexBinFile)); } catch { res.end(); }
          return;
        }
        if (p === '/api/visual-index/append' && req.method === 'POST') {
          const { entries, data } = await readJson(req, 64 * 1024 * 1024);
          const bin = Buffer.from(String(data || ''), 'base64');
          if (!Array.isArray(entries) || bin.length !== entries.length * INDEX_DESC) return sendJson(res, 400, { error: 'size' });
          let meta = { entries: [] };
          try { meta = JSON.parse(fs.readFileSync(indexMetaFile, 'utf8')); } catch {}
          let binLen = 0;
          try { binLen = fs.statSync(indexBinFile).size; } catch {}
          // keep both files in step (drop a half-written tail)
          const n = Math.min(meta.entries.length, Math.floor(binLen / INDEX_DESC));
          if (binLen !== n * INDEX_DESC) fs.truncateSync(indexBinFile, n * INDEX_DESC);
          meta.entries = meta.entries.slice(0, n).concat(entries);
          fs.appendFileSync(indexBinFile, bin);
          const tmp = indexMetaFile + '.tmp';
          fs.writeFileSync(tmp, JSON.stringify(meta));
          fs.renameSync(tmp, indexMetaFile);
          return sendJson(res, 200, { ok: true, total: meta.entries.length });
        }

        if (p === '/api/rate') {
          return sendJson(res, 200, { eurPln: await tcg.eurPln() });
        }
        if (p === '/api/img') {
          // image proxy so the app can compare card images pixel by pixel
          const target = url.searchParams.get('u') || '';
          if (!(process.env.TCGDEX_ASSETS ? target.startsWith(process.env.TCGDEX_ASSETS) : /^https:\/\/assets\.tcgdex\.net\//.test(target))) return sendJson(res, 400, { error: 'bad_url' });
          const r = await fetch(target);
          if (!r.ok) return sendJson(res, r.status, { error: 'img' });
          res.writeHead(200, { 'Content-Type': r.headers.get('content-type') || 'image/png', 'Cache-Control': 'max-age=86400' });
          res.end(Buffer.from(await r.arrayBuffer()));
          return;
        }

        // --- marketplaces ---
        if (p.startsWith('/api/prices/')) {
          if (!opts.prices) return sendJson(res, 501, { error: 'desktop_only' });
          const source = p.slice('/api/prices/'.length);
          const q = {
            query: url.searchParams.get('q') || '',
            mustWords: (url.searchParams.get('must') || '').split(/\s+/).filter(Boolean),
            number: url.searchParams.get('number') || '',
          };
          return sendJson(res, 200, await lookupPrice(source, q));
        }
        if (p === '/api/market/open' && req.method === 'POST') {
          const { source, query } = await readJson(req);
          if (opts.prices) opts.prices.showMarketWindow(source, query);
          return sendJson(res, 200, { ok: !!opts.prices });
        }
        if (p === '/api/open' && req.method === 'POST') {
          const { url: target } = await readJson(req);
          if (/^https:\/\//.test(target) && opts.onOpenExternal) opts.onOpenExternal(target);
          return sendJson(res, 200, { ok: true });
        }

        // --- collection ---
        if (p === '/api/collection') {
          if (req.method === 'GET') return sendJson(res, 200, readCollection());
          if (req.method === 'POST') {
            const item = await readJson(req);
            const list = readCollection();
            item.uid = item.uid || crypto.randomBytes(8).toString('hex');
            item.addedAt = item.addedAt || new Date().toISOString();
            list.push(item);
            writeCollection(list);
            return sendJson(res, 200, item);
          }
        }
        if (p.startsWith('/api/collection/')) {
          const uid = decodeURIComponent(p.slice('/api/collection/'.length));
          const list = readCollection();
          const i = list.findIndex(x => x.uid === uid);
          if (i < 0) return sendJson(res, 404, { error: 'not_found' });
          if (req.method === 'DELETE') { list.splice(i, 1); writeCollection(list); return sendJson(res, 200, { ok: true }); }
          if (req.method === 'PATCH') { Object.assign(list[i], await readJson(req), { uid }); writeCollection(list); return sendJson(res, 200, list[i]); }
        }
        if (p === '/api/collection-import' && req.method === 'POST') {
          const items = await readJson(req, 20 * 1024 * 1024);
          if (!Array.isArray(items)) return sendJson(res, 400, { error: 'bad_format' });
          const list = readCollection();
          for (const it of items) list.push({ ...it, uid: crypto.randomBytes(8).toString('hex') });
          writeCollection(list);
          return sendJson(res, 200, { ok: true, count: items.length });
        }
        return sendJson(res, 404, { error: 'not_found' });
      }

      // ===== desktop UI =====
      const rel = decodeURIComponent(p).replace(/^\/+/, '') || 'index.html';
      const full = path.join(opts.webDir, rel);
      if (full.startsWith(path.resolve(opts.webDir)) && serveFile(res, full)) return;
      if (!serveFile(res, path.join(opts.webDir, 'index.html'))) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Brak zbudowanego interfejsu (dist/). Uruchom: npm run build');
      }
    } catch (e) {
      log('[server] error', p, e && e.message);
      if (!res.headersSent) sendJson(res, e.status || 502, { error: String(e && e.message) });
      else res.end();
    }
  };
  const server = http.createServer(handler);

  const startHttps = () => new Promise(resolve => {
    try {
      const creds = loadCertificate(dataDir, log);
      const wanted = opts.httpsPort || Number(process.env.POKESCAN_HTTPS_PORT) || port + 1;
      const srv = https.createServer({ key: creds.private, cert: creds.cert }, handler);
      srv.once('error', e => { log('[https] not started:', e.message); resolve(null); });
      srv.listen(wanted, '0.0.0.0', () => { httpsPort = wanted; resolve(srv); });
    } catch (e) { log('[https] not started:', e.message); resolve(null); }
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '0.0.0.0', async () => {
      const secure = await startHttps();
      log(`PokéScan 2: http://localhost:${port} | telefon: ${phoneUrl()}`);
      resolve({ server, secure, port, httpsPort, token, phoneUrl, log });
    });
  });
}

module.exports = { startServer, DEFAULT_PORT };
