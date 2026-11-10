import { useEffect, useMemo, useState } from 'react';
import { ExternalLink, Plus, Check, RefreshCw, Search, ShieldAlert, Sparkles, Eye } from 'lucide-react';
import HoloCard from './HoloCard';
import { api } from '../api';
import { CONDITIONS, VARIANTS, cardmarketEur, cardmarketUrl, estimate, eur, marketQuery, pln } from '../pricing';

const SRC = {
  cardmarket: { label: 'Cardmarket', c: 'var(--cm)' },
  allegro: { label: 'Allegro', c: 'var(--allegro)' },
  vinted: { label: 'Vinted', c: 'var(--vinted)' },
};

/** Loads full card data, exchange rate and marketplace prices. */
export function usePricing(cardId, { auto = true } = {}) {
  const [card, setCard] = useState(null);
  const [rate, setRate] = useState(4.25);
  const [market, setMarket] = useState({ allegro: { loading: true }, vinted: { loading: true } });
  const [error, setError] = useState('');
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!cardId) return;
    let dead = false;
    setCard(null); setError('');
    setMarket({ allegro: { loading: true }, vinted: { loading: true } });
    (async () => {
      try {
        const [c, r] = await Promise.all([api.card(cardId), api.rate().catch(() => ({ eurPln: 4.25 }))]);
        if (dead) return;
        setCard(c); setRate(r.eurPln);
        if (!auto) { setMarket({ allegro: { idle: true }, vinted: { idle: true } }); return; }
        const q = marketQuery(c);
        for (const source of ['allegro', 'vinted']) {
          (async () => {
            try {
              let res = await api.prices(source, q);
              if (!res.count && !res.blocked) {
                const loose = await api.prices(source, { query: `${c.name} pokemon karta`, must: q.must, number: q.number });
                if (loose.count) res = { ...loose, loose: true };
              }
              if (!dead) setMarket(m => ({ ...m, [source]: res }));
            } catch (e) {
              if (!dead) setMarket(m => ({ ...m, [source]: { error: e.status === 501 ? 'desktop' : 'error' } }));
            }
          })();
        }
      } catch (e) {
        if (!dead) setError(e.status === 404 ? 'Nie znaleziono karty w bazie.' : 'Brak połączenia z bazą kart. Sprawdź internet.');
      }
    })();
    return () => { dead = true; };
  }, [cardId, nonce, auto]);

  return { card, rate, market, error, reload: () => setNonce(n => n + 1) };
}

function SourceTile({ id, value, sub, count, range, loading, note, onOpen, children }) {
  const s = SRC[id];
  const pos = range && range.max > range.min && value != null ? ((value - range.min) / (range.max - range.min)) * 100 : 50;
  return (
    <div className="source" style={{ '--c': s.c }}>
      <div className="head">
        <span className="name"><i />{s.label}</span>
        {onOpen && <button className="btn btn-ghost btn-sm" onClick={onOpen} title="Otwórz wyniki"><ExternalLink size={13} /></button>}
      </div>
      {loading ? (
        <>
          <div className="skeleton" style={{ height: 28, width: '60%', marginTop: 14 }} />
          <div className="sub" style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}><span className="spinner" />{note || 'Sprawdzam oferty…'}</div>
        </>
      ) : (
        <>
          <div className="val">{value != null ? pln(value) : '–'}</div>
          <div className="sub">{sub}</div>
          {range && range.max > range.min && (
            <>
              <div className="rangebar"><i style={{ left: `${pos}%` }} /></div>
              <div className="sub" style={{ display: 'flex', justifyContent: 'space-between' }}><span>{pln(range.min)}</span><span>{pln(range.max)}</span></div>
            </>
          )}
          {children}
          {count != null && <div className="foot"><span className="chip">{count} {count === 1 ? 'oferta' : count < 5 ? 'oferty' : 'ofert'}</span></div>}
        </>
      )}
    </div>
  );
}

