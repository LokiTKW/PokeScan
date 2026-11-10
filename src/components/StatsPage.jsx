import { useMemo } from 'react';
import { itemValue } from './CollectionPage';
import { pln } from '../pricing';

export default function StatsPage({ collection }) {
  const bySet = useMemo(() => {
    const m = new Map();
    for (const it of collection) {
      const k = it.set?.name || 'Inne';
      const e = m.get(k) || { name: k, value: 0, count: 0, logo: it.set?.logo };
      e.value += itemValue(it); e.count += it.qty || 1;
      m.set(k, e);
    }
    return [...m.values()].sort((a, b) => b.value - a.value).slice(0, 12);
  }, [collection]);
  const top = useMemo(() => [...collection].sort((a, b) => itemValue(b) - itemValue(a)).slice(0, 10), [collection]);
  const byRarity = useMemo(() => {
    const m = new Map();
    for (const it of collection) m.set(it.rarity || 'Inna', (m.get(it.rarity || 'Inna') || 0) + (it.qty || 1));
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [collection]);
  const maxSet = Math.max(1, ...bySet.map(s => s.value));
  const maxR = Math.max(1, ...byRarity.map(r => r[1]));
  const sources = useMemo(() => {
    let cm = 0, al = 0, vi = 0;
    for (const it of collection) { const q = it.qty || 1; cm += (it.prices?.cardmarketPln || 0) * q; al += (it.prices?.allegro || 0) * q; vi += (it.prices?.vinted || 0) * q; }
    return { cm, al, vi };
  }, [collection]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Statystyki</h1>
          <div className="page-sub">Gdzie jest wartość Twojej kolekcji</div>
        </div>
      </div>
      {collection.length === 0 ? (
        <div className="panel empty-state"><div><h2>Brak danych</h2><p>Dodaj karty do kolekcji, a pojawią się tu wykresy.</p></div></div>
      ) : (
        <>
          <div className="stats-row" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
            <div className="panel stat" style={{ borderTop: '2px solid var(--cm)' }}><div className="label">Wg Cardmarket</div><div className="value">{pln(sources.cm, 0)}</div></div>
            <div className="panel stat" style={{ borderTop: '2px solid var(--allegro)' }}><div className="label">Wg Allegro</div><div className="value">{pln(sources.al, 0)}</div><div className="sub">karty z ofertami</div></div>
            <div className="panel stat" style={{ borderTop: '2px solid var(--vinted)' }}><div className="label">Wg Vinted</div><div className="value">{pln(sources.vi, 0)}</div><div className="sub">karty z ofertami</div></div>
          </div>
          <div className="charts">
            <div className="panel panel-pad">
              <div className="panel-title">Wartość wg setu</div>
              {bySet.map(s => (
                <div key={s.name} className="bar-row">
                  <span className="name" title={s.name}>{s.name} <span className="faint">({s.count})</span></span>
                  <div className="bar"><i style={{ width: `${(s.value / maxSet) * 100}%` }} /></div>
                  <span className="v">{pln(s.value, 0)}</span>
                </div>
              ))}
              <div className="panel-title" style={{ marginTop: 26 }}>Rzadkość</div>
              {byRarity.map(([r, n]) => (
                <div key={r} className="bar-row">
                  <span className="name">{r}</span>
                  <div className="bar"><i style={{ width: `${(n / maxR) * 100}%`, background: 'var(--accent-2)' }} /></div>
                  <span className="v">{n}</span>
                </div>
              ))}
            </div>
            <div className="panel panel-pad">
              <div className="panel-title">Top 10 najcenniejszych</div>
              <div className="top-list">
                {top.map((it, i) => (
                  <div key={it.uid} className="top-item">
                    <span className="rank">{i + 1}</span>
                    <img src={it.image} alt="" />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.name}</div>
                      <div className="faint" style={{ fontSize: 12 }}>{it.set?.name}</div>
                    </div>
                    <b>{pln(itemValue(it))}</b>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}
