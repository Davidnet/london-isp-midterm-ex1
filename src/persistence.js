/*
 * persistence.js — library persistence (Slice 3d).
 *
 * Two tiers, matching the handoff:
 *   - localStorage  → the small library INDEX (id, name, type, effect config) +
 *     the active selection. JSON only, no audio.
 *   - IndexedDB     → the audio BLOBS (imported File blobs, encoded bounce WAVs),
 *     keyed by item id. Too big for localStorage.
 *
 * Default "sample" sounds aren't stored as blobs — they reload from /assets and
 * re-link by id on startup. Everything is best-effort: if storage is unavailable
 * (private mode, blocked), calls fail quietly and the app still runs in-memory.
 *
 * Exposes a single `Store` global.
 */

const Store = (function () {
  const DB = 'ferric',
    STORE = 'audio',
    VER = 1;
  const LS_KEY = 'ferric.library';
  let dbp = null;

  /* ---------------- IndexedDB (audio blobs) ---------------- */

  function open() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      let r;
      try {
        r = indexedDB.open(DB, VER);
      } catch (e) {
        rej(e);
        return;
      }
      r.onupgradeneeded = () => {
        const db = r.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return dbp;
  }

  function store(mode) {
    return open().then((db) => db.transaction(STORE, mode).objectStore(STORE));
  }

  function putBlob(id, blob) {
    return store('readwrite').then(
      (os) =>
        new Promise((res, rej) => {
          const r = os.put(blob, id);
          r.onsuccess = () => res();
          r.onerror = () => rej(r.error);
        })
    );
  }

  function getBlob(id) {
    return store('readonly').then(
      (os) =>
        new Promise((res, rej) => {
          const r = os.get(id);
          r.onsuccess = () => res(r.result || null);
          r.onerror = () => rej(r.error);
        })
    );
  }

  function delBlob(id) {
    return store('readwrite').then(
      (os) =>
        new Promise((res, rej) => {
          const r = os.delete(id);
          r.onsuccess = () => res();
          r.onerror = () => rej(r.error);
        })
    );
  }

  /* ---------------- localStorage (index) ---------------- */

  function saveLibrary(library, activeId) {
    try {
      const items = library.map((it) => ({
        id: it.id,
        name: it.name,
        type: it.type,
        config: it.config,
      }));
      localStorage.setItem(LS_KEY, JSON.stringify({ activeId: activeId || null, items }));
    } catch (e) {
      console.warn('[store] saveLibrary failed', e);
    }
  }

  function loadLibrary() {
    try {
      const s = localStorage.getItem(LS_KEY);
      return s ? JSON.parse(s) : null;
    } catch (e) {
      return null;
    }
  }

  function clearLibrary() {
    try {
      localStorage.removeItem(LS_KEY);
    } catch (e) {
      /* ignore */
    }
  }

  /* ---------------- WAV encode (bounce buffer → Blob) ---------------- */

  // 16-bit PCM WAV from a Web Audio AudioBuffer.
  function encodeWav(ab) {
    const numCh = ab.numberOfChannels,
      sr = ab.sampleRate,
      len = ab.length;
    const blockAlign = numCh * 2,
      dataLen = len * blockAlign;
    const buf = new ArrayBuffer(44 + dataLen),
      view = new DataView(buf);
    let o = 0;
    const str = (s) => {
      for (let i = 0; i < s.length; i++) view.setUint8(o++, s.charCodeAt(i));
    };
    const u32 = (v) => {
      view.setUint32(o, v, true);
      o += 4;
    };
    const u16 = (v) => {
      view.setUint16(o, v, true);
      o += 2;
    };
    str('RIFF');
    u32(36 + dataLen);
    str('WAVE');
    str('fmt ');
    u32(16);
    u16(1);
    u16(numCh);
    u32(sr);
    u32(sr * blockAlign);
    u16(blockAlign);
    u16(16);
    str('data');
    u32(dataLen);
    const chans = [];
    for (let c = 0; c < numCh; c++) chans.push(ab.getChannelData(c));
    for (let i = 0; i < len; i++) {
      for (let c = 0; c < numCh; c++) {
        const s = Math.max(-1, Math.min(1, chans[c][i]));
        view.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
        o += 2;
      }
    }
    return new Blob([buf], { type: 'audio/wav' });
  }

  return { putBlob, getBlob, delBlob, saveLibrary, loadLibrary, clearLibrary, encodeWav };
})();
