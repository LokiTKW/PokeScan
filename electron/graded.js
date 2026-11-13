// Raw and graded card prices from PriceCharting (https://www.pricecharting.com).
// PriceCharting publishes, for free, market prices calculated from completed eBay sales:
// ungraded, generic grades 1–10 and the "10" price for each grading company.
// We read the public product page (no account, no key) and cache it for a few hours.

const BASE = (process.env.PRICECHARTING_URL || 'https://www.pricecharting.com').replace(/\/$/, '');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const TTL = 6 * 3600 * 1000;

/** The five grading companies shown in the app, most popular first. */
const COMPANIES = [
  { id: 'PSA', label: 'PSA', full: 'Professional Sports Authenticator', top: 'PSA 10' },
  { id: 'BGS', label: 'BGS', full: 'Beckett Grading Services', top: 'BGS 10', best: 'BGS 10 Black' },
  { id: 'CGC', label: 'CGC', full: 'Certified Guaranty Company', top: 'CGC 10', best: 'CGC 10 Pristine' },
  { id: 'SGC', label: 'SGC', full: 'Sportscard Guaranty', top: 'SGC 10' },
  { id: 'TAG', label: 'TAG', full: 'Technical Authentication & Grading', top: 'TAG 10' },
];

const cache = new Map(); // key -> { at, data }

const decode = s => String(s || '')
  .replace(/<[^>]*>/g, ' ')
  .replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
  .replace(/\s+/g, ' ').trim();

