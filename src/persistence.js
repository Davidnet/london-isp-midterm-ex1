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
  const DB = 'ferric', STORE = 'audio', VER = 1;
  const LS_KEY = 'ferric.library';
  let dbp = null;

  /* ---------------- IndexedDB (audio blobs) ---------------- */

  function open() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      let r;
      try { r = indexedDB.open(DB, VER); } catch (e) { rej(e); return; }
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
    return store('readwrite').then((os) => new Promise((res, rej) => {
      const r = os.put(blob, id); r.onsuccess = () => res(); r.onerror = () => rej(r.error);
    }));
  }

  function getBlob(id) {
    return store('readonly').then((os) => new Promise((res, rej) => {
      const r = os.get(id); r.onsuccess = () => res(r.result || null); r.onerror = () => rej(r.error);
    }));
  }

  function delBlob(id) {
    return store('readwrite').then((os) => new Promise((res, rej) => {
      const r = os.delete(id); r.onsuccess = () => res(); r.onerror = () => rej(r.error);
    }));
  }

  /* ---------------- localStorage (index) ---------------- */

  function saveLibrary(library, activeId) {
    try {
      const items = library.map((it) => ({ id: it.id, name: it.name, type: it.type, config: it.config }));
      localStorage.setItem(LS_KEY, JSON.stringify({ activeId: activeId || null, items }));
    } catch (e) { console.warn('[store] saveLibrary failed', e); }
  }

  function loadLibrary() {
    try { const s = localStorage.getItem(LS_KEY); return s ? JSON.parse(s) : null; }
    catch (e) { return null; }
  }

  function clearLibrary() { try { localStorage.removeItem(LS_KEY); } catch (e) { /* ignore */ } }

  /* ---------------- WAV encode (bounce buffer → Blob) ---------------- */

  // 16-bit PCM WAV from a Web Audio AudioBuffer.
  function encodeWav(ab) {
    const channels = ab.numberOfChannels;
    const sampleRate = ab.sampleRate;
    const frameCount = ab.length;
    const bitsPerSample = 16;
    const bytesPerSample = bitsPerSample / 8;
    const blockAlign = channels * bytesPerSample;
    const byteRate = sampleRate * blockAlign;
    const dataLength = frameCount * blockAlign;
    const headerLength = 44;

    const buffer = new ArrayBuffer(headerLength + dataLength);
    const view = new DataView(buffer);
    let offset = 0;

    function writeString(value) {
      for (let i = 0; i < value.length; i++) {
        view.setUint8(offset, value.charCodeAt(i));
        offset += 1;
      }
    }

    function writeUint32(value) {
      view.setUint32(offset, value, true);
      offset += 4;
    }

    function writeUint16(value) {
      view.setUint16(offset, value, true);
      offset += 2;
    }

    function writeInt16Sample(value) {
      const clamped = Math.max(-1, Math.min(1, value));
      const scaled = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
      view.setInt16(offset, scaled, true);
      offset += 2;
    }

    writeString('RIFF');
    writeUint32(36 + dataLength);
    writeString('WAVE');

    writeString('fmt ');
    writeUint32(16);
    writeUint16(1);
    writeUint16(channels);
    writeUint32(sampleRate);
    writeUint32(byteRate);
    writeUint16(blockAlign);
    writeUint16(bitsPerSample);

    writeString('data');
    writeUint32(dataLength);

    const channelData = [];
    for (let channel = 0; channel < channels; channel++) {
      channelData.push(ab.getChannelData(channel));
    }

    for (let frame = 0; frame < frameCount; frame++) {
      for (let channel = 0; channel < channels; channel++) {
        writeInt16Sample(channelData[channel][frame]);
      }
    }

    return new Blob([buffer], { type: 'audio/wav' });
  }

  return { putBlob, getBlob, delBlob, saveLibrary, loadLibrary, clearLibrary, encodeWav };
})();
