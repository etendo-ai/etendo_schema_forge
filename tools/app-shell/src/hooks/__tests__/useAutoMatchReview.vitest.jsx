// @covers tools/app-shell/src/hooks/useAutoMatchReview.js
/**
 * `useAutoMatchSelection` / `useAutoMatchReview` — the automatch checks and the "Revisar en el
 * panel" state (focus request, "No es un rechazo" dismissals) shared by the automatch modal and the
 * reconciliation panel (bounce pairs).
 */
import { renderHook, act } from '@testing-library/react';
import { useAutoMatchSelection, useAutoMatchReview } from '../useAutoMatchReview.js';

const TX = { groupKey: 'tx-1', statementLine: { id: 'S1' } };
const HIGH = {
  kind: 'bouncePair', groupKey: 'bp-high', confidence: 'high',
  statementLine: { id: 'O1' }, counterpartLine: { id: 'B1' },
};
const REVIEW = {
  kind: 'bouncePair', groupKey: 'bp-review', confidence: 'review',
  statementLine: { id: 'O2' }, counterpartLine: { id: 'B2' },
};
const AMBIGUOUS = {
  kind: 'bouncePair', groupKey: 'bp-amb', confidence: 'review', ambiguous: true,
  statementLine: null, counterpartLine: { id: 'B3' },
  candidates: [{ line: { id: 'C1' } }, { line: { id: 'C2' } }],
};
const GROUPS = [TX, HIGH, REVIEW, AMBIGUOUS];

describe('useAutoMatchSelection', () => {
  it('starts from the defaults: transaction and high checked, review unchecked, ambiguous never', () => {
    const { result } = renderHook(() => useAutoMatchSelection(GROUPS));
    expect(result.current.isChecked(TX)).toBe(true);
    expect(result.current.isChecked(HIGH)).toBe(true);
    expect(result.current.isChecked(REVIEW)).toBe(false);
    expect(result.current.isChecked(AMBIGUOUS)).toBe(false);
  });

  it('toggles a group against its default; an ambiguous pair is never checked by default but can be ticked', () => {
    // With AI data: without it an ambiguous pair cannot be ticked in the modal (ETP-6359).
    const { result } = renderHook(() => useAutoMatchSelection(GROUPS, AMB_AI));
    act(() => result.current.toggle(REVIEW));
    act(() => result.current.toggle(TX));
    act(() => result.current.toggle(AMBIGUOUS));
    expect(result.current.isChecked(REVIEW)).toBe(true);
    expect(result.current.isChecked(TX)).toBe(false);
    expect(result.current.isChecked(AMBIGUOUS)).toBe(true);
    act(() => result.current.toggle(REVIEW));
    expect(result.current.isChecked(REVIEW)).toBe(false);
  });

  it('setMany checks or unchecks every selectable group of the list', () => {
    const { result } = renderHook(() => useAutoMatchSelection(GROUPS, AMB_AI));
    act(() => result.current.setMany([HIGH, REVIEW, AMBIGUOUS], true));
    expect(result.current.isChecked(HIGH)).toBe(true);
    expect(result.current.isChecked(REVIEW)).toBe(true);
    expect(result.current.isChecked(AMBIGUOUS)).toBe(true);
    act(() => result.current.setMany([HIGH, REVIEW], false));
    expect(result.current.isChecked(HIGH)).toBe(false);
    expect(result.current.isChecked(REVIEW)).toBe(false);
    expect(result.current.isChecked(TX)).toBe(true);
  });

  it('resets every choice to its default when the groups reload (default behaviour)', () => {
    const { result, rerender } = renderHook(({ groups }) => useAutoMatchSelection(groups), {
      initialProps: { groups: GROUPS },
    });
    act(() => result.current.toggle(REVIEW));
    act(() => result.current.toggle(TX));
    rerender({ groups: [...GROUPS] });
    expect(result.current.isChecked(REVIEW)).toBe(false);
    expect(result.current.isChecked(TX)).toBe(true);
  });

  it('keeps every choice while the groups do not reload (same array)', () => {
    const { result, rerender } = renderHook(({ groups }) => useAutoMatchSelection(groups), {
      initialProps: { groups: GROUPS },
    });
    act(() => result.current.toggle(REVIEW));
    rerender({ groups: GROUPS });
    expect(result.current.isChecked(REVIEW)).toBe(true);
  });
});

