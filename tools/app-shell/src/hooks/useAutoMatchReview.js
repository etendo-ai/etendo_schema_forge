import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  defaultGroupChecked, isBouncePairGroup, isSelectableGroup, resolvePairOutflows,
  splitAutoMatchGroups,
} from '@/components/contract-ui/bouncePairs.js';

/**
 * The bounce pairs checked, in check order, and the outflow each user-checked one is pinned to:
 * the pairs checked by default (no override, no pin) first, in the order they come, then the ones
 * the user checked, oldest first (`overrides` keeps insertion order, and a re-check moves a key to
 * the end). A pair's override is `false` (unchecked) or the id of the outflow it was ticked with.
 *
 * @returns {{ checkedKeys: Array<string>, pins: Map<string, string> }}
 */
function checkedPairs(pairs, overrides) {
  const checkedKeys = pairs
    .filter((p) => !overrides.has(p.groupKey) && defaultGroupChecked(p))
    .map((p) => p.groupKey);
  const pins = new Map();
  const own = new Set(pairs.map((p) => p.groupKey));
  for (const [key, value] of overrides) {
    if (value === false || !own.has(key)) continue;
    checkedKeys.push(key);
    if (typeof value === 'string') pins.set(key, value);
  }
  return { checkedKeys, pins };
}

/** `overrides` with `key` checked, pinned to `lineId`, as the most recent check. */
function withPinnedCheck(overrides, key, lineId) {
  const next = new Map(overrides);
  next.delete(key);
  next.set(key, lineId);
  return next;
}

/**
 * Which automatch suggestions are checked, by `groupKey`.
 *
 * Only what the user changed is stored (`overrides`); everything else reads its default: every
 * transaction group checked, a bounce pair checked only with high confidence (ETP-5581), an
 * ambiguous pair NEVER checked by default (ETP-6359: ticking it excludes the outflow its row shows,
 * which discards data, so the user does it).
 *
 * The outflow each bounce pair shows, and whether it can be checked right now, is
 * {@link resolvePairOutflows} (ETP-6359), exposed as `pairOutflow(group)` and `isCheckable(group)`:
 * two checked rows never share an outflow (an unchecked row that shares the outflow of a checked one
 * moves to its next free candidate, or cannot be checked while none is left), an ambiguous pair with
 * no AI data cannot be checked until the user picks its outflow in the panel (`picks`), and the
 * outflow picked there is the one the row shows. A row that cannot be checked reads as unchecked.
 * A tick PINS the outflow the row shows at that moment: a checked row never moves when other rows
 * are ticked or unticked. `setMany` (the card's "select all") checks the pairs one by one in the
 * order given, pinning each, and skips every one that cannot be checked at that point.
 *
 * `releaseForPick(bounceLineId, line)` is called when the user picks an outflow in the panel: a
 * checked pair of that rejection whose outflow is not the pick, and any other checked pair holding
 * the picked outflow, are unchecked, for good (the user ticks them again by hand). That includes a
 * pair checked by default (high confidence) re-paired with another outflow.
 *
 * When the suggestions reload, the user's choices are dropped and every group goes back to its
 * default — what the modal always did. While nothing reloads the choices stay, so reopening the
 * modal on the same suggestions (the Automatch button after "Revisar en el panel") finds the checks
 * as they were left; a discard or a restore in the panel reloads the suggestions and so resets them.
 *
 * `assessments` is the answer's `bounceAiAssessments` WITHOUT the rejections whose AI recommendation
 * the backend refused as stale (`invalidateAi`): for those the modal shows no AI mark and no
 * recommendation, and an ambiguous pair among them cannot be checked until its outflow is picked in
 * the panel. Cleared on reload or when new assessments arrive.
 *
 * @param {Array<object>} groups the autoMatch groups
 * @param {Record<string, object>|null} [aiAssessments] the answer's `bounceAiAssessments`
 * @param {{ dismissedKeys?: Set<string>|null, picks?: Map<string, object>|null }} [options]
 *   `dismissedKeys`: pairs hidden as "No es un rechazo" (they take no outflow); `picks`: the outflow
 *   picked in the panel, by bounce line id
 * @returns {{ isChecked: (group: object) => boolean, toggle: (group: object) => void,
 *   setMany: (groups: Array<object>, checked: boolean) => void,
 *   isCheckable: (group: object) => boolean, pairOutflow: (group: object) => object|null,
 *   releaseForPick: (bounceLineId: string, line: object|null) => void,
 *   assessments: Record<string, object>|null, invalidateAi: (group: object) => void }}
 */
