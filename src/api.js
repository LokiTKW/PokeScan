const j = async (r) => {
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(data.error || `HTTP ${r.status}`), { status: r.status, data });
  return data;
};

export const api = {
  pairing: () => fetch('/api/pairing').then(j),
  match: (q) => fetch(`/api/tcg/match?${new URLSearchParams(Object.fromEntries(Object.entries(q).filter(([, v]) => v !== undefined && v !== null && v !== '')))}`).then(j),
  search: (q) => fetch(`/api/tcg/search?q=${encodeURIComponent(q)}`).then(j),
  sets: () => fetch('/api/tcg/sets').then(j),
  set: (id) => fetch(`/api/tcg/set/${encodeURIComponent(id)}`).then(j),
  pokedex: {
    list: () => fetch('/api/pokedex').then(j),
    add: (set) => fetch('/api/pokedex', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(set) }).then(j),
    remove: (setId) => fetch(`/api/pokedex/${encodeURIComponent(setId)}`, { method: 'DELETE' }).then(j),
  },
  card: (id) => fetch(`/api/tcg/card/${encodeURIComponent(id)}`).then(j),
  rate: () => fetch('/api/rate').then(j),
  prices: (source, { query, must, number }) =>
    fetch(`/api/prices/${source}?${new URLSearchParams({ q: query, must: must || '', number: number || '' })}`).then(j),
  openMarket: (source, query) => fetch('/api/market/open', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source, query }) }),
  openExternal: (url) => fetch('/api/open', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) }),
  photoStatus: (id, state, text = '') => fetch('/api/photo-status', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, state, text }) }).catch(() => {}),
  log: (msg) => fetch('/api/log', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ msg }) }).catch(() => {}),
  collection: {
    list: () => fetch('/api/collection').then(j),
    add: (item) => fetch('/api/collection', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(item) }).then(j),
    update: (uid, patch) => fetch(`/api/collection/${uid}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) }).then(j),
    remove: (uid) => fetch(`/api/collection/${uid}`, { method: 'DELETE' }).then(j),
  },
  events: (onEvent) => {
    const es = new EventSource('/api/events');
    es.onmessage = (m) => { try { onEvent(JSON.parse(m.data)); } catch {} };
    return () => es.close();
  },
};

export const imgProxy = (url) => (url ? `/api/img?u=${encodeURIComponent(url)}` : '');