describe('useAutoMatchReview', () => {
  it('starts idle, with no focus request and nothing dismissed', () => {
    const { result } = renderHook(() => useAutoMatchReview(GROUPS));
    expect(result.current.focus).toBeNull();
    expect(result.current.dismissedKeys.size).toBe(0);
    // The banner-era state is gone: no review flag, no way back, no count of what remains.
    expect(result.current).not.toHaveProperty('reviewing');
    expect(result.current).not.toHaveProperty('endReview');
    expect(result.current).not.toHaveProperty('remaining');
    expect(result.current.panel).toEqual({
      focus: null,
      onFocusConsumed: result.current.consumeFocus,
      dismissedKeys: result.current.dismissedKeys,
      onDismiss: result.current.dismiss,
      picks: result.current.picks,
      onPick: result.current.pickOutflow,
    });
  });

  it('startReview focuses the pair bounce line with an increasing seq', () => {
    const { result } = renderHook(() => useAutoMatchReview(GROUPS));
    act(() => result.current.startReview(AMBIGUOUS));
    expect(result.current.focus).toEqual({ lineId: 'B3', seq: 1 });
    expect(result.current.panel.focus).toEqual({ lineId: 'B3', seq: 1 });
    // A second request for the same line is a new request.
    act(() => result.current.startReview(AMBIGUOUS));
    expect(result.current.focus).toEqual({ lineId: 'B3', seq: 2 });
  });

  it('ignores startReview for a group without a bounce line', () => {
    const { result } = renderHook(() => useAutoMatchReview(GROUPS));
    act(() => result.current.startReview(TX));
    act(() => result.current.startReview(null));
    expect(result.current.focus).toBeNull();
  });

  it('consumeFocus clears the focus request', () => {
    const { result } = renderHook(() => useAutoMatchReview(GROUPS));
    act(() => result.current.startReview(REVIEW));
    act(() => result.current.panel.onFocusConsumed());
    expect(result.current.focus).toBeNull();
  });

  it('keeps the modal checks after "Revisar en el panel" while the suggestions do not reload', () => {
    const { result, rerender } = renderHook(({ groups }) => useAutoMatchReview(groups), {
      initialProps: { groups: GROUPS },
    });
    act(() => result.current.selection.toggle(REVIEW));
    act(() => result.current.startReview(AMBIGUOUS));
    rerender({ groups: GROUPS });
    expect(result.current.selection.isChecked(REVIEW)).toBe(true);
  });

  it('resets the modal checks on a reload, also after "Revisar en el panel"', () => {
    const { result, rerender } = renderHook(({ groups }) => useAutoMatchReview(groups), {
      initialProps: { groups: GROUPS },
    });
    act(() => result.current.selection.toggle(REVIEW));
    act(() => result.current.startReview(AMBIGUOUS));
    rerender({ groups: [...GROUPS] });
    expect(result.current.selection.isChecked(REVIEW)).toBe(false);
  });

  it('resets the modal checks on a reload', () => {
    const { result, rerender } = renderHook(({ groups }) => useAutoMatchReview(groups), {
      initialProps: { groups: GROUPS },
    });
    act(() => result.current.selection.toggle(REVIEW));
    rerender({ groups: [...GROUPS] });
    expect(result.current.selection.isChecked(REVIEW)).toBe(false);
  });

  it('dismiss records a pair; a repeated or empty key changes nothing', () => {
    const { result } = renderHook(() => useAutoMatchReview(GROUPS));
    act(() => result.current.panel.onDismiss('bp-review'));
    const first = result.current.dismissedKeys;
    expect([...first]).toEqual(['bp-review']);
    expect(result.current.panel.dismissedKeys).toBe(first);
    act(() => result.current.dismiss('bp-review'));
    act(() => result.current.dismiss(null));
    expect(result.current.dismissedKeys).toBe(first);
  });

  it('clearDismissed forgets the dismissals, keeping the same set when there are none', () => {
    const { result } = renderHook(() => useAutoMatchReview(GROUPS));
    const empty = result.current.dismissedKeys;
    act(() => result.current.clearDismissed());
    expect(result.current.dismissedKeys).toBe(empty);
    act(() => result.current.dismiss('bp-high'));
    act(() => result.current.clearDismissed());
    expect(result.current.dismissedKeys.size).toBe(0);
  });

  it('tolerates a missing groups array', () => {
    const { result } = renderHook(() => useAutoMatchReview(undefined));
    expect(result.current.selection.isChecked(TX)).toBe(true);
    expect(result.current.dismissedKeys.size).toBe(0);
  });

  it('active=false drops the focus and forgets the dismissals', () => {
    const { result, rerender } = renderHook(({ active }) => useAutoMatchReview(GROUPS, { active }), {
      initialProps: { active: true },
    });
    act(() => result.current.startReview(REVIEW));
    act(() => result.current.dismiss('bp-high'));
    rerender({ active: false });
    expect(result.current.focus).toBeNull();
    expect(result.current.dismissedKeys.size).toBe(0);
  });

  // --- sent_to_panel (ETP-5581 KPI): the pairs "Revisar en el panel" sent during this modal session

  it('startReview records the pair as sent to the panel, once', () => {
    const { result } = renderHook(() => useAutoMatchReview(GROUPS));
    expect(result.current.sentToPanelKeys.size).toBe(0);
    act(() => result.current.startReview(REVIEW));
    const first = result.current.sentToPanelKeys;
    expect([...first]).toEqual(['bp-review']);
    act(() => result.current.startReview(REVIEW));
    expect(result.current.sentToPanelKeys).toBe(first);
    act(() => result.current.startReview(AMBIGUOUS));
    expect([...result.current.sentToPanelKeys]).toEqual(['bp-review', 'bp-amb']);
  });

  it('a group without a bounce line is never recorded as sent to the panel', () => {
    const { result } = renderHook(() => useAutoMatchReview(GROUPS));
    act(() => result.current.startReview(TX));
    expect(result.current.sentToPanelKeys.size).toBe(0);
  });

  it('keeps the pairs sent to the panel while the suggestions do not reload, and forgets them on a reload', () => {
    const { result, rerender } = renderHook(({ groups }) => useAutoMatchReview(groups), {
      initialProps: { groups: GROUPS },
    });
    act(() => result.current.startReview(REVIEW));
    rerender({ groups: GROUPS });
    expect([...result.current.sentToPanelKeys]).toEqual(['bp-review']);
    rerender({ groups: [...GROUPS] });
    expect(result.current.sentToPanelKeys.size).toBe(0);
  });

  it('checking a pair again forgets that it was sent to the panel; unchecking does not', () => {
    const { result } = renderHook(() => useAutoMatchReview(GROUPS));
    act(() => result.current.startReview(HIGH));
    act(() => result.current.startReview(REVIEW));
    // HIGH starts checked: this toggle unchecks it, so it stays "sent to the panel".
    act(() => result.current.selection.toggle(HIGH));
    expect(result.current.sentToPanelKeys.has('bp-high')).toBe(true);
    // REVIEW starts unchecked: this toggle re-checks it.
    act(() => result.current.selection.toggle(REVIEW));
    expect(result.current.selection.isChecked(REVIEW)).toBe(true);
    expect(result.current.sentToPanelKeys.has('bp-review')).toBe(false);
  });

  it('select-all of the pairs forgets them as sent to the panel; unselect-all keeps them', () => {
    const { result } = renderHook(() => useAutoMatchReview(GROUPS, { bounceAiAssessments: AMB_AI }));
    act(() => result.current.startReview(REVIEW));
    act(() => result.current.startReview(AMBIGUOUS));
    act(() => result.current.selection.setMany([HIGH, REVIEW, AMBIGUOUS], false));
    expect([...result.current.sentToPanelKeys]).toEqual(['bp-review', 'bp-amb']);
    act(() => result.current.selection.setMany([HIGH, REVIEW, AMBIGUOUS], true));
    // Every selectable pair, the ambiguous one included, is no longer the panel's once checked.
    expect([...result.current.sentToPanelKeys]).toEqual([]);
  });

  it('active=false forgets the pairs sent to the panel', () => {
    const { result, rerender } = renderHook(({ active }) => useAutoMatchReview(GROUPS, { active }), {
      initialProps: { active: true },
    });
    act(() => result.current.startReview(REVIEW));
    rerender({ active: false });
    expect(result.current.sentToPanelKeys.size).toBe(0);
  });
});

