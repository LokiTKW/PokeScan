import { useCallback, useEffect, useState } from 'react';
import { ScanLine, LayoutGrid, BarChart3, CheckCircle2, Images, BookOpen } from 'lucide-react';
import { api } from './api';
import { useScanner } from './useScanner';
import { useVisualIndex } from './useVisualIndex';
import ScanPage from './components/ScanPage';
import CollectionPage, { itemValue } from './components/CollectionPage';
import StatsPage from './components/StatsPage';
import PokedexPage, { dexProgress } from './components/PokedexPage';
import SearchModal from './components/SearchModal';
import { pln } from './pricing';

export default function App() {
  const [page, setPage] = useState('scan');
  const [collection, setCollection] = useState([]);
  const [search, setSearch] = useState(null); // { initial, onPick }
  const [toast, setToast] = useState('');
  const [pokedexes, setPokedexes] = useState([]);
  const [activeDex, setActiveDexState] = useState(() => { try { return localStorage.getItem('pokescan-active-dex') || null; } catch { return null; } });
  const setActiveDex = id => { setActiveDexState(id); try { id ? localStorage.setItem('pokescan-active-dex', id) : localStorage.removeItem('pokescan-active-dex'); } catch {} };
  const scanner = useScanner(pokedexes.some(d => d.setId === activeDex) ? activeDex : null);
  const vindex = useVisualIndex();

  const reload = useCallback(() => api.collection.list().then(setCollection).catch(() => {}), []);
  useEffect(() => {
    (async () => {
      const [list, dexes] = await Promise.all([api.collection.list().catch(() => []), api.pokedex.list().catch(() => [])]);
      setCollection(list);
      setPokedexes(dexes);
      // once: create Pokédexes for the sets already in the collection
      let done = false;
      try { done = localStorage.getItem('pokescan-dex-backfill') === '1'; } catch {}
      if (done) return;
      const have = new Set(dexes.map(d => d.setId));
      const sets = new Map();
      for (const it of list) if (it.set?.id && !have.has(it.set.id)) sets.set(it.set.id, it.set);
      let latest = dexes;
      for (const set of sets.values()) {
        try { latest = await api.pokedex.add({ setId: set.id, name: set.name, logo: set.logo, symbol: set.symbol }); } catch {}
      }
      if (sets.size) setPokedexes(latest);
      try { localStorage.setItem('pokescan-dex-backfill', '1'); } catch {}
    })();
  }, []);
  const onAddDex = async set => setPokedexes(await api.pokedex.add({ setId: set.id, name: set.name, logo: set.logo, symbol: set.symbol, total: set.total, official: set.official }));
  const onRemoveDex = async setId => { setPokedexes(await api.pokedex.remove(setId)); if (activeDex === setId) setActiveDex(null); };
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 2600); return () => clearTimeout(t); }, [toast]);

  const onAdd = async (item) => {
    const existing = collection.find(c => c.cardId === item.cardId && c.condition === item.condition && c.variant === item.variant);
    if (existing) await api.collection.update(existing.uid, { qty: (existing.qty || 1) + 1, prices: item.prices });
    else await api.collection.add(item);
    const list = await api.collection.list().catch(() => null);
    if (list) setCollection(list);
    // every set you collect gets its Pokédex automatically
    let dexes = pokedexes;
    let created = false;
    if (item.set?.id && !dexes.some(d => d.setId === item.set.id)) {
      try { dexes = await api.pokedex.add({ setId: item.set.id, name: item.set.name, logo: item.set.logo, symbol: item.set.symbol }); setPokedexes(dexes); created = true; } catch {}
    }
    const dex = dexes.find(d => d.setId === item.set?.id);
    if (dex && list) {
      const p = dexProgress(dex, list);
      setToast(created ? `${item.name} dodano · nowy Pokédex ${dex.name}: ${p.unique}/${p.all}` : `${item.name} dodano · Pokédex ${dex.name}: ${p.unique}/${p.all}`);
    } else setToast(`${item.name} dodano do kolekcji`);
  };
  const onUpdate = async (uid, patch) => { await api.collection.update(uid, patch); await reload(); };
  const onRemove = async (uid) => { await api.collection.remove(uid); await reload(); };

  const total = collection.reduce((s, it) => s + itemValue(it), 0);
  const count = collection.reduce((s, it) => s + (it.qty || 1), 0);
  const pending = scanner.items.filter(i => i.state === 'queued' || i.state === 'working').length;

  return (
    <>
      <div className="ambient" />
      <div className="grain" />
      <div className="titlebar"><span className="brand">PokéScan 2</span></div>
      <div className="app">
        <aside className="sidebar">
          <div className="logo">
            <div className="logo-mark" />
            <div className="logo-text">PokéScan<small>Skaner i wycena kart</small></div>
          </div>
          <button className={`nav-btn ${page === 'scan' ? 'active' : ''}`} onClick={() => setPage('scan')}>
            <ScanLine size={18} />Skaner{pending > 0 && <span className="badge">{pending}</span>}
          </button>
          <button className={`nav-btn ${page === 'collection' ? 'active' : ''}`} onClick={() => setPage('collection')}>
            <LayoutGrid size={18} />Kolekcja<span className="badge">{count}</span>
          </button>
          <button className={`nav-btn ${page === 'pokedex' ? 'active' : ''}`} onClick={() => setPage('pokedex')}>
            <BookOpen size={18} />Pokédex{pokedexes.length > 0 && <span className="badge">{pokedexes.length}</span>}
          </button>
          <button className={`nav-btn ${page === 'stats' ? 'active' : ''}`} onClick={() => setPage('stats')}>
            <BarChart3 size={18} />Statystyki
          </button>
          <div className="phone-pill"><span className={`dot ${scanner.phoneConnected ? 'on' : ''}`} />{scanner.phoneConnected ? 'Telefon połączony' : 'Telefon niepołączony'}</div>
          {vindex.total > 0 && (
            <div className={`index-pill ${vindex.building ? 'building' : ''}`} title="Odciski obrazów wszystkich kart, dzięki którym karta jest rozpoznawana także bez odczytania tekstu">
              <div className="row"><Images size={14} />{vindex.building ? 'Pobieram bazę obrazów' : 'Baza obrazów gotowa'}<span>{vindex.building ? `${Math.floor((vindex.done / vindex.total) * 100)}%` : vindex.done.toLocaleString('pl-PL')}</span></div>
              {vindex.building && <div className="bar"><i style={{ width: `${(vindex.done / vindex.total) * 100}%` }} /></div>}
              {vindex.building && <div className="hint">Tylko za pierwszym razem. Skaner działa już teraz.</div>}
            </div>
          )}
          {vindex.error && !vindex.total && <div className="index-pill"><div className="row"><Images size={14} />Baza obrazów: brak połączenia</div></div>}
          <div className="sidebar-foot">
            <div className="label">Wartość kolekcji</div>
            <div className="value holo-text">{pln(total, 0)}</div>
            <div className="sub">{count} {count === 1 ? 'karta' : 'kart'}</div>
          </div>
        </aside>
        <main className="main">
          {page === 'scan' && <ScanPage scanner={scanner} onAdd={onAdd} openSearch={(initial, onPick) => setSearch({ initial, onPick })} pokedexes={pokedexes} activeDex={activeDex} setActiveDex={setActiveDex} collection={collection} />}
          {page === 'pokedex' && <PokedexPage collection={collection} pokedexes={pokedexes} onAddDex={onAddDex} onRemoveDex={onRemoveDex} activeDex={activeDex} onScanInto={id => { setActiveDex(id); if (id) setPage('scan'); }} onAdd={onAdd} onUpdate={onUpdate} onRemove={onRemove} />}
          {page === 'collection' && <CollectionPage collection={collection} onUpdate={onUpdate} onRemove={onRemove} goScan={() => setPage('scan')} />}
          {page === 'stats' && <StatsPage collection={collection} />}
        </main>
      </div>
      {search && <SearchModal initial={search.initial} onPick={search.onPick} onClose={() => setSearch(null)} />}
      {toast && <div className="toast"><CheckCircle2 size={18} color="var(--good)" />{toast}</div>}
    </>
  );
}
