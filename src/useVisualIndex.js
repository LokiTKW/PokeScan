import { useEffect, useState } from 'react';
import { loadIndex } from './recognition/visual';

/** Builds (first run) or tops up (new sets) the visual card index in a background worker. */
export function useVisualIndex() {
  const [state, setState] = useState({ done: 0, total: 0, building: false, error: '' });
  useEffect(() => {
    let worker;
    let lastReload = 0;
    let retry;
    const start = () => {
      worker = new Worker(new URL('./recognition/indexWorker.js', import.meta.url), { type: 'module' });
      worker.onmessage = e => {
        const m = e.data;
        if (m.type === 'progress') setState(s => ({ ...s, done: m.done, total: m.total, building: m.building, error: '' }));
        if (m.type === 'saved' && Date.now() - lastReload > 20000) { lastReload = Date.now(); loadIndex(true).catch(() => {}); }
        if (m.type === 'done') { loadIndex(true).catch(() => {}); setState(s => ({ ...s, building: false })); worker.terminate(); if (m.failed) retry = setTimeout(start, 120000); }
        if (m.type === 'error') { setState(s => ({ ...s, building: false, error: m.message })); worker.terminate(); retry = setTimeout(start, 60000); }
      };
      worker.postMessage('start');
    };
    loadIndex().catch(() => {});
    start();
    return () => { clearTimeout(retry); worker && worker.terminate(); };
  }, []);
  return state;
}