// ETP-6359 — the AI layer of the last automatch answer, handed to the reconciliation panel.
describe('useAutoMatchReview — aiAssessments', () => {
  const AI = { B3: { probabilities: { C1: 10, C2: 85 }, none: 5, recommendedLineId: 'C2' } };

  it('exposes aiAssessments on the hook and inside the panel bundle', () => {
    const { result } = renderHook(() => useAutoMatchReview(GROUPS, { bounceAiAssessments: AI }));
    expect(result.current.aiAssessments).toBe(AI);
    expect(result.current.panel.aiAssessments).toBe(AI);
  });

  it('without an AI layer: aiAssessments is null and the panel bundle carries no such key', () => {
    for (const options of [undefined, {}, { bounceAiAssessments: null }]) {
      const { result } = renderHook(() => useAutoMatchReview(GROUPS, options));
      expect(result.current.aiAssessments).toBeNull();
      expect('aiAssessments' in result.current.panel).toBe(false);
    }
  });

  it('follows a new automatch answer', () => {
    const { result, rerender } = renderHook(
      ({ ai }) => useAutoMatchReview(GROUPS, { bounceAiAssessments: ai }),
      { initialProps: { ai: null } },
    );
    expect('aiAssessments' in result.current.panel).toBe(false);
    rerender({ ai: AI });
    expect(result.current.panel.aiAssessments).toBe(AI);
  });
});

