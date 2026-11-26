// @covers tools/app-shell/src/components/ui/date-range-popover.jsx
// Trigger-label contract of the shared date-range picker, and its opt-in compact layout.
//
// ETP-4956: "all time" is emitted as `value === null` (see handlePresetSelect),
// which is indistinguishable from "nothing chosen" — so the trigger label for
// that state comes from the `placeholder`, and a call site that passed a
// period-specific placeholder kept advertising that period after the user had
// widened the filter to every date. `computeTriggerLabel` now also carries an
// `allTime` entry, for the case where a consumer encodes the state as a preset
// instead of null; without it that would silently fall through to the
// placeholder — the same failure mode.
//
// The placeholder precedence itself is deliberately UNCHANGED, and asserted
// here so a future "fix" cannot quietly drop it.
//
// Note the sibling `date-range-popover.test.js` is picked up by NO runner:
// `npm test` only globs src/{lib,hooks,windows,locales}/__tests__/*.test.js and
// vitest only globs *.vitest.* / *.spec.*.
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, it, expect, beforeAll, vi } from 'vitest';

vi.mock('@/i18n', () => ({
  useUI: () => (key) => key,
  useLocaleSwitch: () => ({ locale: 'es_ES' }),
}));

import { DateRangePopover, DateRangePopoverContent, computeTriggerLabel } from '../date-range-popover.jsx';

// Radix's Popover needs pointer capture + scrollIntoView, neither of which
// jsdom implements (same polyfill the other Radix suites install).
beforeAll(() => {
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});

// Identity translator: the label IS the key, so no literal copy is asserted.
const ui = (key) => key;

describe('computeTriggerLabel — preset labels', () => {
  it('labels every preset the popover offers', () => {
    expect(computeTriggerLabel({ presetId: 'today' }, undefined, ui, 'es-ES')).toBe('dateRangeToday');
    expect(computeTriggerLabel({ presetId: 'yesterday' }, undefined, ui, 'es-ES')).toBe('dateRangeYesterday');
    expect(computeTriggerLabel({ presetId: 'last7' }, undefined, ui, 'es-ES')).toBe('dateRangeLast7Days');
    expect(computeTriggerLabel({ presetId: 'last30' }, undefined, ui, 'es-ES')).toBe('dateRangeLast30Days');
    expect(computeTriggerLabel({ presetId: 'last12m' }, undefined, ui, 'es-ES')).toBe('dateRangeLast12Months');
  });

  it('labels the opt-in last3m / last6m presets', () => {
    expect(computeTriggerLabel({ presetId: 'last3m' }, undefined, ui, 'es-ES')).toBe('dateRangeLast3Months');
    expect(computeTriggerLabel({ presetId: 'last6m' }, undefined, ui, 'es-ES')).toBe('dateRangeLast6Months');
  });

  it('labels an `allTime` preset with the all-time label, not the placeholder', () => {
    expect(computeTriggerLabel({ presetId: 'allTime' }, undefined, ui, 'es-ES')).toBe('dateRangeAllTime');
    // The defensive half of the fix: a period-specific placeholder must not win
    // over a known preset.
    expect(computeTriggerLabel({ presetId: 'allTime' }, 'dateRangeLast12Months', ui, 'es-ES'))
      .toBe('dateRangeAllTime');
  });
});

describe('computeTriggerLabel — placeholder precedence (unchanged)', () => {
  it('falls back to the placeholder when there is no value', () => {
    expect(computeTriggerLabel(null, 'pickSomething', ui, 'es-ES')).toBe('pickSomething');
    expect(computeTriggerLabel(undefined, 'pickSomething', ui, 'es-ES')).toBe('pickSomething');
  });

  it('falls back to the "All time" preset label when there is no placeholder (ETP-5591)', () => {
    expect(computeTriggerLabel(null, undefined, ui, 'es-ES')).toBe('dateRangeAllTime');
  });

  it('falls back to the placeholder for an unknown preset id', () => {
    expect(computeTriggerLabel({ presetId: 'nope' }, 'pickSomething', ui, 'es-ES')).toBe('pickSomething');
    expect(computeTriggerLabel({ presetId: 'nope' }, undefined, ui, 'es-ES')).toBe('dateRangeAllTime');
  });

  it('renders a custom { from, to } range as a formatted day span', () => {
    const label = computeTriggerLabel(
      { from: new Date(2026, 0, 5), to: new Date(2026, 0, 12) },
      'pickSomething',
      ui,
      'es-ES',
    );
    expect(label).toContain('5');
    expect(label).toContain('12');
    expect(label).toContain('–');
  });
});

/** Controlled host, the way every real call site wires the picker. */
function Host({ initial, placeholder }) {
  const [value, setValue] = useState(initial);
  return <DateRangePopover value={value} onChange={setValue} placeholder={placeholder} />;
}