export default function CardResult({ cardId, photoUrl, confidence, alternatives = [], onPick, onSearch, onAdd, item, onUpdateItem, onRemove, compact }) {
  const { card, rate, market, error, reload } = usePricing(cardId);
  const [condition, setCondition] = useState(item?.condition || 'NM');
  const [variant, setVariant] = useState(item?.variant || 'normal');
  const [added, setAdded] = useState(false);
  const [showPhoto, setShowPhoto] = useState(false);

  useEffect(() => { setAdded(false); }, [cardId]);

  const cmEur = card ? cardmarketEur(card.cardmarket, variant) : null;
  const cmPln = cmEur != null ? cmEur * rate : null;
  const est = useMemo(() => estimate({ cardmarketPln: cmPln, allegro: market.allegro, vinted: market.vinted, condition }), [cmPln, market, condition]);
  const q = card ? marketQuery(card) : null;
  const offers = useMemo(() => [
    ...(market.allegro?.items || []).map(o => ({ ...o, src: 'allegro' })),
    ...(market.vinted?.items || []).map(o => ({ ...o, src: 'vinted' })),
  ].sort((a, b) => a.price - b.price).slice(0, 8), [market]);

  if (error) {
    return (
      <div className="empty-state"><div><ShieldAlert size={36} className="faint" /><h2 style={{ marginTop: 12 }}>{error}</h2>
        <div className="actions" style={{ justifyContent: 'center' }}><button className="btn btn-ghost" onClick={reload}><RefreshCw size={15} />Spróbuj ponownie</button></div></div></div>
    );
  }

  const marketTile = (id) => {
    const m = market[id] || {};
    if (m.loading) return <SourceTile id={id} loading note="Czytam oferty…" />;
    if (m.idle) return <SourceTile id={id} value={null} sub="Kliknij odśwież, aby sprawdzić" />;
    if (m.error) return <SourceTile id={id} value={null} sub={m.error === 'desktop' ? 'Działa tylko w aplikacji na PC' : 'Nie udało się odczytać ofert'} onOpen={() => api.openMarket(id, q.query)} />;
    if (m.blocked) return <SourceTile id={id} value={null} sub="Strona poprosiła o weryfikację. Kliknij ikonę, potwierdź i odśwież." onOpen={() => api.openMarket(id, q.query)} />;
    return (
      <SourceTile id={id} value={m.median} count={m.count} range={m.count > 1 ? { min: m.min, max: m.max } : null}
        sub={m.count ? `mediana ofert${m.loose ? ' (wyszukiwanie przybliżone)' : ''}` : 'Brak pasujących ofert'}
        onOpen={() => api.openMarket(id, (m.loose ? `${card.name} pokemon karta` : q.query))} />
    );
  };

  const save = async () => {
    const snapshot = {
      cardId: card.id, name: card.name, localId: card.localId, image: card.image, imageHigh: card.imageHigh,
      set: card.set, rarity: card.rarity, condition, variant,
      prices: { cardmarketEur: cmEur, cardmarketPln: cmPln, allegro: market.allegro?.median ?? null, vinted: market.vinted?.median ?? null, estimate: est?.value ?? null, at: new Date().toISOString(), rate },
      qty: 1,
    };
    if (item) await onUpdateItem?.({ condition, variant, prices: snapshot.prices });
    else { await onAdd?.(snapshot); setAdded(true); }
  };

  return (
    <div className={`result rise ${compact ? '' : 'panel'}`}>
      <div className="result-left">
        {card ? <HoloCard src={card.imageHigh} alt={card.name} width={300} glow /> : <div style={{ width: 300 }}><div className="skeleton" style={{ aspectRatio: '63/88' }} /></div>}
        {photoUrl && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
            {confidence != null && (
              <div className="confidence">
                Pewność
                <div className="meter"><i style={{ width: `${Math.round(confidence * 100)}%`, background: confidence > 0.7 ? 'var(--good)' : confidence > 0.45 ? 'var(--warn)' : 'var(--bad)' }} /></div>
                <b style={{ color: 'var(--text)' }}>{Math.round(confidence * 100)}%</b>
              </div>
            )}
            {confidence != null && confidence < 0.45 && alternatives.length > 0 && (
              <div className="faint" style={{ fontSize: 12, maxWidth: 220, textAlign: 'center', lineHeight: 1.45 }}>Niepewne. Porównaj ze zdjęciem i w razie potrzeby wybierz właściwą kartę z listy poniżej.</div>
            )}
            <button className="btn btn-ghost btn-sm" onClick={() => setShowPhoto(v => !v)}><Eye size={13} />{showPhoto ? 'Ukryj' : 'Pokaż'} Twoje zdjęcie</button>
            {showPhoto && <img src={photoUrl} alt="" style={{ width: 160, borderRadius: 8 }} />}
          </div>
        )}
      </div>

      <div style={{ minWidth: 0 }}>
        {card ? (
          <>
            <h1 className="result-name">{card.name}</h1>
            <div className="set-row">
              {card.set?.logo && <img src={card.set.logo} alt="" onError={e => { e.currentTarget.style.display = 'none'; }} />}
              <span><b style={{ color: 'var(--text)' }}>{card.set?.name}</b> · #{card.localId}{card.set?.total ? `/${card.set.total}` : ''}</span>
            </div>
            <div className="result-meta">
              {card.rarity && <span className="chip"><Sparkles size={12} />{card.rarity}</span>}
              {card.hp && <span className="chip">{card.hp} HP</span>}
              {card.types?.map(t => <span key={t} className="chip">{t}</span>)}
              {card.illustrator && <span className="chip">il. {card.illustrator}</span>}
            </div>
          </>
        ) : (
          <><div className="skeleton" style={{ height: 38, width: '55%' }} /><div className="skeleton" style={{ height: 18, width: '35%', marginTop: 14 }} /></>
        )}

        <div className="estimate">
          <div className="shine" />
          <div className="label">Szacowana wartość</div>
          {est ? (
            <>
              <div className="big holo-text">{pln(est.value)}</div>
              <div className="range">
                {est.sources > 1 ? <>zakres {pln(est.low)} – {pln(est.high)} · z {est.sources} źródeł</> : 'z 1 źródła'}
                {condition !== 'NM' && <> · stan {condition}</>}
              </div>
            </>
          ) : (
            <div className="big" style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 20, color: 'var(--text-2)' }}>
              {card && (market.allegro?.loading || market.vinted?.loading) ? <><span className="spinner" />Liczę wartość…</> : card ? 'Brak cen dla tej karty' : <span className="spinner" />}
            </div>
          )}
        </div>

        <div className="sources">
          {card ? (
            <SourceTile id="cardmarket" value={cmPln} sub={cmEur != null ? `${variant === 'reverse' && card.cardmarket?.trendHolo ? 'trend reverse' : 'trend'} ${eur(cmEur)} · kurs NBP ${rate.toFixed(2)}` : 'Brak ceny w bazie'}
              range={card.cardmarket?.low != null && card.cardmarket?.avg30 != null ? { min: Math.min(card.cardmarket.low, cmEur ?? 0) * rate, max: Math.max(card.cardmarket.avg30, card.cardmarket.avg ?? 0, cmEur ?? 0) * rate } : null}
              onOpen={() => api.openExternal(cardmarketUrl(card))}>
              {card.cardmarket?.low != null && <div className="sub">od {pln(card.cardmarket.low * rate)} · śr. 30 dni {pln((card.cardmarket.avg30 ?? 0) * rate)}</div>}
            </SourceTile>
          ) : <SourceTile id="cardmarket" loading note="Ładuję…" />}
          {card ? marketTile('allegro') : <SourceTile id="allegro" loading note="Czekam…" />}
          {card ? marketTile('vinted') : <SourceTile id="vinted" loading note="Czekam…" />}
        </div>

        <div className="options-row">
          <div>
            <div className="lbl">Stan karty</div>
            <div className="seg">{CONDITIONS.map(c => <button key={c.id} className={condition === c.id ? 'on' : ''} title={c.label} onClick={() => setCondition(c.id)}>{c.short}</button>)}</div>
          </div>
          <div>
            <div className="lbl">Wersja</div>
            <div className="seg">{VARIANTS.map(v => <button key={v.id} className={variant === v.id ? 'on' : ''} onClick={() => setVariant(v.id)}>{v.label}</button>)}</div>
          </div>
        </div>

        <div className="actions">
          {item ? (
            <>
              <button className="btn btn-primary" onClick={save} disabled={!card}><Check size={16} />Zapisz zmiany i aktualną wycenę</button>
              <button className="btn btn-ghost" onClick={reload}><RefreshCw size={15} />Odśwież ceny</button>
              <button className="btn btn-ghost" style={{ marginLeft: 'auto', color: 'var(--bad)' }} onClick={onRemove}>Usuń z kolekcji</button>
            </>
          ) : (
            <>
              <button className={`btn ${added ? 'btn-ghost' : 'btn-holo'}`} onClick={save} disabled={!card || added}>
                {added ? <><Check size={16} />Dodano do kolekcji</> : <><Plus size={16} />Dodaj do kolekcji</>}
              </button>
              <button className="btn btn-ghost" onClick={reload} disabled={!card}><RefreshCw size={15} />Odśwież ceny</button>
              {onSearch && <button className="btn btn-ghost" onClick={onSearch}><Search size={15} />Wyszukaj ręcznie</button>}
            </>
          )}
        </div>

        {alternatives.length > 0 && (
          <div className="alts">
            <div className="panel-title">Nie ta karta? Wybierz właściwą</div>
            <div className="alts-row">
              {alternatives.map(a => (
                <div key={a.id} className="alt" onClick={() => onPick?.(a)} title={`${a.name} ${a.set?.name || ''}`}>
                  <img src={a.image} alt={a.name} loading="lazy" />
                  <span>{a.set?.name || a.name} · {a.localId}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {offers.length > 0 && (
          <div className="offers">
            <div className="panel-title" style={{ marginTop: 18 }}>Najtańsze pasujące oferty</div>
            {offers.map((o, i) => (
              <div key={i} className="offer" style={{ '--c': SRC[o.src].c }}>
                <span className="src">{SRC[o.src].label}</span>
                <span className="title" title={o.title}>{o.title}</span>
                <span className="price">{pln(o.price)}</span>
                <button onClick={() => api.openExternal(o.url)} title="Otwórz ofertę"><ExternalLink size={14} /></button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
