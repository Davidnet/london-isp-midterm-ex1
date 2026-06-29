import { describe, expect, it } from 'vitest';

import { createBrowserGlobalContext, evaluateGlobal, loadBrowserGlobalScript } from './helpers/browserGlobals.js';

function loadModalHelpers() {
  const context = createBrowserGlobalContext({
    document: {},
    window: {},
    URL: {},
  });
  loadBrowserGlobalScript(context, 'src/ui/modal.js');
  return evaluateGlobal(
    context,
    `({
    fmtDuration,
    baseName,
    extFormat,
    sanitizeName
  })`
  );
}

describe('modal format helpers', () => {
  const api = loadModalHelpers();

  it('fmtDuration formats zero, invalid, sub-minute, and multi-minute values', () => {
    expect(api.fmtDuration(0)).toBe('0:00');
    expect(api.fmtDuration(Number.NaN)).toBe('0:00');
    expect(api.fmtDuration(9.8)).toBe('0:09');
    expect(api.fmtDuration(125.9)).toBe('2:05');
  });

  it('baseName removes one filename extension', () => {
    expect(api.baseName('sample.wav')).toBe('sample');
    expect(api.baseName('mix.v1.final.mp3')).toBe('mix.v1.final');
    expect(api.baseName('untitled')).toBe('untitled');
  });

  it('extFormat uppercases known extensions and falls back to WAV', () => {
    expect(api.extFormat('sample.wav')).toBe('WAV');
    expect(api.extFormat('mix.final.flac')).toBe('FLAC');
    expect(api.extFormat('untitled')).toBe('WAV');
  });

  it('sanitizeName strips illegal filename characters and trims whitespace', () => {
    expect(api.sanitizeName('  bad/name:*?"<>|mix  ')).toBe('badnamemix');
  });
});
