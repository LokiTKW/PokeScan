// Reads listing prices from Allegro and Vinted in a built-in browser window,
// the same way you would see them in a normal browser. If the site shows a
// captcha / "are you a robot" page, the window is shown so you can solve it.

const { BrowserWindow } = require('electron');

const SOURCES = {
  allegro: {
    label: 'Allegro',
    url: q => `https://allegro.pl/listing?string=${encodeURIComponent(q)}&order=p`,
  },
  vinted: {
    label: 'Vinted',
    url: q => `https://www.vinted.pl/catalog?search_text=${encodeURIComponent(q)}&order=relevance`,
  },
};

// Runs inside the page. Returns [{ title, price, url }]
const EXTRACT = `(() => {
  const parsePrice = t => {
    const m = String(t || '').replace(/\\u00a0/g, ' ').match(/(\\d{1,3}(?:[ .]\\d{3})*|\\d+)(?:[,.](\\d{1,2}))?\\s*zł/);
    if (!m) return null;
    const v = parseFloat(m[1].replace(/[ .]/g, '') + '.' + (m[2] || '0'));
    return isFinite(v) && v > 0 ? v : null;
  };
  const out = [];
  const host = location.hostname;
  if (host.includes('vinted')) {
    document.querySelectorAll('a[href*="/items/"][title]').forEach(a => {
      const title = a.getAttribute('title') || '';
      const price = parsePrice(title);
      if (price) out.push({ title: title.split(', Marka:')[0].split(', Stan:')[0], price, url: a.href });
    });
  } else {
    document.querySelectorAll('article').forEach(art => {
      const link = art.querySelector('h2 a, a[href*="/oferta/"], a[href*="allegro.pl/"]');
      const title = (art.querySelector('h2') || link || {}).textContent || '';
      // first price in the tile = item price (delivery is listed after it)
      const price = parsePrice(art.innerText);
      if (price && title.trim()) out.push({ title: title.trim(), price, url: link ? link.href : location.href });
    });
  }
  const text = (document.body && document.body.innerText || '').toLowerCase();
  const blocked = out.length === 0 && /captcha|robot|zweryfikuj|verify you are|potwierdź, że|access denied|unusual traffic/.test(text);
  return { items: out.slice(0, 80), blocked, title: document.title };
})()`;

const sleep = ms => new Promise(r => setTimeout(r, ms));

function median(values) {
  const v = [...values].sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

/** Keep listings that mention the card name (and drop obvious lots/boxes/graded slabs). */
function filterItems(items, mustWords, number) {
  const norm = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const words = mustWords.map(norm).filter(w => w.length >= 3);
  const reject = /(\blot\b|zestaw|paczka|booster|etb|elite trainer|\bbox\b|psa ?\d|bgs|cgc|graded|gradowan|proxy|fake|replika|custom|metal|gold card|zlota karta|złota karta|album|koszulk|sleeve)/i;
  const numRe = number ? new RegExp(`\\b0*${number}\\s*/`) : null;
  const scored = items
    .filter(it => words.every(w => norm(it.title).includes(w)))
    .filter(it => !reject.test(it.title))
    .map(it => ({ ...it, exact: numRe ? numRe.test(it.title) : false }));
  const exact = scored.filter(i => i.exact);
  return exact.length >= 2 ? exact : scored;
}

function summarize(items) {
  // Remove extreme outliers (beyond 3x / below 1/3 of the median)
  const m0 = median(items.map(i => i.price));
  const kept = m0 ? items.filter(i => i.price <= m0 * 3 && i.price >= m0 / 3) : items;
  const prices = kept.map(i => i.price);
  return {
    count: kept.length,
    median: median(prices),
    min: prices.length ? Math.min(...prices) : null,
    max: prices.length ? Math.max(...prices) : null,
    items: kept.sort((a, b) => a.price - b.price).slice(0, 12),
  };
}

let marketWin = null;

function getWindow(parent) {
  if (marketWin && !marketWin.isDestroyed()) return marketWin;
  marketWin = new BrowserWindow({
    width: 1100,
    height: 800,
    show: false,
    parent: parent || undefined,
    title: 'PokéScan 2 – sprawdzanie cen',
    autoHideMenuBar: true,
    webPreferences: { partition: 'persist:market', contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
  });
  marketWin.on('close', e => {
    // keep it alive for the next lookup, just hide it
    if (!marketWin.forceClose) { e.preventDefault(); marketWin.hide(); }
  });
  return marketWin;
}

/**
 * @param {'allegro'|'vinted'} source
 * @param {{query: string, mustWords: string[], number?: string|number, parent?: BrowserWindow}} opts
 */
async function lookup(source, opts) {
  const src = SOURCES[source];
  if (!src) throw new Error('unknown source');
  const win = getWindow(opts.parent);
  const url = src.url(opts.query);

  try {
    await win.loadURL(url, { userAgent: win.webContents.getUserAgent().replace(/Electron\/\S+\s?/, '') });
  } catch (e) {
    // navigation errors (e.g. aborted redirects) are fine as long as a page is shown
  }

  let res = { items: [], blocked: false };
  for (let i = 0; i < 8; i++) {
    await sleep(1200);
    try { res = await win.webContents.executeJavaScript(EXTRACT, true); } catch {}
    if (res.items.length || res.blocked) break;
  }

  if (res.blocked) {
    // Let the user pass the check, then read again
    win.show();
    win.focus();
    for (let i = 0; i < 90; i++) {
      await sleep(2000);
      try { res = await win.webContents.executeJavaScript(EXTRACT, true); } catch {}
      if (res.items.length) break;
      if (!win.isVisible()) break;
    }
    win.hide();
  }

  const filtered = filterItems(res.items, opts.mustWords || [], opts.number);
  return { source, label: src.label, url, blocked: !!res.blocked && !res.items.length, raw: res.items.length, ...summarize(filtered) };
}

function showMarketWindow(source, query, parent) {
  const src = SOURCES[source];
  if (!src) return;
  const win = getWindow(parent);
  win.loadURL(src.url(query)).catch(() => {});
  win.show();
}

function destroy() {
  if (marketWin && !marketWin.isDestroyed()) { marketWin.forceClose = true; marketWin.close(); }
}

module.exports = { lookup, showMarketWindow, destroy, filterItems, summarize, median };
