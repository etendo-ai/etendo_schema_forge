// @covers tools/app-shell/src/pages/portal/PortalListFilters.jsx
// @covers tools/app-shell/src/components/contract-ui/listToolbarStyles.js
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TOOLBAR_SELECT_CLASS } from '@/components/contract-ui/listToolbarStyles.js';

vi.mock('@/i18n', () => ({
  useUI: () => (key) => key,
  useLocaleSwitch: () => ({ locale: 'es_ES', setLocale: vi.fn() }),
  useLocale: () => ({ genericLabels: {}, statuses: {} }),
}));

import { PortalDateSelect, PortalTypeSelect } from '../PortalListFilters.jsx';

const ACTIVE_BORDER = 'border-primary/40';
const classTokens = (el) => new Set(el.className.split(/\s+/).filter(Boolean));

describe('PortalTypeSelect', () => {
  it.each(['ORDER', 'QUOTATION', 'SHIPMENT', undefined])('renders nothing for the single-type kind %s', (kind) => {
    const { container } = render(<PortalTypeSelect kind={kind} subtype={null} onSubtype={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('offers the invoice types and reports the picked type code, closing the popover', async () => {
    const user = userEvent.setup();
    const onSubtype = vi.fn();
    render(<PortalTypeSelect kind="INVOICE" subtype={null} onSubtype={onSubtype} />);
    const trigger = screen.getByTestId('portal-filter-type');
    expect(trigger).toHaveTextContent('allTypes');
    expect(trigger.className).not.toContain(ACTIVE_BORDER);

    await user.click(trigger);
    const listbox = await screen.findByRole('listbox');
    expect(within(listbox).getByTestId('portal-list-subtype-invoice')).toHaveTextContent('invoicesTab');
    await user.click(within(listbox).getByTestId('portal-list-subtype-creditnote'));

    expect(onSubtype).toHaveBeenCalledWith('creditNote');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('reports null when «all types» is picked', async () => {
    const user = userEvent.setup();
    const onSubtype = vi.fn();
    render(<PortalTypeSelect kind="INVOICE" subtype="creditNote" onSubtype={onSubtype} />);
    await user.click(screen.getByTestId('portal-filter-type'));
    await user.click(await screen.findByTestId('portal-list-subtype-all'));
    expect(onSubtype).toHaveBeenCalledWith(null);
  });

  it('labels the trigger with the committed type and marks it active', () => {
    render(<PortalTypeSelect kind="INVOICE" subtype="creditNote" onSubtype={vi.fn()} />);
    const trigger = screen.getByTestId('portal-filter-type');
    expect(trigger).toHaveTextContent('rectificativeInvoicesTab');
    expect(trigger.className).toContain(ACTIVE_BORDER);
  });

  it('falls back to the «all types» label for an unknown subtype', () => {
    render(<PortalTypeSelect kind="INVOICE" subtype="bogus" onSubtype={vi.fn()} />);
    expect(screen.getByTestId('portal-filter-type')).toHaveTextContent('allTypes');
  });

  it('applies the suffix to the trigger and option test ids (mobile panel)', async () => {
    const user = userEvent.setup();
    render(<PortalTypeSelect kind="INVOICE" subtype={null} onSubtype={vi.fn()} suffix="-mobile" />);
    await user.click(screen.getByTestId('portal-filter-type-mobile'));
    expect(await screen.findByTestId('portal-list-subtype-creditnote-mobile')).toBeInTheDocument();
  });

  it('filters the options accent- and case-insensitively', async () => {
    const user = userEvent.setup();
    render(<PortalTypeSelect kind="INVOICE" subtype={null} onSubtype={vi.fn()} />);
    await user.click(screen.getByTestId('portal-filter-type'));
    const listbox = await screen.findByRole('listbox');
    await user.type(screen.getByPlaceholderText(/./), 'RECTÍF');
    expect(within(listbox).getByTestId('portal-list-subtype-creditnote')).toBeInTheDocument();
    expect(within(listbox).queryByTestId('portal-list-subtype-invoice')).not.toBeInTheDocument();
  });
});

describe('PortalDateSelect', () => {
  it.each([
    [true, true],
    [false, false],
  ])('shows the active border only when active=%s', (active, bordered) => {
    render(<PortalDateSelect value={{ presetId: 'last30' }} onChange={vi.fn()} active={active} />);
    const trigger = screen.getByTestId('portal-date-range');
    expect(trigger.className.includes(ACTIVE_BORDER)).toBe(bordered);
  });

  it('labels an all-time range and reports a picked preset', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<PortalDateSelect value={null} onChange={onChange} />);
    const trigger = screen.getByTestId('portal-date-range');
    expect(trigger).toHaveTextContent('dateRangeAllTime');
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');

    await user.click(trigger);
    await user.click(await screen.findByRole('button', { name: 'dateRangeLast7Days' }));
    expect(onChange).toHaveBeenCalledWith({ presetId: 'last7' });
  });
});

describe('shared toolbar look', () => {
  it('renders both portal selector buttons with every token of the app toolbar class', () => {
    render(
      <>
        <PortalTypeSelect kind="INVOICE" subtype={null} onSubtype={vi.fn()} />
        <PortalDateSelect value={null} onChange={vi.fn()} />
      </>,
    );
    const expected = TOOLBAR_SELECT_CLASS.split(/\s+/);
    for (const testId of ['portal-filter-type', 'portal-date-range']) {
      const tokens = classTokens(screen.getByTestId(testId));
      expect(expected.filter((token) => !tokens.has(token))).toEqual([]);
    }
  });
});
