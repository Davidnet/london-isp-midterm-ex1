import { beforeEach, describe, expect, it } from 'vitest';

import { createBrowserGlobalContext, evaluateGlobal, loadBrowserGlobalScript } from './helpers/browserGlobals.js';

function loadState() {
  const context = createBrowserGlobalContext();
  loadBrowserGlobalScript(context, 'src/state.js');
  return {
    context,
    api: evaluateGlobal(
      context,
      `({
      AppState,
      makeDefaultConfig,
      selectStage,
      setParam,
      setBypass,
      resetConfig,
      stageConfig
    })`
    ),
  };
}

describe('state helpers', () => {
  let api;

  beforeEach(() => {
    api = loadState().api;
  });

  it('makeDefaultConfig returns independent config objects', () => {
    const first = api.makeDefaultConfig();
    const second = api.makeDefaultConfig();

    first.lowpass.cutoff = 20;
    first.reverb.reverse = true;

    expect(second.lowpass.cutoff).toBe(1240);
    expect(second.reverb.reverse).toBe(false);
  });

  it('setParam clamps numeric params to their configured ranges', () => {
    expect(api.setParam('lowpass', 'cutoff', 10)).toBe(20);
    expect(api.AppState.config.lowpass.cutoff).toBe(20);

    expect(api.setParam('compressor', 'ratio', 24)).toBe(20);
    expect(api.AppState.config.compressor.ratio).toBe(20);

    expect(api.setParam('master', 'volume', 2)).toBe(1);
    expect(api.AppState.config.master.volume).toBe(1);
  });

  it('setParam passes option params through unchanged', () => {
    expect(api.setParam('waveshaper', 'oversample', '4x')).toBe('4x');
    expect(api.AppState.config.waveshaper.oversample).toBe('4x');

    expect(api.setParam('reverb', 'reverse', true)).toBe(true);
    expect(api.AppState.config.reverb.reverse).toBe(true);
  });

  it('invalid stages and params do not crash', () => {
    expect(api.setParam('missing', 'cutoff', 100)).toBeUndefined();

    expect(api.setParam('lowpass', 'notARealParam', 123)).toBe(123);
    expect(api.AppState.config.lowpass.notARealParam).toBe(123);
    expect(api.stageConfig('missing')).toBeUndefined();
  });

  it('selectStage accepts valid stages and ignores invalid ones', () => {
    api.selectStage('compressor');

    expect(api.AppState.selected).toBe('compressor');
    expect(api.AppState.config.selected).toBe('compressor');

    api.selectStage('not-a-stage');

    expect(api.AppState.selected).toBe('compressor');
    expect(api.AppState.config.selected).toBe('compressor');
  });

  it('setBypass toggles FX stages and does not affect master', () => {
    api.setBypass('lowpass', false);
    api.setBypass('compressor', true);

    expect(api.AppState.config.lowpass.on).toBe(false);
    expect(api.AppState.config.compressor.on).toBe(true);

    api.setBypass('master', false);
    expect(api.AppState.config.master).toEqual({ volume: 0.8 });
  });

  it('resetConfig restores defaults and syncs AppState.selected', () => {
    api.selectStage('compressor');
    api.setParam('lowpass', 'cutoff', 20000);
    api.setParam('reverb', 'reverse', true);

    api.resetConfig();

    expect(api.AppState.config).toEqual(api.makeDefaultConfig());
    expect(api.AppState.selected).toBe('reverb');
  });
});
