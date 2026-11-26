// @covers tools/app-shell/src/windows/custom/shared/RemittanceInfoBanner.jsx
import { render, screen, fireEvent } from '@testing-library/react';
import RemittanceInfoBanner, { remittancesOf } from '../RemittanceInfoBanner.jsx';

const caps = vi.hoisted(() => ({ current: { sepaRemittances: true } }));
vi.mock('@/hooks/useCapabilitiesSafe.js', () => ({ useCapabilitiesSafe: () => caps.current }));

// Interpolating translator: proves the line is built from the key AND the remittance number.
const ui = (key, params = {}) => (params.documentNo !== undefined ? `${key}(${params.documentNo})` : key);

const remitted = (extra = {}) => ({
  id: 'p1', status: 'REM_SENT', processed: true, remittanceId: 'R1', remittanceDocumentNo: '1000016', ...extra,
});

describe('remittancesOf', () => {
  it('keeps one entry per remittance, only for payments still remitted', () => {
    const payments = [
      remitted({ id: 'a', remittanceStatusLabel: 'Pendiente de envío' }),
      remitted({ id: 'b' }),
      remitted({ id: 'c', remittanceId: 'R2', remittanceDocumentNo: '1000017' }),
      // Collected: the payment came from a remittance but no longer sits in it.
      { id: 'd', status: 'RPR', processed: true, remittanceId: 'R3', remittanceDocumentNo: '1000018' },
      { id: 'e', status: 'RPAP', processed: false },
    ];
    expect(remittancesOf(payments)).toEqual([
      { id: 'R1', documentNo: '1000016', statusLabel: 'Pendiente de envío' },
      { id: 'R2', documentNo: '1000017', statusLabel: null },
    ]);
  });

  it('returns nothing without payments', () => {
    expect(remittancesOf()).toEqual([]);
    expect(remittancesOf([{ id: 'x', status: 'REM_SENT' }])).toEqual([]);
  });
});

describe('RemittanceInfoBanner', () => {
  beforeEach(() => { caps.current = { sepaRemittances: true }; });

  it('names the remittance with its status and what happens next (sales wording)', () => {
    render(<RemittanceInfoBanner payments={[remitted({ remittanceStatusLabel: 'Pendiente de envío' })]} isSales ui={ui} onOpen={vi.fn()} />);
    const line = screen.getByTestId('remittance-banner-line');
    expect(line).toHaveTextContent('invoiceRemittanceBannerTitle(1000016)');
    expect(line).toHaveTextContent('Pendiente de envío');
    expect(screen.getByTestId('remittance-banner')).toHaveTextContent('invoiceRemittanceBannerHintSales');
  });

  it('uses the purchase wording and shows only the number when the status is absent', () => {
    render(<RemittanceInfoBanner payments={[remitted()]} isSales={false} ui={ui} onOpen={vi.fn()} />);
    expect(screen.getByTestId('remittance-banner-line')).toHaveTextContent(/^invoiceRemittanceBannerTitle\(1000016\)invoiceRemittanceViewLink/);
    expect(screen.getByTestId('remittance-banner')).toHaveTextContent('invoiceRemittanceBannerHintPurchase');
  });

  it('renders one line per remittance', () => {
    render(<RemittanceInfoBanner payments={[remitted(), remitted({ id: 'p2', remittanceId: 'R2', remittanceDocumentNo: '7' })]} isSales ui={ui} onOpen={vi.fn()} />);
    expect(screen.getAllByTestId('remittance-banner-line')).toHaveLength(2);
  });

  it('opens the remittance without letting the click reach the row around it', () => {
    const onOpen = vi.fn();
    const onRowClick = vi.fn();
    render(
      <div onClick={onRowClick}>
        <RemittanceInfoBanner payments={[remitted()]} isSales ui={ui} onOpen={onOpen} />
      </div>,
    );
    fireEvent.click(screen.getByTestId('remittance-banner-open'));
    expect(onOpen).toHaveBeenCalledWith('R1');
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it('offers no «Ver remesa» without the sepaRemittances capability, but still names it', () => {
    // The remittance route is guarded by the flag: no action into a page the user cannot open.
    caps.current = {};
    render(<RemittanceInfoBanner payments={[remitted()]} isSales ui={ui} onOpen={vi.fn()} />);
    expect(screen.queryByTestId('remittance-banner-open')).toBeNull();
    expect(screen.getByTestId('remittance-banner-line')).toHaveTextContent('invoiceRemittanceBannerTitle(1000016)');
  });

  it('honours a custom testid prefix', () => {
    render(<RemittanceInfoBanner payments={[remitted()]} isSales ui={ui} onOpen={vi.fn()} testid="custom" compact />);
    expect(screen.getByTestId('custom')).toBeInTheDocument();
    expect(screen.getByTestId('custom-open')).toBeInTheDocument();
  });

  it('renders nothing when no payment is remitted', () => {
    const { container } = render(<RemittanceInfoBanner payments={[{ id: 'x', status: 'RPR', processed: true }]} isSales ui={ui} onOpen={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
});