export function useAutoMatchSelection(groups, aiAssessments = null, { dismissedKeys = null, picks = null } = {}) {
  const [overrides, setOverrides] = useState(() => new Map());
  // Bounce line ids whose AI data was refused as stale.
  const [aiInvalidated, setAiInvalidated] = useState(() => new Set());

  useEffect(() => {
    setOverrides((prev) => (prev.size === 0 ? prev : new Map()));
  }, [groups]);
  useEffect(() => {
    setAiInvalidated((prev) => (prev.size === 0 ? prev : new Set()));
  }, [groups, aiAssessments]);

  const assessments = useMemo(() => {
    if (!aiAssessments || aiInvalidated.size === 0) return aiAssessments ?? null;
    const out = { ...aiAssessments };
    for (const id of aiInvalidated) delete out[id];
    return out;
  }, [aiAssessments, aiInvalidated]);

  // The bounce pairs that compete for outflows: every pair of the answer but the dismissed ones
  // (an excluded pair stays: its outflow is discarded, so it is still taken).
  const pairs = useMemo(
    () => splitAutoMatchGroups(groups).bouncePairs.filter((p) => !dismissedKeys?.has(p.groupKey)),
    [groups, dismissedKeys],
  );
  const planFor = useCallback(
    (ov) => resolvePairOutflows(pairs, { assessments, picks, ...checkedPairs(pairs, ov) }),
    [pairs, assessments, picks],
  );
  const plan = useMemo(() => planFor(overrides), [planFor, overrides]);

  // A row the user did not see checked never becomes checked without a user action (ETP-6359): a
  // pair that still asks to be checked (its pin, or its default) but resolves as NOT checked — its AI
  // data is gone, its pinned outflow is held elsewhere, a default pair blocked behind another — is
  // written `false`, so it does not tick itself again when the cause goes away. Guarded: it writes
  // only while the overrides are the ones this plan came from, and once written the pair no longer
  // asks, so it cannot loop.
  useEffect(() => {
    const { checkedKeys } = checkedPairs(pairs, overrides);
    const stale = checkedKeys.filter((key) => plan.get(key)?.checked === false);
    if (stale.length === 0) return;
    setOverrides((prev) => {
      if (prev !== overrides) return prev;
      const next = new Map(prev);
      for (const key of stale) next.set(key, false);
      return next;
    });
  }, [pairs, overrides, plan]);

  const isChecked = useCallback((group) => {
    if (!isSelectableGroup(group)) return false;
    const entry = isBouncePairGroup(group) ? plan.get(group.groupKey) : null;
    if (entry) return entry.checked;
    return overrides.has(group.groupKey) ? overrides.get(group.groupKey) !== false : defaultGroupChecked(group);
  }, [overrides, plan]);

  const isCheckable = useCallback((group) => {
    if (!isSelectableGroup(group)) return false;
    const entry = isBouncePairGroup(group) ? plan.get(group.groupKey) : null;
    return entry ? entry.checkable : true;
  }, [plan]);

  const pairOutflow = useCallback((group) => plan.get(group?.groupKey) ?? null, [plan]);

  const toggle = useCallback((group) => {
    if (!isSelectableGroup(group)) return;
    const key = group.groupKey;
    const entry = isBouncePairGroup(group) ? plan.get(key) : null;
    if (entry) {
      if (!entry.checked && !entry.checkable) return;
      setOverrides((prev) => (entry.checked
        ? new Map(prev).set(key, false)
        : withPinnedCheck(prev, key, entry.line.id)));
      return;
    }
    setOverrides((prev) => {
      const current = prev.has(key) ? prev.get(key) !== false : defaultGroupChecked(group);
      const next = new Map(prev);
      next.set(key, !current);
      return next;
    });
  }, [plan]);

  const setMany = useCallback((list, checked) => {
    setOverrides((prev) => {
      let next = new Map(prev);
      for (const group of list ?? []) {
        if (!isSelectableGroup(group)) continue;
        const key = group.groupKey;
        if (!checked || !isBouncePairGroup(group)) {
          next.set(key, checked);
          continue;
        }
        // One by one, so a pair whose outflows the pairs checked before it took is skipped; each is
        // pinned to the outflow it shows at that point, which no checked pair holds.
        const entry = planFor(next).get(key);
        if (!entry || entry.checked || !entry.checkable) continue;
        next = withPinnedCheck(next, key, entry.line.id);
      }
      return next;
    });
  }, [planFor]);

  // A panel pick (ETP-6359) unchecks, for good, the checked pairs it contradicts: the pair of that
  // rejection when it holds another outflow, and any other pair holding the picked one.
  const releaseForPick = useCallback((bounceLineId, line) => {
    if (bounceLineId == null || line?.id == null) return;
    const release = pairs
      .filter((pair) => {
        const entry = plan.get(pair.groupKey);
        if (!entry?.checked) return false;
        return pair.counterpartLine?.id === bounceLineId
          ? entry.line?.id !== line.id
          : entry.line?.id === line.id;
      })
      .map((pair) => pair.groupKey);
    if (release.length === 0) return;
    setOverrides((prev) => {
      const next = new Map(prev);
      for (const key of release) next.set(key, false);
      return next;
    });
  }, [pairs, plan]);

  // The backend refused the pair's AI recommendation as stale: drop its AI data and its check.
  const invalidateAi = useCallback((group) => {
    const key = group?.groupKey;
    const bounceId = group?.counterpartLine?.id;
    if (!key || !bounceId) return;
    setAiInvalidated((prev) => new Set(prev).add(bounceId));
    setOverrides((prev) => new Map(prev).set(key, false));
  }, []);

  return useMemo(
    () => ({
      isChecked, toggle, setMany, isCheckable, pairOutflow, releaseForPick, assessments, invalidateAi,
    }),
    [isChecked, toggle, setMany, isCheckable, pairOutflow, releaseForPick, assessments, invalidateAi],
  );
}