// ── Ambiguous pairs in the modal (ETP-6359) ──────────────────────────────────────────────────

const AMB_AI = { B3: { probabilities: { C1: 10, C2: 85 }, none: 5, recommendedLineId: 'C2' } };

describe('useAutoMatchSelection — ambiguous pairs and the AI data', () => {
  it('an ambiguous pair is selectable but never checked by default; select-all includes it', () => {
    const { result } = renderHook(() => useAutoMatchSelection(GROUPS, AMB_AI));
    expect(result.current.isChecked(AMBIGUOUS)).toBe(false);
    act(() => result.current.setMany([AMBIGUOUS], true));
    expect(result.current.isChecked(AMBIGUOUS)).toBe(true);
  });

  it('exposes the assessments as they came', () => {
    const { result } = renderHook(() => useAutoMatchSelection(GROUPS, AMB_AI));
    expect(result.current.assessments).toBe(AMB_AI);
    expect(renderHook(() => useAutoMatchSelection(GROUPS)).result.current.assessments).toBeNull();
  });

  it('invalidateAi drops the AI data of that rejection and its check; then it needs the panel', () => {
    const { result } = renderHook(() => useAutoMatchSelection(GROUPS, AMB_AI));
    act(() => result.current.toggle(AMBIGUOUS));
    expect(result.current.isChecked(AMBIGUOUS)).toBe(true);
    act(() => result.current.invalidateAi(AMBIGUOUS));
    expect(result.current.assessments.B3).toBeUndefined();
    expect(result.current.isChecked(AMBIGUOUS)).toBe(false);
    // No AI data left: the modal does not choose among its candidates (ETP-6359).
    act(() => result.current.toggle(AMBIGUOUS));
    expect(result.current.isChecked(AMBIGUOUS)).toBe(false);
    expect(result.current.isCheckable(AMBIGUOUS)).toBe(false);
    expect(() => act(() => result.current.invalidateAi({}))).not.toThrow();
  });

  it('a reload of the groups, or new assessments, bring the AI data back', () => {
    const { result, rerender } = renderHook(({ groups, ai }) => useAutoMatchSelection(groups, ai), {
      initialProps: { groups: GROUPS, ai: AMB_AI },
    });
    act(() => result.current.invalidateAi(AMBIGUOUS));
    rerender({ groups: GROUPS, ai: { ...AMB_AI } });
    expect(result.current.assessments.B3).toBeDefined();
    act(() => result.current.invalidateAi(AMBIGUOUS));
    rerender({ groups: [...GROUPS], ai: AMB_AI });
    expect(result.current.assessments.B3).toBeDefined();
  });
});

describe('useAutoMatchReview — the selection of the modal', () => {
  it('exposes the assessments and invalidateAi in the selection', () => {
    const { result } = renderHook(() => useAutoMatchReview(GROUPS, { bounceAiAssessments: AMB_AI }));
    expect(result.current.selection.assessments).toBe(AMB_AI);
    expect(typeof result.current.selection.invalidateAi).toBe('function');
  });

  it('checking an ambiguous pair that was sent to the panel forgets it', () => {
    const { result } = renderHook(() => useAutoMatchReview(GROUPS, { bounceAiAssessments: AMB_AI }));
    act(() => result.current.startReview(AMBIGUOUS));
    expect(result.current.sentToPanelKeys.has('bp-amb')).toBe(true);
    act(() => result.current.selection.setMany([AMBIGUOUS], true));
    expect(result.current.sentToPanelKeys.has('bp-amb')).toBe(false);
  });
});

