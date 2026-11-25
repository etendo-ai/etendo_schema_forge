import { describe, expect, it } from 'vitest';
import {
  MAX_HIGHLIGHT_STEPS,
  advanceHighlightScript,
  normalizeHighlightSteps,
} from '../highlightScript.js';

/** @covers tools/app-shell/src/components/copilot/highlight/highlightScript.js */
describe('normalizeHighlightSteps', () => {
  it('is single mode without a usable steps array', () => {
    expect(normalizeHighlightSteps({ fieldKey: 'a' }).mode).toBe('single');
    expect(normalizeHighlightSteps({ steps: [] }).mode).toBe('single');
    expect(normalizeHighlightSteps({ steps: 'x' }).mode).toBe('single');
  });

  it('keeps valid steps in order and defaults the note', () => {
    const out = normalizeHighlightSteps({ steps: [{ fieldKey: 'a', note: 'n' }, { elementId: 'dom-2' }] });
    expect(out.mode).toBe('script');
    expect(out.steps).toEqual([{ fieldKey: 'a', note: 'n' }, { elementId: 'dom-2', note: '' }]);
  });

  it('rejects malformed steps without failing the call', () => {
    const out = normalizeHighlightSteps({ steps: [null, {}, { fieldKey: ' ' }, { fieldKey: 'ok' }] });
    expect(out.steps).toHaveLength(1);
    expect(out.rejected.map(r => r.step)).toEqual([1, 2, 3]);
  });

  it('drops steps beyond the cap and reports how many', () => {
    const steps = Array.from({ length: MAX_HIGHLIGHT_STEPS + 3 }, (_, i) => ({ fieldKey: `f${i}` }));
    const out = normalizeHighlightSteps({ steps });
    expect(out.steps).toHaveLength(MAX_HIGHLIGHT_STEPS);
    expect(out.dropped).toBe(3);
  });
});

describe('advanceHighlightScript', () => {
  const el = name => ({ name });
  const ok = name => ({ note: name, resolve: () => el(name) });
  const bad = { note: 'bad', resolve: () => null };
  const throwing = { resolve: () => { throw new Error('boom'); } };

  it('resolves the start step', () => {
    const out = advanceHighlightScript([ok('a'), ok('b')], 0, 1);
    expect(out).toMatchObject({ index: 0, note: 'a', skipped: [] });
  });

  it('skips unresolvable steps going forward and reports them', () => {
    const out = advanceHighlightScript([ok('a'), bad, throwing, ok('d')], 1, 1);
    expect(out.index).toBe(3);
    expect(out.skipped).toEqual([
      { step: 2, reason: 'the step resolved to nothing' },
      { step: 3, reason: 'boom' },
    ]);
  });

  it('walks backward', () => {
    const out = advanceHighlightScript([ok('a'), bad, ok('c')], 1, -1);
    expect(out.index).toBe(0);
  });

  it('returns index -1 when nothing is reachable', () => {
    const out = advanceHighlightScript([bad], 0, 1);
    expect(out.index).toBe(-1);
    expect(out.element).toBeNull();
    expect(advanceHighlightScript(undefined, 0, 1).index).toBe(-1);
  });
});