/**
 * The state the automatch modal and the reconciliation panel share around a bounce pair
 * (ETP-5581). Owned by the financial-account detail, which hosts both:
 *
 * - `selection` — the modal's checks ({@link useAutoMatchSelection}), owned here so they outlive a
 *   close of the modal while the suggestions do not reload;
 * - `startReview(group)` — "Revisar en el panel": asks the panel to select the pair's bounce line
 *   (`focus`, consumed by the panel with `consumeFocus`). The host closes the modal; there is no
 *   way back other than the Automatch button, which reopens it;
 * - `dismissedKeys` / `dismiss` — pairs the user said are not a bounce ("No es un rechazo"). Since
 *   ETP-6359 the backend persists that and never proposes the pair again; these keys only hide the
 *   pair from the panel and the modal at once, until the reload that follows the dismissal lands.
 *   `clearDismissed` forgets them: the host calls it when the automatch is recomputed (the header
 *   refresh), and the panel after "Volver a considerar como posible rechazo" (the pair may come
 *   back). The Automatch button does NOT clear them.
 *
 * - `sentToPanelKeys` — pairs sent to the panel with "Revisar en el panel" during this modal
 *   session, reported as `sent_to_panel` in the apply's `bounceDecisions` (KPI events). The session
 *   is the life of the current suggestions: a reload forgets them, like the checks. Checking a pair
 *   again (alone or with "select all") forgets it too: from then on it is a plain modal decision.
 * - `picks` / `pickOutflow(bounceLineId, line)` (ETP-6359) — the outflow the user picked for a
 *   rejection in the panel. The modal row of that rejection shows it and a tick excludes the pair
 *   with it (still subject to the shared-outflow rule, see {@link useAutoMatchSelection}). Forgotten
 *   when the suggestions reload, like the checks.
 *
 * Leaving the reconciliation (`active` turning false) drops the focus request and forgets the
 * dismissals, the pairs sent to the panel and the picks, so the next visit starts from what the
 * automatch proposes.
 *
 * `panel` bundles what the reconciliation panel needs, as one stable prop.
 *
 * @param {Array<object>} groups the autoMatch groups
 * `bounceAiAssessments` (ETP-6359) is the last automatch answer's AI layer (null when it carried
 * none); it is exposed as `aiAssessments`. `panel.aiAssessments` is the same layer minus the
 * rejections the modal saw refused as stale (`selection.assessments`), so the reconciliation panel
 * reads what the automatch brought, never calls the AI itself, and never preselects a stale pick.
 *
 * @param {{ active?: boolean, bounceAiAssessments?: object|null }} [options] `active`: the
 *   reconciliation is on screen
 * @returns {object}
 */