// ── Shared outflows and panel picks (ETP-6359) ───────────────────────────────────────────────
//
// Three AI-rated rejections over the same two outflows [O1, O2], all recommending O1: two checked
// rows never share an outflow, so ticking one moves the others and the third is left with none.

const O1 = { id: 'SO1' };
const O2 = { id: 'SO2' };
const sharedPair = (key, bounceId) => ({
  kind: 'bouncePair', groupKey: key, confidence: 'review', ambiguous: true,
  statementLine: null, counterpartLine: { id: bounceId }, candidates: [{ line: O1 }, { line: O2 }],
});
const SA = sharedPair('bp-sa', 'SB-A');
const SB = sharedPair('bp-sb', 'SB-B');
const SC = sharedPair('bp-sc', 'SB-C');
const SHARED = [TX, SA, SB, SC];
const recommendO1 = (bounceId) => ({ [bounceId]: { probabilities: { SO1: 70, SO2: 20 }, none: 10, recommendedLineId: 'SO1' } });
const SHARED_AI = { ...recommendO1('SB-A'), ...recommendO1('SB-B'), ...recommendO1('SB-C') };
const shownId = (sel, group) => sel.pairOutflow(group)?.line?.id ?? null;

describe('useAutoMatchSelection — rows sharing an outflow', () => {
  it('ticking one row moves the next to the other outflow and blocks the third; unticking restores them', () => {
    const { result } = renderHook(() => useAutoMatchSelection(SHARED, SHARED_AI));
    for (const g of [SA, SB, SC]) expect(shownId(result.current, g)).toBe('SO1');

    act(() => result.current.toggle(SA));
    expect(result.current.isChecked(SA)).toBe(true);
    expect(shownId(result.current, SA)).toBe('SO1');
    expect(shownId(result.current, SB)).toBe('SO2');
    expect(result.current.pairOutflow(SB).source).toBe('user');
    expect(result.current.isCheckable(SB)).toBe(true);

    act(() => result.current.toggle(SB));
    expect(result.current.isChecked(SB)).toBe(true);
    expect(result.current.pairOutflow(SC).blocked).toBe(true);
    expect(result.current.pairOutflow(SC).line).toBeNull();
    expect(result.current.isCheckable(SC)).toBe(false);
    // A blocked row refuses a tick.
    act(() => result.current.toggle(SC));
    expect(result.current.isChecked(SC)).toBe(false);

    act(() => result.current.toggle(SB));
    expect(result.current.isCheckable(SC)).toBe(true);
    expect(shownId(result.current, SC)).toBe('SO2');
    act(() => result.current.toggle(SA));
    for (const g of [SA, SB, SC]) expect(shownId(result.current, g)).toBe('SO1');
  });

  it('select-all checks the rows one by one and skips the one left without an outflow', () => {
    const { result } = renderHook(() => useAutoMatchSelection(SHARED, SHARED_AI));
    act(() => result.current.setMany([SA, SB, SC], true));
    expect(result.current.isChecked(SA)).toBe(true);
    expect(result.current.isChecked(SB)).toBe(true);
    expect(result.current.isChecked(SC)).toBe(false);
    expect(shownId(result.current, SA)).toBe('SO1');
    expect(shownId(result.current, SB)).toBe('SO2');
    expect(result.current.pairOutflow(SC).blocked).toBe(true);
    act(() => result.current.setMany([SA, SB, SC], false));
    for (const g of [SA, SB, SC]) expect(result.current.isChecked(g)).toBe(false);
    expect(result.current.isCheckable(SC)).toBe(true);
  });

  it('select-all skips an ambiguous pair without AI data', () => {
    const { result } = renderHook(() => useAutoMatchSelection(SHARED, recommendO1('SB-A')));
    act(() => result.current.setMany([SA, SB, SC], true));
    expect(result.current.isChecked(SA)).toBe(true);
    expect(result.current.isChecked(SB)).toBe(false);
    expect(result.current.pairOutflow(SB).needsPanel).toBe(true);
  });

  it('a dismissed pair takes no outflow: its checked outflow is free again for the unchecked rows', () => {
    const { result, rerender } = renderHook(
      ({ dismissedKeys }) => useAutoMatchSelection(SHARED, SHARED_AI, { dismissedKeys }),
      { initialProps: { dismissedKeys: new Set() } },
    );
    act(() => result.current.toggle(SA));
    expect(shownId(result.current, SB)).toBe('SO2');
    rerender({ dismissedKeys: new Set(['bp-sa']) });
    expect(result.current.pairOutflow(SA)).toBeNull();
    expect(shownId(result.current, SB)).toBe('SO1');
    expect(shownId(result.current, SC)).toBe('SO1');
  });
});