const norm = s => decode(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’']/g, "'");
const words = s => norm(s).split(/[^a-z0-9']+/).filter(w => (w.length > 1 || /^\d$/.test(w)) && !['pokemon', 'the', 'and', 'of'].includes(w));

const parseUsd = s => {
  const m = String(s || '').replace(/,/g, '').match(/\$\s*(\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[1]) : null;
};

/** Card number as PriceCharting writes it: "004" -> "4", "TG05" stays. */
const pcNumber = n => {
  const s = String(n ?? '').trim();
  return /^\d+$/.test(s) ? String(parseInt(s, 10)) : s.toUpperCase();
};

/** Rows of the search results table: [{ url, title, number, console }] */
function parseSearch(html) {
  const rows = [];
  const re = /<tr[^>]*id="product-\d+"[^>]*>([\s\S]*?)<\/tr>/g;
  let m;
  while ((m = re.exec(html))) {
    const row = m[1];
    const t = row.match(/<td class="title">\s*<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!t) continue;
    const consoleName = decode((row.match(/<td class="console[^"]*">([\s\S]*?)<\/td>/) || [])[1]);
    const title = decode(t[2]);
    rows.push({ url: t[1].startsWith('http') ? t[1] : BASE + t[1], title, number: (title.match(/#\s*([A-Za-z]*\d+[A-Za-z]*)\s*$/) || [])[1] || '', console: consoleName });
  }
  return rows;
}

/** Product page: title, set and the full price guide. */
function parseProduct(html, url) {
  const h1 = (html.match(/<h1[^>]*id="product_name"[^>]*>([\s\S]*?)<\/h1>/) || [])[1] || '';
  const consoleName = decode((h1.match(/<a[^>]*>([\s\S]*?)<\/a>/) || [])[1]);
  const title = decode(h1.replace(/<a[\s\S]*<\/a>/, ''));
  const guide = (html.match(/<div id="full-prices">([\s\S]*?)<\/table>/) || [])[1] || '';
  const prices = {};
  const re = /<tr>\s*<td>([^<]+)<\/td>\s*<td class="price[^"]*">([^<]*)<\/td>/g;
  let m;
  while ((m = re.exec(guide))) prices[decode(m[1])] = parseUsd(m[2]);
  return { url, title, console: consoleName, number: (title.match(/#\s*([A-Za-z]*\d+[A-Za-z]*)\s*$/) || [])[1] || '', prices };
}

/** How well a PriceCharting row fits the card (higher is better, -1 = not this card). */
function score(row, card) {
  const num = pcNumber(card.number);
  if (num && pcNumber(row.number) !== num) return -1;
  const title = norm(row.title.replace(/#.*$/, ''));
  const nameWords = words(card.name);
  if (nameWords.length && !nameWords.every(w => title.includes(w))) return -1;
  let s = 10;
  const cons = norm(row.console);
  if (/japanese|chinese|korean|thai|indonesian/.test(cons)) s -= 8;
  const setWords = words(card.setName);
  const consWords = words(row.console);
  if (setWords.length) {
    s += 6 * setWords.filter(w => consWords.includes(w)).length / setWords.length;
    s -= 0.5 * consWords.filter(w => !setWords.includes(w)).length; // "Base Set 2" is not "Base Set"
  }
  s -= 1 * words(row.title.replace(/\[[^\]]*\]|#.*$/g, '')).filter(w => !nameWords.includes(w)).length; // "Dark Charizard"
  const variant = (row.title.match(/\[([^\]]+)\]/) || [])[1] || '';
  if (variant) s -= /reverse/i.test(variant) && card.variant === 'reverse' ? -2 : 3;
  return s;
}

/**
 * @param {{ name: string, number?: string, setName?: string, variant?: string, fetchHtml?: (url: string) => Promise<{url: string, html: string}> }} card
 */
async function lookup(card) {
  const key = [card.name, card.number, card.setName, card.variant].join('|');
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return { ...hit.data, cached: true };

  const get = async target => {
    let problem;
    try {
      const r = await fetch(target, { headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9', Accept: 'text/html' }, redirect: 'follow' });
      const html = await r.text();
      if (r.ok && /id="(?:games_table|product_name|full-prices)"|search-products/.test(html)) return { url: r.url || target, html };
      problem = new Error(`HTTP ${r.status}`);
    } catch (e) {
      problem = e;
    }
    if (!card.fetchHtml) throw problem;
    // refused for plain requests: read it in the built-in browser window instead
    return card.fetchHtml(target);
  };

  const num = pcNumber(card.number);
  const queries = [...new Set([
    `${card.name} ${num} ${card.setName || ''}`.trim(),
    `${card.name} ${num}`.trim(),
  ])];

  let best = null;
  for (const q of queries) {
    const searchUrl = `${BASE}/search-products?q=${encodeURIComponent(q)}&type=prices`;
    const page = await get(searchUrl);
    if (/\/game\//.test(page.url) || /id="product_name"/.test(page.html) && !/id="games_table"/.test(page.html)) {
      // a single hit opens the product page directly
      const product = parseProduct(page.html, page.url);
      const s = score(product, card);
      if (s >= 0 && (!best || s > best.s)) best = { s, url: page.url, product };
    } else {
      for (const row of parseSearch(page.html)) {
        const s = score(row, card);
        if (s >= 0 && (!best || s > best.s)) best = { s, url: row.url };
      }
    }
    if (best && best.s >= 15) break; // confident set match
  }

  let data;
  if (!best) {
    data = { found: false, searchUrl: `${BASE}/search-products?q=${encodeURIComponent(queries[queries.length - 1])}&type=prices` };
  } else {
    const product = best.product || parseProduct((await get(best.url)).html, best.url);
    const p = product.prices;
    data = {
      found: true,
      url: product.url,
      title: product.title,
      set: product.console,
      setMatch: best.s >= 14,
      currency: 'USD',
      raw: p['Ungraded'] ?? null,
      grades: { 7: p['Grade 7'] ?? null, 8: p['Grade 8'] ?? null, 9: p['Grade 9'] ?? null, 9.5: p['Grade 9.5'] ?? null },
      companies: COMPANIES.map(c => ({ id: c.id, label: c.label, full: c.full, ten: p[c.top] ?? null, best: c.best ? { label: c.best, value: p[c.best] ?? null } : null })),
    };
  }
  cache.set(key, { at: Date.now(), data });
  return data;
}

module.exports = { lookup, parseSearch, parseProduct, score, pcNumber, COMPANIES };
