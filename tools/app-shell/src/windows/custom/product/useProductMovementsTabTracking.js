import { useCallback, useEffect, useRef } from 'react';
import {
  PRODUCT_MOVEMENTS_FILTER_TYPES,
  trackProductMovementsFiltered,
  trackProductMovementsSorted,
  trackProductMovementsTabOpened,
} from '@/lib/productUsageTelemetry.js';

/**
 * ETP-5889 — records one `product_movements_tab_opened` each time the Movements tab is shown.
 *
 * `DetailView` mounts every custom tab as soon as a record opens and only hides the inactive ones
 * (`display: none`), handing each an `isActive` flag. Firing on mount would therefore count every
 * product opened, whether or not anybody looked at this tab, so the event follows `isActive`
 * instead: a tab that becomes active, or that is already active when it mounts (landing on it
 * through `openSecondaryTab`), is one opening. Staying active across re-renders is not.
 *
 * `source` says how the user got here: 'tab' (the default) or 'side_panel_link'.
 */
export function useProductMovementsTabTracking({
  isActive,
  source = 'tab',
  entity = 'product',
  specName = 'product',
} = {}) {
  const wasActive = useRef(false);

  useEffect(() => {
    if (isActive && !wasActive.current) {
      trackProductMovementsTabOpened({ entity, specName, source });
    }
    wasActive.current = Boolean(isActive);
  }, [isActive, entity, specName, source]);
}

// ETP-5889 (MV-59) — `filter_value` of the direction filter: the Spanish words the KPI dashboards use.
export const MOVEMENTS_DIRECTION_EVENT_VALUES = Object.freeze({ all: 'todos', in: 'entradas', out: 'salidas' });
// `filter_value` of a period the user picked as a custom range (not a preset). The date picker reports "all time"
// as a cleared period (null), which is sent under its preset key.
export const MOVEMENTS_CUSTOM_PERIOD_VALUE = 'custom';
export const MOVEMENTS_ALL_TIME_PERIOD_VALUE = 'allTime';
// `filter_value` of the warehouse filter: 'all' without a warehouse, 'specific' with one. Never the warehouse id: like
// `product_movements_tab_opened`, the event carries no record identifiers.
export const MOVEMENTS_ALL_WAREHOUSES_VALUE = 'all';
export const MOVEMENTS_SPECIFIC_WAREHOUSE_VALUE = 'specific';

/** The event value of a period: its preset key, 'custom' for a range, 'allTime' when cleared (null). */
export function movementsPeriodEventValue(range) {
  if (!range) return MOVEMENTS_ALL_TIME_PERIOD_VALUE;
  return range.presetId ?? MOVEMENTS_CUSTOM_PERIOD_VALUE;
}

/** Two periods are the same selection: same preset, or same custom ends (by calendar time). */
function samePeriod(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.presetId || b.presetId) return a.presetId === b.presetId;
  return new Date(a.from).getTime() === new Date(b.from).getTime()
    && new Date(a.to).getTime() === new Date(b.to).getTime();
}

/**
 * ETP-5889 (MV-59 / MV-60) — one `product_movements_filtered` / `product_movements_sorted` per change the
 * USER makes in the Movements tab. The tab calls these from its own handlers only, so the first load, a
 * period applied by the side panel's "Ver movimientos" link and a product change (none of them go
 * through these) never count; selecting the value that is already active does not either.
 * `current` is what is on screen right now ({ direction, dateRange, warehouseId }); the returned
 * callbacks are stable and read it through a ref.
 */
export function useProductMovementsChangeTracking({
  current,
  entity = 'product',
  specName = 'product',
} = {}) {
  const currentRef = useRef(current);
  currentRef.current = current;

  const filtered = useCallback((filterType, filterValue) => {
    trackProductMovementsFiltered({ entity, specName, filterType, filterValue });
  }, [entity, specName]);

  const direction = useCallback((next) => {
    if (next === currentRef.current?.direction) return;
    filtered(PRODUCT_MOVEMENTS_FILTER_TYPES.DIRECTION, MOVEMENTS_DIRECTION_EVENT_VALUES[next] ?? next);
  }, [filtered]);

  const period = useCallback((next) => {
    if (samePeriod(next, currentRef.current?.dateRange)) return;
    filtered(PRODUCT_MOVEMENTS_FILTER_TYPES.PERIOD, movementsPeriodEventValue(next));
  }, [filtered]);

  const warehouse = useCallback((nextId) => {
    if ((nextId ?? null) === (currentRef.current?.warehouseId ?? null)) return;
    filtered(PRODUCT_MOVEMENTS_FILTER_TYPES.WAREHOUSE, nextId ? MOVEMENTS_SPECIFIC_WAREHOUSE_VALUE : MOVEMENTS_ALL_WAREHOUSES_VALUE);
  }, [filtered]);

  const sorted = useCallback((sortColumn, sortDirection) => {
    trackProductMovementsSorted({ entity, specName, sortColumn, sortDirection });
  }, [entity, specName]);

  return { direction, period, warehouse, sorted };
}