describe('useAutoMatchReview — the outflow picked in the panel', () => {
  it('the panel bundle carries picks and onPick (the hook\'s pickOutflow)', () => {
    const { result } = renderHook(() => useAutoMatchReview(SHARED, { bounceAiAssessments: SHARED_AI }));
    expect(result.current.panel.onPick).toBe(result.current.pickOutflow);
    act(() => result.current.panel.onPick('SB-A', O2));
    expect(result.current.panel.picks.get('SB-A')).toBe(O2);
    expect(result.current.picks.get('SB-A')).toBe(O2);
    act(() => result.current.pickOutflow('SB-A', null));
    expect(result.current.picks.has('SB-A')).toBe(false);
  });

  it('a pick of another outflow reaches the modal row, sourced "user"', () => {
    const { result } = renderHook(() => useAutoMatchReview(SHARED, { bounceAiAssessments: SHARED_AI }));
    act(() => result.current.pickOutflow('SB-A', O2));
    expect(shownId(result.current.selection, SA)).toBe('SO2');
    expect(result.current.selection.pairOutflow(SA).source).toBe('user');
  });

  it('a pick of an outflow a checked row holds unchecks that row for good; the picked row shows it', () => {
    const { result } = renderHook(() => useAutoMatchReview(SHARED, { bounceAiAssessments: SHARED_AI }));
    act(() => result.current.selection.toggle(SA));
    act(() => result.current.pickOutflow('SB-B', O1));
    expect(result.current.selection.isChecked(SA)).toBe(false);
    expect(shownId(result.current.selection, SB)).toBe('SO1');
  });

  it('a no-AI ambiguous pair becomes checkable once its outflow is picked, sourced "user"', () => {
    const { result } = renderHook(() => useAutoMatchReview(GROUPS));
    expect(result.current.selection.isCheckable(AMBIGUOUS)).toBe(false);
    act(() => result.current.selection.toggle(AMBIGUOUS));
    expect(result.current.selection.isChecked(AMBIGUOUS)).toBe(false);
    act(() => result.current.pickOutflow('B3', { id: 'C2' }));
    expect(result.current.selection.isCheckable(AMBIGUOUS)).toBe(true);
    act(() => result.current.selection.toggle(AMBIGUOUS));
    expect(result.current.selection.isChecked(AMBIGUOUS)).toBe(true);
    expect(result.current.selection.pairOutflow(AMBIGUOUS)).toMatchObject({ line: { id: 'C2' }, source: 'user' });
  });

  it('a single-original pair re-paired in the panel shows the pick, sourced "user"', () => {
    const { result } = renderHook(() => useAutoMatchReview(GROUPS));
    act(() => result.current.pickOutflow('B2', { id: 'OTHER' }));
    expect(result.current.selection.pairOutflow(REVIEW)).toMatchObject({ line: { id: 'OTHER' }, source: 'user' });
  });

  it('picks are forgotten when the suggestions reload and when the reconciliation is left', () => {
    const { result, rerender } = renderHook(
      ({ groups, active }) => useAutoMatchReview(groups, { active }),
      { initialProps: { groups: GROUPS, active: true } },
    );
    act(() => result.current.pickOutflow('B3', { id: 'C2' }));
    rerender({ groups: [...GROUPS], active: true });
    expect(result.current.picks.size).toBe(0);
    act(() => result.current.pickOutflow('B3', { id: 'C2' }));
    rerender({ groups: [...GROUPS], active: false });
    expect(result.current.picks.size).toBe(0);
  });

  it('a dismissed pair ("No es un rechazo") frees the outflow it held for the other rows', () => {
    const { result } = renderHook(() => useAutoMatchReview(SHARED, { bounceAiAssessments: SHARED_AI }));
    act(() => result.current.selection.toggle(SA));
    expect(shownId(result.current.selection, SB)).toBe('SO2');
    act(() => result.current.dismiss('bp-sa'));
    expect(shownId(result.current.selection, SB)).toBe('SO1');
  });
});