describe('DateRangePopover — picking "all time" updates the trigger', () => {
  it('replaces a period trigger label with the placeholder once the range is cleared', async () => {
    const user = userEvent.setup();
    render(<Host initial={{ presetId: 'last12m' }} placeholder="dateRangeAnyTime" />);

    expect(screen.getByText('dateRangeLast12Months')).toBeInTheDocument();

    await user.click(screen.getByText('dateRangeLast12Months'));
    await user.click(await screen.findByText('dateRangeAllTime'));

    // "All time" is emitted as null, so the trigger reads the placeholder —
    // which is why the placeholder must never name a bounded period.
    expect(screen.queryByText('dateRangeLast12Months')).not.toBeInTheDocument();
    expect(screen.getByText('dateRangeAnyTime')).toBeInTheDocument();
  });

  it('keeps advertising the picked period when a bounded preset is chosen', async () => {
    const user = userEvent.setup();
    render(<Host initial={null} placeholder="dateRangeAnyTime" />);

    await user.click(screen.getByText('dateRangeAnyTime'));
    await user.click(await screen.findByText('dateRangeLast7Days'));

    expect(screen.getByText('dateRangeLast7Days')).toBeInTheDocument();
  });
});

describe('DateRangePopover — opt-in extraPresets (last3m / last6m)', () => {
  const DEFAULT_ORDER = [
    'dateRangeToday', 'dateRangeYesterday', 'dateRangeLast7Days', 'dateRangeLast30Days',
    'dateRangeLast12Months', 'dateRangeAllTime', 'dateRangeCustom',
  ];
  const optionLabels = () => screen.getAllByRole('button')
    .map((b) => b.textContent)
    .filter((t) => t.startsWith('dateRange') && !/Cancel|Apply/.test(t));

  it('keeps the default list untouched for a caller that passes nothing', async () => {
    const user = userEvent.setup();
    render(<DateRangePopover value={null} onChange={() => {}} placeholder="anyTime" />);
    await user.click(screen.getByText('anyTime'));
    await screen.findByText('dateRangeToday');
    expect(optionLabels()).toEqual(DEFAULT_ORDER);
  });

  it('inserts the two presets between last30 and last12m when opted in', async () => {
    const user = userEvent.setup();
    render(<DateRangePopover value={null} onChange={() => {}} placeholder="anyTime" extraPresets={['last3m', 'last6m']} />);
    await user.click(screen.getByText('anyTime'));
    await screen.findByText('dateRangeToday');
    expect(optionLabels()).toEqual([
      'dateRangeToday', 'dateRangeYesterday', 'dateRangeLast7Days', 'dateRangeLast30Days',
      'dateRangeLast3Months', 'dateRangeLast6Months', 'dateRangeLast12Months', 'dateRangeAllTime', 'dateRangeCustom',
    ]);
  });

  it.each([['dateRangeLast3Months', 'last3m'], ['dateRangeLast6Months', 'last6m']])(
    'selecting %s emits the %s preset and the trigger shows its label',
    async (label, presetId) => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      function Spy() {
        const [v, setV] = useState(null);
        return <DateRangePopover value={v} onChange={(x) => { onChange(x); setV(x); }} placeholder="anyTime" extraPresets={['last3m', 'last6m']} />;
      }
      render(<Spy />);
      await user.click(screen.getByText('anyTime'));
      await user.click(await screen.findByText(label));
      expect(onChange).toHaveBeenCalledWith({ presetId });
      expect(screen.getByText(label)).toBeInTheDocument();
    },
  );
});

// ETP-6209 — `layout="compact"` for a phone-width panel: wrapping preset pills, the custom range's
// two calendars stacked (each still owning its end), a full-width footer. Default stays as is.
describe('DateRangePopoverContent — layout="compact"', () => {
  it('lists the presets as pressed-state pills and hides the calendars until "custom"', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onClose = vi.fn();
    render(<DateRangePopoverContent value={{ presetId: 'last7' }} onChange={onChange} onClose={onClose} layout="compact" />);

    expect(screen.getByTestId('date-range-compact')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'dateRangeLast7Days' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'dateRangeToday' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByText('filterFrom')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'dateRangeLast30Days' }));
    expect(onChange).toHaveBeenCalledWith({ presetId: 'last30' });
    expect(onClose).toHaveBeenCalled();
  });

  it('stacks "from" over "to" for a custom range, seeded from the value, with the footer', () => {
    render(
      <DateRangePopoverContent
        value={{ from: new Date(2026, 9, 1), to: new Date(2026, 9, 31) }}
        onChange={() => {}}
        onClose={() => {}}
        layout="compact" />,
    );

    expect(screen.getByRole('button', { name: 'dateRangeCustom' })).toHaveAttribute('aria-pressed', 'true');
    const from = screen.getByText('filterFrom');
    const to = screen.getByText('filterTo');
    // eslint-disable-next-line no-bitwise
    expect(from.compareDocumentPosition(to) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole('button', { name: 'dateRangeApply' })).toBeEnabled();
  });

  it('leaves the default layout untouched (presets column, no compact wrapper)', () => {
    render(<DateRangePopoverContent value={null} onChange={() => {}} onClose={() => {}} />);
    expect(screen.queryByTestId('date-range-compact')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'dateRangeToday' })).not.toHaveAttribute('aria-pressed');
  });
});
