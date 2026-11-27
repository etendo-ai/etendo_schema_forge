// @covers tools/app-shell/src/windows/custom/invoice-inbox/InvoiceInboxReviewPickers.jsx
// New file justification: InvoiceInboxReviewEditing.vitest.jsx drives the REAL product drawer through the
// whole panel; the context ManualProductPicker hands the drawer (price list, date, currencies, rate) is
// only observable by stubbing the drawer, and vi.mock is file-wide, so it cannot live in that suite.
import { render, screen, fireEvent, act } from '@testing-library/react';

let drawerProps;
vi.mock('@/components/contract-ui/ProductSearchDrawer.jsx', () => ({
  default: (props) => {
    drawerProps = props;
    return props.open ? (
      <div data-testid="drawer-stub">
        <button type="button" data-testid="drawer-pick" onClick={() => props.onSelect({ id: 'P9', label: 'Tornillo', searchKey: 'T-9' })}>pick</button>
        <button type="button" data-testid="drawer-pick-empty" onClick={() => props.onSelect({})}>none</button>
        <button type="button" data-testid="drawer-pick-name" onClick={() => props.onSelect({ id: 'P8', _identifier: 'Ident' })}>ident</button>
      </div>
    ) : null;
  },
}));

import { ManualProductPicker } from '../InvoiceInboxReviewPickers.jsx';

const pricing = (over = {}) => ({
  priceListId: 'PL1', orgIso: 'EUR', docIso: 'USD', rate: 1.47, invoiceDate: '2026-08-01', ...over,
});

function mount(props = {}) {
  const onPick = vi.fn();
  render(
    <ManualProductPicker
      apiBaseUrl="/sws/neo/invoice-inbox" pricing={pricing()} fieldKey="inbox-line-0-product"
      placeholder="Buscar producto" onPick={onPick} {...props} />,
  );
  return { onPick };
}
const trigger = () => screen.getByTestId('ManualProductPicker__inbox-line-0-product');

beforeEach(() => { drawerProps = undefined; });

describe('ManualProductPicker', () => {
  it('shows the placeholder with no value and the committed label with one', () => {
    mount();
    expect(trigger()).toHaveTextContent('Buscar producto');
    expect(screen.queryByTestId('drawer-stub')).toBeNull();
  });

  it('shows the committed product label and gives the drawer the committed value', () => {
    mount({ value: 'P0', label: 'Widget A' });
    expect(trigger()).toHaveTextContent('Widget A');
    fireEvent.click(trigger());
    expect(drawerProps.value).toBe('P0');
    expect(drawerProps.valueLabel).toBe('Widget A');
  });

  it('clicking opens the shared drawer over the purchase-invoice line product selector', () => {
    mount();
    fireEvent.click(trigger());
    expect(screen.getByTestId('drawer-stub')).toBeInTheDocument();
    expect(drawerProps.open).toBe(true);
    expect(drawerProps.selectorUrl).toContain('/sws/neo/');
    expect(drawerProps.selectorUrl).toContain('purchase-invoice');
    expect(drawerProps.selectorUrl).toContain('M_Product_ID');
  });

  it('hands the drawer the purchase price context: list, date, document currency, org currency and rate', () => {
    mount();
    fireEvent.click(trigger());
    expect(drawerProps.selectorContext).toMatchObject({
      isSOTrx: 'N', priceList: 'PL1', currency: 'USD', priceCurrency: 'EUR', priceCurrencyRate: 1.47,
    });
    expect(JSON.stringify(drawerProps.selectorContext)).toContain('01-08-2026');
  });

  it('a rate of exactly 1 is passed on as a real rate', () => {
    mount({ pricing: pricing({ docIso: 'EUR', rate: 1 }) });
    fireEvent.click(trigger());
    expect(drawerProps.selectorContext.priceCurrencyRate).toBe(1);
    expect(drawerProps.selectorContext.currency).toBe('EUR');
    expect(drawerProps.selectorContext.priceCurrency).toBe('EUR');
  });

  it.each([[null], [0], [NaN]])('a rate of %s sends no priceCurrencyRate (no converted row), without an error', (rate) => {
    mount({ pricing: pricing({ rate }) });
    fireEvent.click(trigger());
    expect('priceCurrencyRate' in drawerProps.selectorContext).toBe(false);
    expect(drawerProps.selectorContext.priceList).toBe('PL1');
  });

  it('with no price list the context carries none and the drawer still opens', () => {
    mount({ pricing: pricing({ priceListId: null }) });
    fireEvent.click(trigger());
    expect('priceList' in drawerProps.selectorContext).toBe(false);
    expect(screen.getByTestId('drawer-stub')).toBeInTheDocument();
  });

  it('without currencies it sends neither currency nor priceCurrency', () => {
    mount({ pricing: pricing({ docIso: null, orgIso: null }) });
    fireEvent.click(trigger());
    expect('currency' in drawerProps.selectorContext).toBe(false);
    expect('priceCurrency' in drawerProps.selectorContext).toBe(false);
  });

  it('picking closes the drawer and reports { id, name, option }', () => {
    const { onPick } = mount();
    fireEvent.click(trigger());
    fireEvent.click(screen.getByTestId('drawer-pick'));
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith({ id: 'P9', name: 'Tornillo', option: { id: 'P9', label: 'Tornillo', searchKey: 'T-9' } });
    expect(screen.queryByTestId('drawer-stub')).toBeNull();
  });

  it('falls back to the identifier for the name', () => {
    const { onPick } = mount();
    fireEvent.click(trigger());
    fireEvent.click(screen.getByTestId('drawer-pick-name'));
    expect(onPick.mock.calls[0][0]).toMatchObject({ id: 'P8', name: 'Ident' });
  });

  it('a selection without an id closes the drawer and reports nothing', () => {
    const { onPick } = mount();
    fireEvent.click(trigger());
    fireEvent.click(screen.getByTestId('drawer-pick-empty'));
    expect(onPick).not.toHaveBeenCalled();
    expect(screen.queryByTestId('drawer-stub')).toBeNull();
  });

  it('the drawer onClose closes it without a pick', () => {
    const { onPick } = mount();
    fireEvent.click(trigger());
    act(() => drawerProps.onClose());
    expect(screen.queryByTestId('drawer-stub')).toBeNull();
    expect(onPick).not.toHaveBeenCalled();
  });
});