describe('useAutoMatchReview — a stale refusal in the modal reaches the panel', () => {
  it('the panel bundle loses the AI data of that rejection, so the panel does not preselect it', () => {
    const { result } = renderHook(() => useAutoMatchReview(GROUPS, { bounceAiAssessments: AMB_AI }));
    expect(result.current.panel.aiAssessments.B3).toBeDefined();
    act(() => result.current.selection.invalidateAi(AMBIGUOUS));
    expect(result.current.panel.aiAssessments.B3).toBeUndefined();
    // The raw answer stays on the hook; only what the panel reads is filtered.
    expect(result.current.aiAssessments.B3).toBeDefined();
  });
});

// ── Final rule (ETP-6359): a tick pins its outflow; a panel pick releases what it contradicts ──

describe('useAutoMatchSelection — a tick pins the outflow the row shows', () => {
  it('tick a, tick b, untick a: b keeps the outflow it was ticked with', () => {
    const { result } = renderHook(() => useAutoMatchSelection(SHARED, SHARED_AI));
    act(() => result.current.toggle(SA));
    act(() => result.current.toggle(SB));
    expect(shownId(result.current, SB)).toBe('SO2');
    act(() => result.current.toggle(SA));
    expect(result.current.isChecked(SB)).toBe(true);
    expect(shownId(result.current, SB)).toBe('SO2');
    // Only the unchecked rows re-resolve: a and c take the outflow b does not hold.
    expect(shownId(result.current, SA)).toBe('SO1');
    expect(shownId(result.current, SC)).toBe('SO1');
  });

  it('select-all pins each pair: unchecking the first afterwards does not move the second', () => {
    const { result } = renderHook(() => useAutoMatchSelection(SHARED, SHARED_AI));
    act(() => result.current.setMany([SA, SB, SC], true));
    expect(shownId(result.current, SA)).toBe('SO1');
    expect(shownId(result.current, SB)).toBe('SO2');
    act(() => result.current.toggle(SA));
    expect(result.current.isChecked(SB)).toBe(true);
    expect(shownId(result.current, SB)).toBe('SO2');
    // SC, unchecked, now takes the outflow SA freed.
    expect(shownId(result.current, SC)).toBe('SO1');
    expect(result.current.isCheckable(SC)).toBe(true);
  });

  it('select-all in reverse order checks the first two it meets and blocks the last', () => {
    const { result } = renderHook(() => useAutoMatchSelection(SHARED, SHARED_AI));
    act(() => result.current.setMany([SC, SB, SA], true));
    expect(result.current.isChecked(SC)).toBe(true);
    expect(result.current.isChecked(SB)).toBe(true);
    expect(result.current.isChecked(SA)).toBe(false);
    expect(shownId(result.current, SC)).toBe('SO1');
    expect(shownId(result.current, SB)).toBe('SO2');
    expect(result.current.pairOutflow(SA).blocked).toBe(true);
  });

  it('the AI data turning null on rerender: a row with a panel pick keeps its check, the rest become disabled', () => {
    const { result, rerender } = renderHook(
      ({ ai, picks }) => useAutoMatchSelection(SHARED, ai, { picks }),
      { initialProps: { ai: SHARED_AI, picks: new Map([['SB-B', O2]]) } },
    );
    act(() => result.current.toggle(SA));
    act(() => result.current.toggle(SB));
    expect(shownId(result.current, SB)).toBe('SO2');
    rerender({ ai: null, picks: new Map([['SB-B', O2]]) });
    expect(result.current.isChecked(SB)).toBe(true);
    expect(shownId(result.current, SB)).toBe('SO2');
    expect(result.current.isChecked(SA)).toBe(false);
    expect(result.current.isCheckable(SA)).toBe(false);
    expect(result.current.pairOutflow(SA).needsPanel).toBe(true);
    expect(result.current.isCheckable(SC)).toBe(false);
  });
});

