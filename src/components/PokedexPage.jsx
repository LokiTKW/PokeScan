import { useEffect, useMemo, useState } from 'react';
import { BookOpen, Plus, Search, X, ArrowLeft, ScanLine, Trash2, Check, Sparkles } from 'lucide-react';
import { api } from '../api';
import HoloCard from './HoloCard';
import CardResult from './CardResult';
import { itemValue } from './CollectionPage';
import { pln } from '../pricing';

const num = s => { const m = String(s ?? '').match(/\d+/); return m ? parseInt(m[0], 10) : NaN; };
export const setIdOf = cardId => String(cardId || '').replace(/-[^-]+$/, '');

/** Owned cards of one set: Map cardId -> {qty, value, items}. */
function ownedIn(collection, setId) {
  const m = new Map();
  for (const it of collection) {
    if (setIdOf(it.cardId) !== setId) continue;
    const o = m.get(it.cardId) || { qty: 0, value: 0, items: [] };
    o.qty += it.qty || 1;
    o.value += itemValue(it);
    o.items.push(it);
    m.set(it.cardId, o);
  }
  return m;
}

/** Progress of a Pokédex: every card of the set counts (secret rares too); the main set is shown separately. */
export function dexProgress(dex, collection) {
  const owned = ownedIn(collection, dex.setId);
  let main = 0, extra = 0, value = 0;
  for (const [, o] of owned) {
    value += o.value;
    if (dex.official && num(o.items[0].localId) > dex.official) extra++; else main++;
  }
  const official = dex.official || dex.total || 0;
  const all = Math.max(dex.total || 0, official, owned.size);
  return { main, extra, unique: owned.size, official, all, value, pct: all ? Math.min(1, owned.size / all) : 0 };
}

