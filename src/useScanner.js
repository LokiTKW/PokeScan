import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';
import { recognize } from './recognition/recognize';
import { loadOpenCV } from './recognition/opencv';
import { warmUpOcr } from './recognition/ocr';

/** Queue of photos (from phone or PC) recognized one by one. */
export function useScanner(setId = null) {
  const setIdRef = useRef(setId);
  setIdRef.current = setId;
  const [items, setItems] = useState([]); // {key, phoneId, photo, state, step, result, error}
  const [selected, setSelected] = useState(null);
  const [pairing, setPairing] = useState(null);
  const [phoneConnected, setPhoneConnected] = useState(false);
  const busy = useRef(false);

  const update = (key, patch) => setItems(list => list.map(it => (it.key === key ? { ...it, ...patch } : it)));

  const enqueue = useCallback((photo, phoneId, box = null) => {
    const key = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setItems(list => {
      const next = [{ key, phoneId, photo, box, setId: setIdRef.current, state: 'queued', step: 'W kolejce' }, ...list];
      // keep everything still waiting, and the 40 most recent finished scans
      let finished = 0;
      return next.filter(it => it.state === 'queued' || it.state === 'working' || ++finished <= 40);
    });
    setSelected(s => s || key);
    if (phoneId) api.photoStatus(phoneId, 'queued', 'Czeka na komputerze');
    return key;
  }, []);

  useEffect(() => {
    api.pairing().then(p => { setPairing(p); setPhoneConnected(p.phoneConnected); }).catch(() => {});
    // warm up the engines so the first scan is faster
    loadOpenCV().then(() => warmUpOcr()).catch(() => {});
    return api.events(e => {
      if (e.type === 'hello') setPhoneConnected(e.phoneConnected);
      if (e.type === 'phone') setPhoneConnected(e.connected);
      if (e.type === 'photo') { setPhoneConnected(true); enqueue(`data:image/jpeg;base64,${e.base64}`, e.id, e.box); }
    });
  }, [enqueue]);

  // process the queue (oldest first)
  useEffect(() => {
    if (busy.current) return;
    const next = [...items].reverse().find(it => it.state === 'queued');
    if (!next) return;
    busy.current = true;
    (async () => {
      update(next.key, { state: 'working', step: 'Start…' });
      if (next.phoneId) api.photoStatus(next.phoneId, 'working', 'Rozpoznawanie…');
      try {
        const result = await recognize(next.photo, step => update(next.key, { step }), { box: next.box, setId: next.setId });
        if (result.best) {
          update(next.key, { state: 'done', result, step: '' });
          setSelected(next.key);
          if (next.phoneId) api.photoStatus(next.phoneId, 'done', `${result.best.name}${result.best.set?.name ? ` · ${result.best.set.name}` : ''}`);
        } else {
          update(next.key, { state: 'failed', result, step: '' });
          setSelected(next.key);
          if (next.phoneId) api.photoStatus(next.phoneId, 'error', 'Nie odczytano karty. Zrób zdjęcie bliżej, bez odblasków.');
        }
      } catch (e) {
        api.log(`recognize error ${e && e.message}`);
        update(next.key, { state: 'failed', error: e.message, step: '' });
        if (next.phoneId) api.photoStatus(next.phoneId, 'error', 'Błąd rozpoznawania');
      } finally {
        busy.current = false;
        setItems(l => [...l]); // trigger next
      }
    })();
  }, [items]);

  const pick = (key, card) => update(key, { state: 'done', result: { ...(items.find(i => i.key === key)?.result || {}), best: card, confidence: 1, manual: true } });

  return { items, selected, setSelected, pairing, phoneConnected, enqueue, pick };
}