describe('useAutoMatchReview — a panel pick releases the checks it contradicts', () => {
  it('a pick that takes a checked row\'s outflow unchecks that row, for good', () => {
    const { result } = renderHook(() => useAutoMatchReview(SHARED, { bounceAiAssessments: SHARED_AI }));
    act(() => result.current.selection.toggle(SA));
    expect(shownId(result.current.selection, SA)).toBe('SO1');
    act(() => result.current.pickOutflow('SB-B', O1));
    expect(result.current.selection.isChecked(SA)).toBe(false);
    expect(shownId(result.current.selection, SB)).toBe('SO1');
    expect(result.current.selection.pairOutflow(SB).source).toBe('user');
    // The pick moves to O2 and frees O1: SA does not check itself again.
    act(() => result.current.pickOutflow('SB-B', O2));
    expect(result.current.selection.isChecked(SA)).toBe(false);
    expect(result.current.selection.isCheckable(SA)).toBe(true);
  });

  it('a default-checked pair re-picked in the panel comes back unchecked, showing the pick, and stays unchecked', () => {
    const { result } = renderHook(() => useAutoMatchReview(GROUPS));
    expect(result.current.selection.isChecked(HIGH)).toBe(true);
    act(() => result.current.pickOutflow('B1', { id: 'O-OTHER' }));
    expect(result.current.selection.isChecked(HIGH)).toBe(false);
    expect(result.current.selection.pairOutflow(HIGH)).toMatchObject({ line: { id: 'O-OTHER' }, source: 'user' });
    act(() => result.current.pickOutflow('B1', { id: 'O-THIRD' }));
    expect(result.current.selection.isChecked(HIGH)).toBe(false);
  });

  it('a pick equal to a default-checked pair\'s own original keeps it checked, with no source', () => {
    const { result } = renderHook(() => useAutoMatchReview(GROUPS));
    act(() => result.current.pickOutflow('B1', { id: 'O1' }));
    expect(result.current.selection.isChecked(HIGH)).toBe(true);
    expect(result.current.selection.pairOutflow(HIGH)).toMatchObject({ line: { id: 'O1' }, source: null });
  });

  it('a pick equal to the AI recommendation is a user choice', () => {
    const { result } = renderHook(() => useAutoMatchReview(SHARED, { bounceAiAssessments: SHARED_AI }));
    act(() => result.current.pickOutflow('SB-A', O1));
    expect(result.current.selection.pairOutflow(SA)).toMatchObject({ line: { id: 'SO1' }, source: 'user' });
  });
});

// ── A row the user did not see checked never checks itself again (ETP-6359) ──────────────────

describe('useAutoMatchSelection — a pair that resolves unchecked stays unchecked', () => {
  it('the AI data going null and then coming back leaves the row unchecked', () => {
    const { result, rerender } = renderHook(
      ({ ai }) => useAutoMatchSelection(SHARED, ai),
      { initialProps: { ai: SHARED_AI } },
    );
    act(() => result.current.toggle(SA));
    expect(result.current.isChecked(SA)).toBe(true);
    rerender({ ai: null });
    expect(result.current.isChecked(SA)).toBe(false);
    rerender({ ai: SHARED_AI });
    expect(result.current.isChecked(SA)).toBe(false);
    expect(result.current.isCheckable(SA)).toBe(true);
  });

  it('two default-checked pairs sharing an original: unticking the first does not tick the second, which becomes tickable', () => {
    const HIGH_TWIN = { ...HIGH, groupKey: 'bp-high-2', counterpartLine: { id: 'B9' } };
    const groups = [TX, HIGH, HIGH_TWIN];
    const { result } = renderHook(() => useAutoMatchSelection(groups));
    expect(result.current.isChecked(HIGH)).toBe(true);
    expect(result.current.isChecked(HIGH_TWIN)).toBe(false);
    expect(result.current.isCheckable(HIGH_TWIN)).toBe(false);
    act(() => result.current.toggle(HIGH));
    expect(result.current.isChecked(HIGH)).toBe(false);
    expect(result.current.isChecked(HIGH_TWIN)).toBe(false);
    expect(result.current.isCheckable(HIGH_TWIN)).toBe(true);
    act(() => result.current.toggle(HIGH_TWIN));
    expect(result.current.isChecked(HIGH_TWIN)).toBe(true);
  });

  it('with that guard in place, tick a, tick b, untick a still keeps b on O2', () => {
    const { result } = renderHook(() => useAutoMatchSelection(SHARED, SHARED_AI));
    act(() => result.current.toggle(SA));
    act(() => result.current.toggle(SB));
    act(() => result.current.toggle(SA));
    expect(result.current.isChecked(SB)).toBe(true);
    expect(shownId(result.current, SB)).toBe('SO2');
    expect(result.current.isChecked(SA)).toBe(false);
  });
});
