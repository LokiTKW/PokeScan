import { useMemo, useState } from 'react';
import { Search, X, Layers, TrendingUp, Gem, Library } from 'lucide-react';
import HoloCard from './HoloCard';
import CardResult from './CardResult';
import { pln } from '../pricing';

export const itemValue = it => (it.prices?.estimate ?? it.prices?.cardmarketPln ?? 0) * (it.qty || 1);

export default function CollectionPage({ collection, onUpdate, onRemove, goScan }) {
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('value');
  const [open, setOpen] = useState(null);

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    let l = collection.filter(it => !s || `${it.name} ${it.set?.name || ''} ${it.localId}`.toLowerCase().includes(s));
    if (sort === 'value') l = [...l].sort((a, b) => itemValue(b) - itemValue(a));
    if (sort === 'new') l = [...l].sort((a, b) => (b.addedAt || '').localeCompare(a.addedAt || ''));
    if (sort === 'name') l = [...l].sort((a, b) => a.name.localeCompare(b.name));
    if (sort === 'set') l = [...l].sort((a, b) => (a.set?.name || '').localeCompare(b.set?.name || '') || parseInt(a.localId) - parseInt(b.localId));
    return l;
  }, [collection, q, sort]);

  const total = collection.reduce((s, it) => s + itemValue(it), 0);
  const count = collection.reduce((s, it) => s + (it.qty || 1), 0);
  const sets = new Set(collection.map(it => it.set?.id).filter(Boolean)).size;
  const top = collection.reduce((m, it) => (itemValue(it) > itemValue(m || {}) ? it : m), null);
  const openItem = collection.find(it => it.uid === open);

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Moja kolekcja</h1>
          <div className="page-sub">Wartość wg ostatniej wyceny każdej karty</div>
        </div>
      </div>

      <div className="stats-row">
        <div className="panel stat"><div className="label"><Gem size={12} /> Wartość</div><div className="value holo-text">{pln(total, 0)}</div><div className="sub">szacunkowo</div></div>
        <div className="panel stat"><div className="label"><Library size={12} /> Karty</div><div className="value">{count}</div><div className="sub">{collection.length} pozycji</div></div>
        <div className="panel stat"><div className="label"><Layers size={12} /> Sety</div><div className="value">{sets}</div><div className="sub">różnych rozszerzeń</div></div>
        <div className="panel stat"><div className="label"><TrendingUp size={12} /> Najcenniejsza</div><div className="value" style={{ fontSize: 20, marginTop: 10 }}>{top ? top.name : '–'}</div><div className="sub">{top ? pln(itemValue(top)) : ''}</div></div>
      </div>

      <div className="toolbar">
        <div className="input-wrap">
          <Search size={16} />
          <input className="input" placeholder="Szukaj w kolekcji…" value={q} onChange={e => setQ(e.target.value)} />
        </div>
        <div className="seg">
          {[['value', 'Wartość'], ['new', 'Najnowsze'], ['name', 'Nazwa'], ['set', 'Set']].map(([id, l]) => (
            <button key={id} className={sort === id ? 'on' : ''} onClick={() => setSort(id)}>{l}</button>
          ))}
        </div>
      </div>

      {collection.length === 0 ? (
        <div className="panel empty-state">
          <div>
            <div className="ghost-card"><Library size={40} /></div>
            <h2>Kolekcja jest pusta</h2>
            <p>Zeskanuj pierwszą kartę i kliknij „Dodaj do kolekcji”.</p>
            <div className="actions" style={{ justifyContent: 'center' }}><button className="btn btn-holo" onClick={goScan}>Przejdź do skanera</button></div>
          </div>
        </div>
      ) : (
        <div className="grid">
          {list.map((it, i) => (
            <div key={it.uid} className="tile" style={{ animationDelay: `${Math.min(i, 20) * 25}ms` }} onClick={() => setOpen(it.uid)}>
              <HoloCard src={it.image} alt={it.name}>{(it.qty || 1) > 1 && <span className="qty">×{it.qty}</span>}</HoloCard>
              <div className="tile-info">
                <div style={{ minWidth: 0 }}>
                  <div className="tile-name">{it.name}</div>
                  <div className="tile-set">{it.set?.name} · {it.localId} · {it.condition}</div>
                </div>
                <div className="tile-price">{pln(itemValue(it))}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {openItem && (
        <div className="overlay" onMouseDown={e => e.target === e.currentTarget && setOpen(null)}>
          <div className="drawer">
            <button className="close-x" onClick={() => setOpen(null)}><X size={18} /></button>
            <div style={{ padding: '10px 18px 30px' }}>
              <CardResult
                compact
                cardId={openItem.cardId}
                item={openItem}
                onUpdateItem={patch => onUpdate(openItem.uid, patch)}
                onRemove={() => { if (window.confirm(`Usunąć ${openItem.name} z kolekcji?`)) { onRemove(openItem.uid); setOpen(null); } }}
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '0 26px' }}>
                <span className="faint">Ilość</span>
                <div className="seg">
                  <button onClick={() => onUpdate(openItem.uid, { qty: Math.max(1, (openItem.qty || 1) - 1) })}>−</button>
                  <button className="on">{openItem.qty || 1}</button>
                  <button onClick={() => onUpdate(openItem.uid, { qty: (openItem.qty || 1) + 1 })}>+</button>
                </div>
                <span className="faint" style={{ marginLeft: 'auto', fontSize: 12 }}>Dodano {new Date(openItem.addedAt).toLocaleDateString('pl-PL')} · wycena z {openItem.prices?.at ? new Date(openItem.prices.at).toLocaleDateString('pl-PL') : '–'}</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
