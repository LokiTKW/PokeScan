import { useRef, useState } from 'react';
import { Smartphone, ImagePlus, CheckCircle2, Loader2, AlertTriangle, ScanLine, Wifi, BookOpen, Sparkles } from 'lucide-react';
import CardResult from './CardResult';
import { setIdOf, dexProgress } from './PokedexPage';

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

function QueueIcon({ state }) {
  if (state === 'done') return <CheckCircle2 size={16} color="var(--good)" />;
  if (state === 'failed') return <AlertTriangle size={16} color="var(--warn)" />;
  if (state === 'working') return <span className="spinner" />;
  return <Loader2 size={16} className="faint" />;
}

export default function ScanPage({ scanner, onAdd, openSearch, pokedexes = [], activeDex, setActiveDex, collection = [] }) {
  const { items, selected, setSelected, pairing, phoneConnected, enqueue, pick } = scanner;
  const [over, setOver] = useState(false);
  const fileRef = useRef(null);
  const current = items.find(i => i.key === selected);

  const addFiles = async (files) => {
    // copy first: the file input is cleared right after this call, which empties its live FileList
    for (const f of [...files]) if (f.type.startsWith('image/')) enqueue(await fileToDataUrl(f));
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Skaner kart</h1>
          <div className="page-sub">Rób zdjęcia telefonem, a rozpoznanie i wycena pojawią się tutaj. Działa bez AI, kont i opłat.</div>
        </div>
        {pokedexes.length > 0 && (
          <label className="dex-select" title="Skanując do Pokédexu, aplikacja szuka tylko wśród kart tego setu, więc rozpoznaje pewniej">
            <BookOpen size={15} />
            <span>Skanuję do:</span>
            <select value={activeDex || ''} onChange={e => setActiveDex(e.target.value || null)}>
              <option value="">Wszystkie karty</option>
              {pokedexes.map(d => <option key={d.setId} value={d.setId}>Pokédex: {d.name}</option>)}
            </select>
          </label>
        )}
      </div>

      <div className="scan-grid">
        <div>
          {phoneConnected ? (
            <div className="panel connected-banner rise">
              <div className="icon"><Smartphone size={22} /></div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700 }}>Telefon połączony</div>
                <div className="faint" style={{ fontSize: 12.5, marginTop: 2 }}>Rób zdjęcia, karty trafią prosto tutaj</div>
              </div>
              <span className="dot on" />
            </div>
          ) : (
            <div className="panel connect rise">
              <div className="qr-frame">
                {pairing ? <img src={pairing.qr} alt="Kod QR" /> : <div className="skeleton" style={{ width: '100%', height: '100%' }} />}
                <span className="corner c1" /><span className="corner c2" /><span className="corner c3" /><span className="corner c4" />
              </div>
              <h3>Połącz telefon</h3>
              <p>Zeskanuj kod aparatem telefonu. Telefon musi być w tej samej sieci Wi‑Fi.</p>
              <div className="steps">
                <div className="step"><b>1</b>Otwórz aparat w telefonie i nakieruj na kod</div>
                <div className="step"><b>2</b>Stuknij link. Gdy telefon ostrzeże o certyfikacie, wybierz „Zaawansowane” i „Przejdź dalej”. To normalne w domowej sieci</div>
                <div className="step"><b>3</b>Włóż kartę w ramkę. Gdy zaświeci na zielono, zdjęcie zrobi się samo</div>
              </div>
              {pairing && <div className="url">{pairing.url}</div>}
              {pairing?.fallbackUrl && pairing.secure && <div className="faint" style={{ fontSize: 11.5, marginTop: 8 }}>Bez aparatu na żywo: {pairing.fallbackUrl}</div>}
            </div>
          )}

          <div
            className={`dropzone ${over ? 'over' : ''}`}
            onClick={() => fileRef.current?.click()}
            onDragOver={e => { e.preventDefault(); setOver(true); }}
            onDragLeave={() => setOver(false)}
            onDrop={e => { e.preventDefault(); setOver(false); addFiles(e.dataTransfer.files); }}
          >
            <ImagePlus size={20} style={{ margin: '0 auto 6px' }} />
            Przeciągnij tu zdjęcia kart albo <b style={{ color: 'var(--text)' }}>wybierz z dysku</b>
            <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={e => { addFiles(e.target.files); e.target.value = ''; }} />
          </div>

          {items.length > 0 && (
            <div className="queue">
              <div className="panel-title" style={{ margin: '4px 0 2px' }}>Zeskanowane ({items.length})</div>
              {items.map(it => (
                <div key={it.key} className={`q-item ${selected === it.key ? 'active' : ''}`} onClick={() => setSelected(it.key)}>
                  <img src={it.result?.best?.image || it.photo} alt="" />
                  <div className="t">
                    <div className="n">{it.result?.best?.name || (it.state === 'failed' ? 'Nie rozpoznano' : 'Nowe zdjęcie')}</div>
                    <div className="s">{it.state === 'working' || it.state === 'queued' ? it.step : it.result?.best?.set?.name || (it.state === 'failed' ? 'Wybierz kartę ręcznie' : '')}</div>
                  </div>
                  <QueueIcon state={it.state} />
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          {!current && (
            <div className="panel empty-state">
              <div>
                <div className="ghost-card"><ScanLine size={42} /></div>
                <h2>Czekam na pierwszą kartę</h2>
                <p>Zrób zdjęcie telefonem albo przeciągnij plik ze zdjęciem. Aplikacja odczyta numer karty (np. <span className="kbd">104/091</span>), znajdzie ją w bazie i sprawdzi ceny na Cardmarket, Allegro i Vinted.</p>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 18 }}>
                  <span className="chip"><Wifi size={12} />Telefon przez Wi‑Fi</span>
                  <span className="chip">OCR offline</span>
                  <span className="chip">3 źródła cen</span>
                </div>
              </div>
            </div>
          )}

          {current && (current.state === 'queued' || current.state === 'working') && (
            <div className="panel empty-state">
              <div>
                <div className="ghost-card" style={{ overflow: 'hidden', borderStyle: 'solid' }}>
                  <img src={current.photo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: .55 }} />
                  <div style={{ position: 'absolute', left: 0, right: 0, height: 3, background: 'var(--holo)', top: '50%', boxShadow: '0 0 20px #b56bff', animation: 'pulse 1.2s ease infinite' }} />
                </div>
                <h2 style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'center' }}><span className="spinner" />{current.step}</h2>
                <p>Pierwsze skanowanie trwa dłużej, bo silnik OCR się uruchamia.</p>
              </div>
            </div>
          )}

          {current && current.state === 'failed' && (
            <div className="panel empty-state">
              <div>
                {current.result?.cardUrl && <img src={current.result.cardUrl} alt="" style={{ width: 170, borderRadius: 10, margin: '0 auto 20px' }} />}
                <h2>Nie udało się rozpoznać karty</h2>
                <p>
                  {current.result?.ocr?.numberRaw ? <>Odczytany numer: <span className="kbd">{current.result.ocr.numberRaw}</span>. </> : 'Nie odczytano numeru z dołu karty. '}
                  {current.result?.ocr?.name ? <>Odczytana nazwa: <span className="kbd">{current.result.ocr.name}</span>. </> : ''}
                  Zrób zdjęcie bliżej, na ciemnym tle i bez odblasków, albo wyszukaj kartę po nazwie.
                </p>
                <div className="actions" style={{ justifyContent: 'center' }}>
                  <button className="btn btn-primary" onClick={() => openSearch(current.result?.ocr?.name || '', card => pick(current.key, card))}>Wyszukaj ręcznie</button>
                </div>
              </div>
            </div>
          )}

          {current && current.state === 'done' && current.result?.best && (() => {
            const sid = current.result.best.set?.id || setIdOf(current.result.best.id);
            const dex = pokedexes.find(d => d.setId === sid);
            if (!dex) return (
              <div className="dex-badge rise new"><Sparkles size={16} /><span>Karta z nowego setu. Po dodaniu do kolekcji powstanie dla niego Pokédex.</span></div>
            );
            const have = collection.filter(c => c.cardId === current.result.best.id).reduce((n, c) => n + (c.qty || 1), 0);
            const p = dexProgress(dex, collection);
            return (
              <div className={`dex-badge rise ${have ? '' : 'new'}`}>
                {have ? <BookOpen size={16} /> : <Sparkles size={16} />}
                <span>{have ? <>Masz już tę kartę (×{have}) w Pokédexie <b>{dex.name}</b></> : <>Nowa karta do Pokédexu <b>{dex.name}</b>! Dodaj ją do kolekcji.</>}</span>
                <span className="faint" style={{ marginLeft: 'auto' }}>{p.unique} / {p.all}</span>
              </div>
            );
          })()}

          {current && current.state === 'done' && current.result?.best && (
            <CardResult
              key={current.key + current.result.best.id}
              cardId={current.result.best.id}
              photoUrl={current.result.cardUrl}
              confidence={current.result.manual ? null : current.result.confidence}
              alternatives={(current.result.alternatives || []).filter(a => a.id !== current.result.best.id)}
              onPick={card => pick(current.key, card)}
              onSearch={() => openSearch(current.result?.ocr?.name || current.result.best.name, card => pick(current.key, card))}
              onAdd={onAdd}
            />
          )}
        </div>
      </div>
    </>
  );
}
