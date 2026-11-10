import { useEffect, useState } from 'react';
import { Search, X } from 'lucide-react';
import { api } from '../api';

export default function SearchModal({ initial = '', onPick, onClose }) {
  const [q, setQ] = useState(initial);
  const [list, setList] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (q.trim().length < 3) { setList(null); return; }
    setLoading(true);
    const t = setTimeout(() => {
      api.search(q.trim()).then(setList).catch(() => setList([])).finally(() => setLoading(false));
    }, 350);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <div className="overlay" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ position: 'relative' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
          <div className="input-wrap" style={{ flex: 1 }}>
            <Search size={16} />
            <input className="input" autoFocus placeholder="Nazwa karty po angielsku, np. Gengar ex" value={q} onChange={e => setQ(e.target.value)} />
          </div>
          <button className="btn btn-ghost" onClick={onClose}><X size={16} /></button>
        </div>
        {loading && <div className="faint" style={{ display: 'flex', gap: 10, alignItems: 'center' }}><span className="spinner" />Szukam…</div>}
        {!loading && list && list.length === 0 && <div className="faint">Nic nie znaleziono. Spróbuj angielskiej nazwy.</div>}
        {!loading && !list && <div className="faint">Wpisz co najmniej 3 litery.</div>}
        {list && list.length > 0 && (
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 14 }}>
            {list.map(c => (
              <div key={c.id} className="alt" style={{ width: 'auto' }} onClick={() => { onPick(c); onClose(); }}>
                <img src={c.image} alt={c.name} style={{ width: '100%', height: 'auto', aspectRatio: '63/88' }} loading="lazy" />
                <span>{c.name} · {c.id}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
