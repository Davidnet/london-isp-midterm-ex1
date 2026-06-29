import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

function loadStore() {
  const source = readFileSync(new URL('../src/persistence.js', import.meta.url), 'utf8');
  const context = vm.createContext({
    Blob,
    DataView,
    ArrayBuffer,
    JSON,
    Promise,
    console,
    indexedDB: {},
    localStorage: {},
  });

  return new vm.Script(`${source}\nStore;`).runInContext(context);
}

function makeAudioBuffer(channels, sampleRate = 44100) {
  return {
    numberOfChannels: channels.length,
    sampleRate,
    length: channels[0].length,
    getChannelData(channel) {
      return channels[channel];
    },
  };
}

async function blobBytes(blob) {
  return new Uint8Array(await blob.arrayBuffer());
}

async function legacyEncodeWavBytes(ab) {
  // This is the early encoder implementation. The tests compare the
  // readable refactor against it byte-for-byte for the same AudioBuffer input.
  const numCh = ab.numberOfChannels;
  const sr = ab.sampleRate;
  const len = ab.length;
  const blockAlign = numCh * 2;
  const dataLen = len * blockAlign;
  const buf = new ArrayBuffer(44 + dataLen);
  const view = new DataView(buf);
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

  return blobBytes(new Blob([buf], { type: 'audio/wav' }));
}

function ascii(bytes, start, length) {
  return String.fromCharCode(...bytes.slice(start, start + length));
}

describe('Store.encodeWav', () => {
  it('matches the master encoder byte-for-byte for interleaved stereo PCM', async () => {
    const Store = loadStore();
    const audioBuffer = makeAudioBuffer(
      [new Float32Array([-1.2, -1, -0.5, 0, 0.5, 1, 1.2]), new Float32Array([1.2, 1, 0.5, 0, -0.5, -1, -1.2])],
      48000
    );

    const actual = await blobBytes(Store.encodeWav(audioBuffer));
    const expected = await legacyEncodeWavBytes(audioBuffer);

    expect([...actual]).toEqual([...expected]);
  });

  it('writes a valid 16-bit PCM WAV header for mono buffers', async () => {
    const Store = loadStore();
    const audioBuffer = makeAudioBuffer([new Float32Array([-0.25, 0, 0.25])], 22050);
    const bytes = await blobBytes(Store.encodeWav(audioBuffer));
    const view = new DataView(bytes.buffer);

    expect(ascii(bytes, 0, 4)).toBe('RIFF');
    expect(view.getUint32(4, true)).toBe(42);
    expect(ascii(bytes, 8, 4)).toBe('WAVE');
    expect(ascii(bytes, 12, 4)).toBe('fmt ');
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(22050);
    expect(view.getUint32(28, true)).toBe(44100);
    expect(view.getUint16(32, true)).toBe(2);
    expect(view.getUint16(34, true)).toBe(16);
    expect(ascii(bytes, 36, 4)).toBe('data');
    expect(view.getUint32(40, true)).toBe(6);
  });
});
