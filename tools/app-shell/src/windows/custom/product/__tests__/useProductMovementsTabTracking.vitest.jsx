// @covers tools/app-shell/src/windows/custom/product/useProductMovementsTabTracking.js
// ETP-5889 — the Movements tab is mounted with the record, hidden until selected, so the
// `product_movements_tab_opened` event must follow `isActive`, never the mount.
import { renderHook } from '@testing-library/react';

const telemetry = vi.hoisted(() => ({
  trackProductMovementsTabOpened: vi.fn(),
  trackProductMovementsFiltered: vi.fn(),
  trackProductMovementsSorted: vi.fn(),
  PRODUCT_MOVEMENTS_FILTER_TYPES: { DIRECTION: 'direction', PERIOD: 'period', WAREHOUSE: 'warehouse' },
}));
vi.mock('@/lib/productUsageTelemetry.js', () => telemetry);

import {
  movementsPeriodEventValue,
  useProductMovementsChangeTracking,
  useProductMovementsTabTracking,
} from '../useProductMovementsTabTracking';

describe('useProductMovementsTabTracking (ETP-5889)', () => {
  beforeEach(() => {
    telemetry.trackProductMovementsTabOpened.mockClear();
  });

  it('does not count a tab that is mounted but not active', () => {
    renderHook(() => useProductMovementsTabTracking({ isActive: false }));

    expect(telemetry.trackProductMovementsTabOpened).not.toHaveBeenCalled();
  });

  it('counts one opening when the tab becomes active', () => {
    const { rerender } = renderHook((props) => useProductMovementsTabTracking(props), {
      initialProps: { isActive: false },
    });

    rerender({ isActive: true });

    expect(telemetry.trackProductMovementsTabOpened).toHaveBeenCalledTimes(1);
    expect(telemetry.trackProductMovementsTabOpened).toHaveBeenCalledWith({
      entity: 'product',
      specName: 'product',
      source: 'tab',
    });
  });

  it('counts a tab that is already active when it mounts', () => {
    renderHook(() => useProductMovementsTabTracking({ isActive: true }));

    expect(telemetry.trackProductMovementsTabOpened).toHaveBeenCalledTimes(1);
  });

  it('does not count again while the tab stays active across re-renders', () => {
    const { rerender } = renderHook((props) => useProductMovementsTabTracking(props), {
      initialProps: { isActive: true },
    });

    rerender({ isActive: true });
    rerender({ isActive: true });

    expect(telemetry.trackProductMovementsTabOpened).toHaveBeenCalledTimes(1);
  });

  it('counts each new activation after the tab was left', () => {
    const { rerender } = renderHook((props) => useProductMovementsTabTracking(props), {
      initialProps: { isActive: true },
    });

    rerender({ isActive: false });
    rerender({ isActive: true });

    expect(telemetry.trackProductMovementsTabOpened).toHaveBeenCalledTimes(2);
  });

  it('reports the side panel link as the source when told so', () => {
    renderHook(() => useProductMovementsTabTracking({ isActive: true, source: 'side_panel_link' }));

    expect(telemetry.trackProductMovementsTabOpened).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'side_panel_link' }),
    );
  });

  it('emits exactly one event per opening when the source changes while the tab stays active (ETP-5908)', () => {
    const { rerender } = renderHook((props) => useProductMovementsTabTracking(props), {
      initialProps: { isActive: true, source: 'side_panel_link' },
    });
    rerender({ isActive: true, source: 'tab' });
    rerender({ isActive: true, source: 'side_panel_link' });

    expect(telemetry.trackProductMovementsTabOpened).toHaveBeenCalledTimes(1);
    expect(telemetry.trackProductMovementsTabOpened).toHaveBeenCalledWith(expect.objectContaining({ source: 'side_panel_link' }));
  });
});

describe('useProductMovementsChangeTracking (ETP-5889 MV-59 / MV-60)', () => {
  const base = { direction: 'all', dateRange: { presetId: 'last7' }, warehouseId: null };

  beforeEach(() => {
    telemetry.trackProductMovementsFiltered.mockClear();
    telemetry.trackProductMovementsSorted.mockClear();
  });

  it('maps the direction to the dashboard words and skips an unchanged one', () => {
    const { result } = renderHook(() => useProductMovementsChangeTracking({ current: base }));

    result.current.direction('all');
    result.current.direction('in');
    result.current.direction('out');

    expect(telemetry.trackProductMovementsFiltered.mock.calls.map(([a]) => [a.filterType, a.filterValue])).toEqual([
      ['direction', 'entradas'],
      ['direction', 'salidas'],
    ]);
  });

  it('reports a preset by key and a range as custom, and skips the same selection', () => {
    const range = { from: new Date(2026, 0, 1), to: new Date(2026, 0, 31) };
    const { result, rerender } = renderHook((props) => useProductMovementsChangeTracking(props), {
      initialProps: { current: { ...base, dateRange: range } },
    });

    result.current.period({ from: new Date(2026, 0, 1), to: new Date(2026, 0, 31) });
    expect(telemetry.trackProductMovementsFiltered).not.toHaveBeenCalled();

    result.current.period({ presetId: 'last30' });
    result.current.period({ from: new Date(2026, 1, 1), to: new Date(2026, 1, 2) });
    expect(telemetry.trackProductMovementsFiltered.mock.calls.map(([a]) => a.filterValue)).toEqual(['last30', 'custom']);

    rerender({ current: { ...base, dateRange: { presetId: 'last30' } } });
    result.current.period({ presetId: 'last30' });
    expect(telemetry.trackProductMovementsFiltered).toHaveBeenCalledTimes(2);
  });

    it('reports a cleared period (the all-time option of the picker) as allTime', () => {
    expect(movementsPeriodEventValue(null)).toBe('allTime');
    expect(movementsPeriodEventValue({ presetId: 'allTime' })).toBe('allTime');
  });

  it('reports "specific" for a warehouse (never its id) or "all", and skips the active one', () => {
    const { result } = renderHook(() => useProductMovementsChangeTracking({ current: { ...base, warehouseId: 'wh-1' } }));

    result.current.warehouse('wh-1');
    result.current.warehouse('wh-2');
    result.current.warehouse(null);

    expect(telemetry.trackProductMovementsFiltered.mock.calls.map(([a]) => [a.filterType, a.filterValue])).toEqual([
      ['warehouse', 'specific'],
      ['warehouse', 'all'],
    ]);
  });

  it('hands the sort straight to the telemetry with the entity and spec', () => {
    const { result } = renderHook(() => useProductMovementsChangeTracking({ current: base }));

    result.current.sorted('cost', 'desc');

    expect(telemetry.trackProductMovementsSorted).toHaveBeenCalledWith({
      entity: 'product', specName: 'product', sortColumn: 'cost', sortDirection: 'desc',
    });
  });
});
