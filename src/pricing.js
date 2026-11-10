export const CONDITIONS = [
  { id: 'NM', label: 'Near Mint', short: 'NM', factor: 1 },
  { id: 'LP', label: 'Lekko grana', short: 'LP', factor: 0.8 },
  { id: 'MP', label: 'Średnio grana', short: 'MP', factor: 0.6 },
  { id: 'HP', label: 'Mocno grana', short: 'HP', factor: 0.4 },
];
export const VARIANTS = [
  { id: 'normal', label: 'Zwykła' },
  { id: 'reverse', label: 'Reverse holo' },
  { id: 'holo', label: 'Holo' },
];

export const pln = (v, digits) => (v == null || !isFinite(v) ? '–' : `${v.toLocaleString('pl-PL', { minimumFractionDigits: digits ?? (v < 100 ? 2 : 0), maximumFractionDigits: digits ?? (v < 100 ? 2 : 0) })} zł`);
export const eur = v => (v == null || !isFinite(v) ? '–' : `${v.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`);

export function cardmarketEur(cm, variant) {
  if (!cm) return null;
  if (variant === 'reverse' && (cm.trendHolo || cm.avgHolo)) return cm.trendHolo || cm.avgHolo;
  return cm.trend || cm.avg30 || cm.avg || cm.avg7 || cm.low || null;
}

export function estimate({ cardmarketPln, allegro, vinted, condition }) {
  const vals = [cardmarketPln, allegro?.count ? allegro.median : null, vinted?.count ? vinted.median : null].filter(v => v != null && isFinite(v));
  if (!vals.length) return null;
  const s = [...vals].sort((a, b) => a - b);
  const mid = s.length === 3 ? s[1] : s.reduce((a, b) => a + b, 0) / s.length;
  const f = (CONDITIONS.find(c => c.id === condition) || CONDITIONS[0]).factor;
  return { value: mid * f, low: s[0] * f, high: s[s.length - 1] * f, sources: vals.length };
}

export function marketQuery(card) {
  const name = card.name.replace(/[’']/g, "'");
  const total = card.set?.total;
  const num = parseInt(card.localId, 10);
  if (total && isFinite(num)) {
    const pad = String(total).length < 3 ? 3 : String(total).length;
    return { query: `${name} ${String(num).padStart(pad, '0')}/${String(total).padStart(pad, '0')}`, must: name.split(/\s+/)[0], number: String(num) };
  }
  return { query: `${name} pokemon`, must: name.split(/\s+/)[0], number: isFinite(num) ? String(num) : '' };
}

export const cardmarketUrl = (card) =>
  card.cardmarket?.idProduct
    ? `https://www.cardmarket.com/pl/Pokemon/Products?idProduct=${card.cardmarket.idProduct}`
    : `https://www.cardmarket.com/pl/Pokemon/Products/Search?searchString=${encodeURIComponent(card.name)}`;