function Ring({ pct, size = 64 }) {
  const r = (size - 8) / 2, c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} className="ring">
      <defs><linearGradient id="ringg" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stopColor="#ff6b9d" /><stop offset=".5" stopColor="#6bc5ff" /><stop offset="1" stopColor="#6bffb8" /></linearGradient></defs>
      <circle cx={size / 2} cy={size / 2} r={r} stroke="rgba(255,255,255,.08)" strokeWidth="6" fill="none" />
      <circle cx={size / 2} cy={size / 2} r={r} stroke="url(#ringg)" strokeWidth="6" fill="none" strokeLinecap="round"
        strokeDasharray={`${c * pct} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} style={{ transition: 'stroke-dasharray .6s' }} />
      <text x="50%" y="52%" dominantBaseline="middle" textAnchor="middle" fill="currentColor" fontSize={size / 4.4} fontWeight="800">{Math.floor(pct * 100)}%</text>
    </svg>
  );
}

function SetPicker({ existing, onPick, onClose }) {
  const [sets, setSets] = useState(null);
  const [q, setQ] = useState('');
  const [err, setErr] = useState('');
  useEffect(() => { api.sets().then(setSets).catch(e => setErr(e.message)); }, []);
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (sets || []).filter(x => !s || `${x.name} ${x.id}`.toLowerCase().includes(s)).slice(0, 120);
  }, [sets, q]);
  return (
    <div className="overlay" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ position: 'relative' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
          <div className="input-wrap" style={{ flex: 1 }}>
            <Search size={16} />
            <input className="input" autoFocus placeholder="Nazwa setu po angielsku, np. Paldean Fates" value={q} onChange={e => setQ(e.target.value)} />
          </div>
          <button className="btn btn-ghost" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="faint" style={{ fontSize: 12.5, margin: '0 2 14px', padding: '0 2px 14px' }}>Najnowsze sety są na górze. Jeden Pokédex = jeden set.</div>
        {err && <div className="faint">Nie udało się pobrać listy setów ({err}). Sprawdź internet.</div>}
        {!sets && !err && <div className="faint" style={{ display: 'flex', gap: 10, alignItems: 'center' }}><span className="spinner" />Pobieram listę setów…</div>}
        <div className="set-grid">
          {list.map(s => {
            const has = existing.has(s.id);
            return (
              <button key={s.id} className={`set-opt ${has ? 'has' : ''}`} disabled={has} onClick={() => onPick(s)}>
                <div className="set-logo">{s.logo ? <img src={s.logo} alt="" loading="lazy" /> : s.symbol ? <img src={s.symbol} alt="" loading="lazy" style={{ maxHeight: 34 }} /> : <BookOpen size={26} />}</div>
                <div className="set-name">{s.name}</div>
                <div className="set-meta">{s.official ?? '?'} kart{s.total && s.total !== s.official ? ` (+${s.total - s.official} sekretnych)` : ''} · {s.id}</div>
                {has && <span className="set-has"><Check size={12} /> Masz</span>}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function DexDetail({ dex, collection, onBack, onRemoveDex, onScanInto, activeDex, onAdd, onUpdate, onRemove }) {
  const [set, setSet] = useState(null);
  const [err, setErr] = useState('');
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(null);
  useEffect(() => { setSet(null); api.set(dex.setId).then(setSet).catch(e => setErr(e.message)); }, [dex.setId]);
  const owned = useMemo(() => ownedIn(collection, dex.setId), [collection, dex.setId]);
  const prog = dexProgress(dex, collection);
  const cards = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (set?.cards || [])
      .filter(c => filter === 'all' || (filter === 'have' ? owned.has(c.id) : !owned.has(c.id)))
      .filter(c => !s || `${c.name} ${c.localId}`.toLowerCase().includes(s));
  }, [set, filter, q, owned]);
  const all = set?.cards?.length || dex.total || 0;
  const openCard = open && set?.cards?.find(c => c.id === open);
  const openOwned = open && owned.get(open);
  const scanning = activeDex === dex.setId;

  return (
    <>
      <div className="page-head">
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <button className="btn btn-ghost btn-sm" onClick={onBack}><ArrowLeft size={15} />Pokédexy</button>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className={`btn ${scanning ? 'btn-ghost' : 'btn-holo'}`} onClick={() => onScanInto(scanning ? null : dex.setId)}>
            <ScanLine size={16} />{scanning ? 'Skanujesz do tego Pokédexu' : 'Skanuj do tego Pokédexu'}
          </button>
          <button className="btn btn-ghost" title="Usuń Pokédex (karty zostają w kolekcji)" onClick={() => { if (window.confirm(`Usunąć Pokédex „${dex.name}”? Karty zostaną w kolekcji.`)) onRemoveDex(dex.setId); }}><Trash2 size={16} /></button>
        </div>
      </div>

      <div className="panel dex-hero rise">
        <div className="dex-hero-logo">{dex.logo ? <img src={dex.logo} alt={dex.name} /> : <BookOpen size={40} />}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 className="page-title" style={{ fontSize: 28 }}>{dex.name}</h1>
          <div className="page-sub">{[set?.serie, set?.releaseDate && new Date(set.releaseDate).toLocaleDateString('pl-PL'), `${dex.official ?? '?'} kart w secie`, all > (dex.official || 0) ? `${all - (dex.official || 0)} sekretnych` : ''].filter(Boolean).join(' · ')}</div>
          <div className="dex-bar"><i style={{ width: `${prog.pct * 100}%` }} /></div>
          <div className="dex-nums">
            <span><b>{prog.unique}</b> / {prog.all} kart</span>
            <span>Główny set <b>{prog.main}</b> / {prog.official}</span>
            {prog.all > prog.official && <span><Sparkles size={13} /> Sekretne <b>{prog.extra}</b> / {prog.all - prog.official}</span>}
            <span>Brakuje <b>{Math.max(0, prog.all - prog.unique)}</b></span>
            <span>Wartość <b className="holo-text">{pln(prog.value, 0)}</b></span>
          </div>
        </div>
        <Ring pct={prog.pct} size={96} />
      </div>

      <div className="toolbar">
        <div className="input-wrap">
          <Search size={16} />
          <input className="input" placeholder="Szukaj w secie (nazwa lub numer)…" value={q} onChange={e => setQ(e.target.value)} />
        </div>
        <div className="seg">
          {[['all', `Wszystkie (${all})`], ['have', `Mam (${owned.size})`], ['miss', `Brakuje (${Math.max(0, all - owned.size)})`]].map(([id, l]) => (
            <button key={id} className={filter === id ? 'on' : ''} onClick={() => setFilter(id)}>{l}</button>
          ))}
        </div>
      </div>

      {err && <div className="panel" style={{ padding: 20 }}>Nie udało się pobrać kart setu ({err}).</div>}
      {!set && !err && <div className="dex-grid">{Array.from({ length: 12 }, (_, i) => <div key={i} className="skeleton" style={{ aspectRatio: '63/88', borderRadius: 12 }} />)}</div>}
      {set && (
        <div className="dex-grid">
          {cards.map((c, i) => {
            const o = owned.get(c.id);
            const secret = dex.official && num(c.localId) > dex.official;
            return (
              <div key={c.id} className={`dex-card ${o ? 'have' : 'miss'}`} style={{ animationDelay: `${Math.min(i, 30) * 15}ms` }} onClick={() => setOpen(c.id)} title={`${c.name} · ${c.localId}`}>
                {o ? <HoloCard src={c.image} alt={c.name}>{o.qty > 1 && <span className="qty">×{o.qty}</span>}</HoloCard>
                  : <div className="dex-miss"><img src={c.image} alt={c.name} loading="lazy" /></div>}
                <div className="dex-cap"><span className="no">#{c.localId}</span><span className="nm">{c.name}</span>{secret && <Sparkles size={11} />}</div>
              </div>
            );
          })}
          {!cards.length && <div className="faint" style={{ padding: 20 }}>Brak kart dla tego filtra.</div>}
        </div>
      )}

      {openCard && (
        <div className="overlay" onMouseDown={e => e.target === e.currentTarget && setOpen(null)}>
          <div className="drawer">
            <button className="close-x" onClick={() => setOpen(null)}><X size={18} /></button>
            <div style={{ padding: '10px 18px 30px' }}>
              {openOwned ? (
                <CardResult compact cardId={openCard.id} item={openOwned.items[0]}
                  onUpdateItem={patch => onUpdate(openOwned.items[0].uid, patch)}
                  onRemove={() => { if (window.confirm(`Usunąć ${openCard.name} z kolekcji?`)) { onRemove(openOwned.items[0].uid); setOpen(null); } }} />
              ) : (
                <CardResult compact cardId={openCard.id} onAdd={onAdd} />
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default function PokedexPage({ collection, pokedexes, onAddDex, onRemoveDex, activeDex, onScanInto, onAdd, onUpdate, onRemove }) {
  const [picker, setPicker] = useState(false);
  const [openDex, setOpenDex] = useState(null);
  const dex = pokedexes.find(d => d.setId === openDex);

  if (dex) {
    return <DexDetail dex={dex} collection={collection} activeDex={activeDex} onScanInto={onScanInto} onBack={() => setOpenDex(null)}
      onRemoveDex={id => { onRemoveDex(id); setOpenDex(null); }} onAdd={onAdd} onUpdate={onUpdate} onRemove={onRemove} />;
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Pokédex</h1>
          <div className="page-sub">Każdy Pokédex to jeden set. Tworzy się sam, gdy dodasz do kolekcji kartę z nowego setu.</div>
        </div>
        <button className="btn btn-holo" onClick={() => setPicker(true)}><Plus size={16} />Nowy Pokédex</button>
      </div>

      {pokedexes.length === 0 ? (
        <div className="panel empty-state">
          <div>
            <div className="ghost-card"><BookOpen size={40} /></div>
            <h2>Nie masz jeszcze Pokédexu</h2>
            <p>Wybierz set, który zbierasz, np. najnowszy dodatek. Zobaczysz wszystkie jego karty, te które masz i te, których brakuje.</p>
            <div className="actions" style={{ justifyContent: 'center' }}><button className="btn btn-holo" onClick={() => setPicker(true)}><Plus size={16} />Wybierz set</button></div>
          </div>
        </div>
      ) : (
        <div className="dex-list">
          {pokedexes.map((d, i) => {
            const p = dexProgress(d, collection);
            return (
              <div key={d.setId} className={`panel dex-tile rise ${activeDex === d.setId ? 'active' : ''}`} style={{ animationDelay: `${i * 40}ms` }} onClick={() => setOpenDex(d.setId)}>
                <div className="dex-tile-top">
                  <div className="dex-tile-logo">{d.logo ? <img src={d.logo} alt="" /> : <BookOpen size={30} />}</div>
                  <Ring pct={p.pct} size={58} />
                </div>
                <div className="dex-tile-name">{d.name}</div>
                <div className="dex-bar"><i style={{ width: `${p.pct * 100}%` }} /></div>
                <div className="dex-tile-meta">
                  <span><b>{p.unique}</b> / {p.all} kart</span>
                  <span className="holo-text" style={{ fontWeight: 800 }}>{pln(p.value, 0)}</span>
                </div>
                {activeDex === d.setId && <div className="dex-active"><ScanLine size={12} /> Skanujesz do tego Pokédexu</div>}
              </div>
            );
          })}
          <button className="panel dex-tile dex-new" onClick={() => setPicker(true)}><Plus size={26} /><span>Nowy Pokédex</span></button>
        </div>
      )}

      {picker && <SetPicker existing={new Set(pokedexes.map(d => d.setId))} onClose={() => setPicker(false)} onPick={s => { onAddDex(s); setPicker(false); setOpenDex(s.id); }} />}
    </>
  );
}