export function useAutoMatchReview(groups, { active = true, bounceAiAssessments = null } = {}) {
  const [focus, setFocus] = useState(null);
  const [dismissedKeys, setDismissedKeys] = useState(() => new Set());
  const [sentToPanelKeys, setSentToPanelKeys] = useState(() => new Set());
  // ETP-6359 — the outflow the user picked in the panel, by bounce line id: the modal row of that
  // rejection shows (and a tick excludes) it.
  const [picks, setPicks] = useState(() => new Map());
  const baseSelection = useAutoMatchSelection(groups, bounceAiAssessments, { dismissedKeys, picks });

  useEffect(() => {
    if (active) return;
    setFocus(null);
    setDismissedKeys((prev) => (prev.size === 0 ? prev : new Set()));
    setSentToPanelKeys((prev) => (prev.size === 0 ? prev : new Set()));
    setPicks((prev) => (prev.size === 0 ? prev : new Map()));
  }, [active]);

  // New suggestions start a new modal session: what was sent to the panel and what was picked
  // there are forgotten, as the checks are (useAutoMatchSelection).
  useEffect(() => {
    setSentToPanelKeys((prev) => (prev.size === 0 ? prev : new Set()));
    setPicks((prev) => (prev.size === 0 ? prev : new Map()));
  }, [groups]);

  // The panel's pick for a rejection (`line` null forgets it). It unchecks the modal rows it
  // contradicts (useAutoMatchSelection `releaseForPick`).
  // Read through a ref so `pickOutflow`, and with it the panel bundle, stays stable across checks.
  const releaseForPickRef = useRef(baseSelection.releaseForPick);
  releaseForPickRef.current = baseSelection.releaseForPick;
  const pickOutflow = useCallback((bounceLineId, line) => {
    if (bounceLineId == null) return;
    releaseForPickRef.current?.(bounceLineId, line);
    setPicks((prev) => {
      if (line?.id == null) {
        if (!prev.has(bounceLineId)) return prev;
        const next = new Map(prev);
        next.delete(bounceLineId);
        return next;
      }
      if (prev.get(bounceLineId)?.id === line.id) return prev;
      return new Map(prev).set(bounceLineId, line);
    });
  }, []);

  const forgetSentToPanel = useCallback((list) => {
    const keys = (list ?? []).filter(isSelectableGroup).map((g) => g.groupKey).filter(Boolean);
    if (keys.length === 0) return;
    setSentToPanelKeys((prev) => {
      if (!keys.some((k) => prev.has(k))) return prev;
      const next = new Set(prev);
      for (const k of keys) next.delete(k);
      return next;
    });
  }, []);

  // The modal's checks, with "a pair checked again is no longer sent to the panel" layered on top.
  const {
    isChecked, toggle: baseToggle, setMany: baseSetMany, isCheckable, pairOutflow, assessments,
    invalidateAi,
  } = baseSelection;
  const toggle = useCallback((group) => {
    if (!isChecked(group) && isCheckable(group)) forgetSentToPanel([group]);
    baseToggle(group);
  }, [isChecked, isCheckable, baseToggle, forgetSentToPanel]);
  const setMany = useCallback((list, checked) => {
    if (checked) forgetSentToPanel((list ?? []).filter(isCheckable));
    baseSetMany(list, checked);
  }, [baseSetMany, isCheckable, forgetSentToPanel]);
  const selection = useMemo(
    () => ({ isChecked, toggle, setMany, isCheckable, pairOutflow, assessments, invalidateAi }),
    [isChecked, toggle, setMany, isCheckable, pairOutflow, assessments, invalidateAi],
  );

  const startReview = useCallback((group) => {
    const lineId = group?.counterpartLine?.id;
    if (!lineId) return;
    // `seq` makes a second request for the same line a new request.
    setFocus((prev) => ({ lineId, seq: (prev?.seq ?? 0) + 1 }));
    const key = group?.groupKey;
    if (key) {
      setSentToPanelKeys((prev) => {
        if (prev.has(key)) return prev;
        const next = new Set(prev);
        next.add(key);
        return next;
      });
    }
  }, []);

  const consumeFocus = useCallback(() => setFocus(null), []);

  const dismiss = useCallback((groupKey) => {
    if (!groupKey) return;
    setDismissedKeys((prev) => {
      if (prev.has(groupKey)) return prev;
      const next = new Set(prev);
      next.add(groupKey);
      return next;
    });
  }, []);

  const clearDismissed = useCallback(() => {
    setDismissedKeys((prev) => (prev.size === 0 ? prev : new Set()));
  }, []);

  const aiAssessments = bounceAiAssessments ?? null;
  // The panel reads the assessments the modal uses (ETP-6359): without the rejections refused as
  // stale there, so it does not preselect a recommendation the modal already found stale.
  const panel = useMemo(() => ({
    focus, onFocusConsumed: consumeFocus, dismissedKeys, onDismiss: dismiss,
    onClearDismissed: clearDismissed, picks, onPick: pickOutflow,
    // Only when the automatch brought an AI layer: without it the bundle is what it always was.
    ...(assessments ? { aiAssessments: assessments } : {}),
  }), [focus, consumeFocus, dismissedKeys, dismiss, clearDismissed, picks, pickOutflow, assessments]);

  return {
    selection,
    startReview,
    focus,
    consumeFocus,
    dismissedKeys,
    dismiss,
    clearDismissed,
    sentToPanelKeys,
    aiAssessments,
    picks,
    pickOutflow,
    panel,
  };
}
