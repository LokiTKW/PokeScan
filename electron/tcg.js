// Free card database: TCGdex (https://tcgdex.dev) – no key, includes Cardmarket prices.
// Exchange rates EUR→PLN and USD→PLN: NBP (Narodowy Bank Polski) public API.

const API = process.env.TCGDEX_API || 'https://api.tcgdex.net/v2/en';

const cache = new Map(); // url -> { at, data }
const TTL = 6 * 3600 * 1000;

async function getJson(url, ttl = TTL) {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < ttl) return hit.data;
  const r = await fetch(url, { headers: { 'User-Agent': 'PokeScan2/2.0' } });
  if (!r.ok) {
    if (r.status === 404) return null;
    throw new Error(`HTTP ${r.status} ${url}`);
  }
  const data = await r.json();
  cache.set(url, { at: Date.now(), data });
  return data;
}

const toInt = s => {
  const m = String(s ?? '').match(/\d+/);
  return m ? parseInt(m[0], 10) : NaN;
};

function cardImage(base, quality = 'low') {
  return base ? `${base}/${quality}.png` : '';
}

/** All sets (brief), cached for a day. */
async function allSets() {
  return (await getJson(`${API}/sets`, 24 * 3600 * 1000)) || [];
}

async function setDetail(id) {
  return getJson(`${API}/sets/${encodeURIComponent(id)}`, 24 * 3600 * 1000);
}

function briefFromSet(card, set) {
  return {
    id: card.id,
    name: card.name,
    localId: card.localId,
    image: cardImage(card.image, 'low'),
    imageHigh: cardImage(card.image, 'high'),
    set: { id: set.id, name: set.name, total: set.cardCount?.official ?? null, logo: set.logo ? `${set.logo}.png` : '' },
  };
}

/**
 * Find candidate cards by collector number ("104/091") and/or OCR'd name.
 * @param {{number?: number, total?: number, name?: string, setCode?: string}} q
 */
async function matchCards(q) {
  const out = [];
  const seen = new Set();
  const push = c => { if (c && !seen.has(c.id)) { seen.add(c.id); out.push(c); } };

  if (Number.isFinite(q.number) && Number.isFinite(q.total)) {
    const sets = (await allSets()).filter(s => s.cardCount?.official === q.total);
    // Newest sets first (TCGdex lists oldest first)
    sets.reverse();
    const details = await Promise.all(sets.slice(0, 12).map(s => setDetail(s.id).catch(() => null)));
    for (const d of details) {
      if (!d) continue;
      for (const c of d.cards || []) if (toInt(c.localId) === q.number) push(briefFromSet(c, d));
    }
  }

  if (q.name && q.name.length >= 3 && out.length < 3) {
    const list = (await getJson(`${API}/cards?name=${encodeURIComponent(q.name)}`).catch(() => [])) || [];
    const filtered = Number.isFinite(q.number) ? list.filter(c => toInt(c.localId) === q.number) : list;
    for (const c of (filtered.length ? filtered : list).slice(0, 24)) {
      push({ id: c.id, name: c.name, localId: c.localId, image: cardImage(c.image, 'low'), imageHigh: cardImage(c.image, 'high'), set: null });
    }
  }
  return out.slice(0, 30);
}

async function searchByName(name) {
  const list = (await getJson(`${API}/cards?name=${encodeURIComponent(name)}`)) || [];
  return list.slice(0, 60).map(c => ({ id: c.id, name: c.name, localId: c.localId, image: cardImage(c.image, 'low'), imageHigh: cardImage(c.image, 'high'), set: null }));
}

/** Full card with prices. */
async function cardDetail(id) {
  const c = await getJson(`${API}/cards/${encodeURIComponent(id)}`, 3600 * 1000);
  if (!c) return null;
  const cm = c.pricing?.cardmarket || null;
  const tp = c.pricing?.tcgplayer || null;
  return {
    id: c.id,
    name: c.name,
    localId: c.localId,
    image: cardImage(c.image, 'low'),
    imageHigh: cardImage(c.image, 'high'),
    rarity: c.rarity || '',
    hp: c.hp || null,
    types: c.types || [],
    illustrator: c.illustrator || '',
    stage: c.stage || '',
    regulationMark: c.regulationMark || '',
    variants: c.variants || {},
    set: c.set ? {
      id: c.set.id,
      name: c.set.name,
      total: c.set.cardCount?.official ?? null,
      logo: c.set.logo ? `${c.set.logo}.png` : '',
      symbol: c.set.symbol ? `${c.set.symbol}.png` : '',
    } : null,
    cardmarket: cm ? {
      idProduct: cm.idProduct || null,
      updated: cm.updated || null,
      avg: cm.avg ?? null,
      low: cm.low ?? null,
      trend: cm.trend ?? null,
      avg7: cm.avg7 ?? null,
      avg30: cm.avg30 ?? null,
      avgHolo: cm['avg-holo'] ?? null,
      trendHolo: cm['trend-holo'] || null,
      lowHolo: cm['low-holo'] ?? null,
    } : null,
    tcgplayer: tp || null,
  };
}

const rates = {};
async function nbpRate(code, fallback) {
  const hit = rates[code];
  if (hit && Date.now() - hit.at < 6 * 3600 * 1000) return hit.value;
  try {
    const d = await getJson(`https://api.nbp.pl/api/exchangerates/rates/a/${code}/?format=json`, 6 * 3600 * 1000);
    const v = d?.rates?.[0]?.mid;
    if (v) { rates[code] = { value: v, at: Date.now(), date: d.rates[0].effectiveDate }; return v; }
  } catch {}
  return hit?.value || fallback;
}
const eurPln = () => nbpRate('eur', 4.25);
const usdPln = () => nbpRate('usd', 3.65);

/** Every card (brief), for building the visual index. */
async function allCards() {
  const list = (await getJson(`${API}/cards`, 24 * 3600 * 1000)) || [];
  return list.map(c => ({ id: c.id, name: c.name, localId: c.localId, image: c.image || '' }));
}

/** Sets for the Pokédex picker, newest first. */
async function setList() {
  const sets = await allSets();
  return sets.map(s => ({
    id: s.id, name: s.name,
    logo: s.logo ? `${s.logo}.png` : '', symbol: s.symbol ? `${s.symbol}.png` : '',
    official: s.cardCount?.official ?? null, total: s.cardCount?.total ?? null,
  })).reverse();
}

/** One set with all its cards (for a Pokédex). */
async function setWithCards(id) {
  const d = await setDetail(id);
  if (!d) return null;
  return {
    id: d.id, name: d.name, serie: d.serie?.name || '', releaseDate: d.releaseDate || '',
    logo: d.logo ? `${d.logo}.png` : '', symbol: d.symbol ? `${d.symbol}.png` : '',
    official: d.cardCount?.official ?? null, total: d.cardCount?.total ?? (d.cards || []).length,
    cards: (d.cards || []).map(c => ({ id: c.id, localId: c.localId, name: c.name, image: cardImage(c.image, 'low'), imageHigh: cardImage(c.image, 'high') })),
  };
}

module.exports = { matchCards, searchByName, cardDetail, eurPln, usdPln, allSets, allCards, setList, setWithCards };
