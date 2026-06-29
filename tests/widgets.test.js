import { describe, expect, it } from 'vitest';

import { createBrowserGlobalContext, evaluateGlobal, loadBrowserGlobalScript } from './helpers/browserGlobals.js';

function loadWidgets() {
  const context = createBrowserGlobalContext();
  loadBrowserGlobalScript(context, 'src/state.js');
  loadBrowserGlobalScript(context, 'src/ui/widgets.js');
  return evaluateGlobal(
    context,
    `({
    paramNorm,
    paramDenorm,
    knobAngle,
    paramDisplay
  })`
  );
}

describe('widget value helpers', () => {
  const api = loadWidgets();

  it('paramNorm and paramDenorm round-trip representative linear params', () => {
    const cases = [
      ['lowpass', 'res', 4],
      ['compressor', 'threshold', -24],
      ['compressor', 'attack', 0.012],
      ['reverb', 'duration', 2.4],
    ];

    for (const [stage, param, value] of cases) {
      expect(api.paramDenorm(stage, param, api.paramNorm(stage, param, value))).toBeCloseTo(value, 10);
    }
  });

  it('maps low-pass cutoff logarithmically across its range', () => {
    expect(api.paramNorm('lowpass', 'cutoff', 20)).toBeCloseTo(0, 10);
    expect(api.paramNorm('lowpass', 'cutoff', 20000)).toBeCloseTo(1, 10);

    const mid = 1240;
    expect(api.paramDenorm('lowpass', 'cutoff', api.paramNorm('lowpass', 'cutoff', mid))).toBeCloseTo(mid, 6);
  });

  it('maps master volume with a dB taper and true silence at minimum', () => {
    expect(api.paramDenorm('master', 'volume', 0)).toBe(0);
    expect(api.paramDenorm('master', 'volume', 1)).toBeCloseTo(1, 10);
  });

  it('knobAngle maps normalized min and max to -135deg and 135deg', () => {
    expect(api.knobAngle('lowpass', 'res', 0)).toBeCloseTo((-135 * Math.PI) / 180, 10);
    expect(api.knobAngle('lowpass', 'res', 30)).toBeCloseTo((135 * Math.PI) / 180, 10);
  });

  it('paramDisplay formats key readouts', () => {
    expect(api.paramDisplay('lowpass', 'cutoff', 1240)).toBe('1.24 kHz');
    expect(api.paramDisplay('lowpass', 'cutoff', 500)).toBe('500 Hz');
    expect(api.paramDisplay('compressor', 'attack', 0.012)).toBe('12 ms');
    expect(api.paramDisplay('compressor', 'ratio', 4)).toBe('4.0:1');
    expect(api.paramDisplay('master', 'volume', 0.8)).toBe('-2 dB');
  });
});
