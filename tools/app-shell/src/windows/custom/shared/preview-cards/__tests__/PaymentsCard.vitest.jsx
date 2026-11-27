// @covers tools/app-shell/src/windows/custom/shared/preview-cards/PaymentsCard.jsx
// @covers tools/app-shell/src/windows/custom/shared/RemittanceInfoBanner.jsx
import { dateOnlyWithFormatter } from '@/test/dateOnlyMock.js';

const caps = vi.hoisted(() => ({ current: { sepaRemittances: true } }));
// The remittance banner offers «Ver remesa» only while the sepaRemittances capability is visible
// (its route is guarded by the flag); RemittanceInfoBanner.vitest.jsx covers the variant without it.
vi.mock('@/hooks/useCapabilitiesSafe.js', () => ({ useCapabilitiesSafe: () => caps.current }));

const mockNavigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock('@/i18n', () => ({
  useUI: () => (key) => key,
  useMenuLabel: () => (key) => key,
  useLocaleSwitch: () => ({ locale: 'en_US', setLocale: vi.fn() }),
}));

// Keep every real `@/lib/dateOnly` export; stub only the formatter (see the helper).
vi.mock('@/lib/dateOnly', async (importOriginal) =>
  dateOnlyWithFormatter(importOriginal, (_raw, _locale, _opts) => '1 Jan 2026'));

vi.mock('@/lib/formatAmount.js', () => ({
  formatAmount: (n) => String(n),
}));

import { render, screen, fireEvent } from '@testing-library/react';
import PaymentsCard from '../PaymentsCard.jsx';

describe('PaymentsCard', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders section title via i18n key', () => {
    render(<PaymentsCard />);
    expect(screen.getByText('previewCardPayments')).toBeInTheDocument();
  });

  it('shows loading text when loading=true', () => {
    render(<PaymentsCard loading />);
    expect(screen.getByText('loading')).toBeInTheDocument();
  });

  it('shows no-payments message when payments empty and no outstanding', () => {
    render(<PaymentsCard payments={[]} totalOutstanding={0} specName="purchase-invoice" />);
    expect(screen.getByText('noPagoYet')).toBeInTheDocument();
  });

  it('shows add-payment button when canAddPayment=true', () => {
    const onAddPayment = vi.fn();
    render(<PaymentsCard canAddPayment onAddPayment={onAddPayment} payments={[]} totalOutstanding={100} />);
    const btn = screen.getByText('previewCardAddPayment');
    expect(btn).toBeInTheDocument();
    fireEvent.click(btn);
    expect(onAddPayment).toHaveBeenCalledTimes(1);
  });

  it('shows an inert add-payment label when the drafts already reserve the outstanding', () => {
    const onAddPayment = vi.fn();
    render(
      <PaymentsCard
        addPaymentBlockedByDraft
        onAddPayment={onAddPayment}
        payments={[]}
        totalOutstanding={100}
      />,
    );
    const label = screen.getByText('previewCardAddPayment');
    expect(label).toHaveAttribute('title', 'cpAddPaymentBlockedByDraft');
    fireEvent.click(label);
    expect(onAddPayment).not.toHaveBeenCalled();
  });

  it('shows check icon when isFullyPaid=true and canAddPayment=false', () => {
    const { container } = render(<PaymentsCard isFullyPaid payments={[]} totalOutstanding={0} />);
    // Check icon from Phosphor renders as svg
    expect(container.querySelector('svg')).toBeInTheDocument();
    // No add-payment button
    expect(screen.queryByText('previewCardAddPayment')).toBeNull();
  });

  it('renders payment rows with documentNo', () => {
    const payments = [{ id: '1', amount: 200, paymentDate: '2026-01-01', documentNo: 'INV-200' }];
    render(<PaymentsCard payments={payments} currencyCode="EUR" specName="purchase-invoice" />);
    expect(screen.getByText('INV-200')).toBeInTheDocument();
    expect(screen.getByText('1 Jan 2026')).toBeInTheDocument();
  });

  it('renders payment rows using id fallback when documentNo absent', () => {
    const payments = [{ id: 'pay-42', amount: 50, paymentDate: '2026-02-01' }];
    render(<PaymentsCard payments={payments} currencyCode="USD" specName="purchase-invoice" />);
    expect(screen.getByText('pay-42')).toBeInTheDocument();
  });

  it('formats amounts > 999 with thousand dots', () => {
    const payments = [{ id: '1', amount: 1500, paymentDate: '2026-01-01', documentNo: 'INV-1500' }];
    render(<PaymentsCard payments={payments} currencyCode="EUR" specName="purchase-invoice" />);
    expect(screen.getByText(/1\.500,00/)).toBeInTheDocument();
  });

  it('shows outstanding row when totalOutstanding > 0', () => {
    const payments = [{ id: '1', amount: 100, paymentDate: '2026-01-01', documentNo: 'INV-1' }];
    render(<PaymentsCard payments={payments} currencyCode="EUR" totalOutstanding={50} specName="purchase-invoice" />);
    expect(screen.getByText('invoicePendingPayment')).toBeInTheDocument();
    // Real currency symbol, not the raw ISO code — "50,00 €", never "50,00 EUR".
    expect(screen.getByText('50,00 €')).toBeInTheDocument();
    expect(screen.queryByText(/EUR/)).toBeNull();
  });

  it('renders the row amount with the real currency symbol, not the raw ISO code', () => {
    const payments = [{ id: '1', amount: 1500, paymentDate: '2026-01-01', documentNo: 'INV-1500' }];
    render(<PaymentsCard payments={payments} currencyCode="EUR" specName="purchase-invoice" />);
    expect(screen.getByText(/1\.500,00\s€/)).toBeInTheDocument();
    expect(screen.queryByText(/EUR/)).toBeNull();
  });

  it('resolves the symbol dynamically for a non-EUR currency (USD), not hardcoded €', () => {
    const payments = [{ id: '1', amount: 200, paymentDate: '2026-01-01', documentNo: 'INV-200' }];
    render(<PaymentsCard payments={payments} currencyCode="USD" specName="purchase-invoice" />);
    expect(screen.getByText(/200,00\s\$/)).toBeInTheDocument();
    expect(screen.queryByText(/USD/)).toBeNull();
  });

  it('does not show outstanding row when totalOutstanding is 0', () => {
    const payments = [{ id: '1', amount: 100, paymentDate: '2026-01-01', documentNo: 'INV-1' }];
    render(<PaymentsCard payments={payments} currencyCode="EUR" totalOutstanding={0} specName="purchase-invoice" />);
    expect(screen.queryByText('invoicePendingPayment')).toBeNull();
  });

  describe('resolveMethodKey via rendered method icon', () => {
    // Icons are inline SVGs (no data-testid); card uses a <rect>, cash uses a
    // <rect> + <circle>, direct uses only <path>, transfer uses only <path>.
    // We disambiguate card vs cash by presence of a <circle>.
    function renderRowIcon(methodLabel) {
      const payments = [{ id: '1', amount: 10, paymentDate: '2026-01-01', documentNo: 'DOC-1', 'paymentMethod$_identifier': methodLabel }];
      return render(<PaymentsCard payments={payments} currencyCode="EUR" specName="purchase-invoice" />);
    }

    it('resolves "tarjeta" to the card icon (rect, no circle)', () => {
      const { container } = renderRowIcon('Tarjeta de crédito');
      const row = screen.getByTestId('PaymentsCard__row-0');
      const rect = row.querySelector('rect');
      expect(rect).toBeInTheDocument();
      expect(row.querySelector('circle')).toBeNull();
    });

    it('resolves "card" to the card icon', () => {
      renderRowIcon('Card payment');
      const row = screen.getByTestId('PaymentsCard__row-0');
      expect(row.querySelector('rect')).toBeInTheDocument();
      expect(row.querySelector('circle')).toBeNull();
    });

    it('resolves "efectivo" to the cash icon (rect + circle)', () => {
      renderRowIcon('Efectivo');
      const row = screen.getByTestId('PaymentsCard__row-0');
      expect(row.querySelector('rect')).toBeInTheDocument();
      expect(row.querySelector('circle')).toBeInTheDocument();
    });

    it('resolves "cash" to the cash icon', () => {
      renderRowIcon('Cash');
      const row = screen.getByTestId('PaymentsCard__row-0');
      expect(row.querySelector('rect')).toBeInTheDocument();
      expect(row.querySelector('circle')).toBeInTheDocument();
    });

    it('resolves "domiciliación" to the direct-debit icon (path only, no rect/circle)', () => {
      renderRowIcon('Domiciliación bancaria');
      const row = screen.getByTestId('PaymentsCard__row-0');
      expect(row.querySelector('rect')).toBeNull();
      expect(row.querySelector('circle')).toBeNull();
      expect(row.querySelector('path')).toBeInTheDocument();
    });

    it('resolves "direct" to the direct-debit icon', () => {
      renderRowIcon('Direct debit');
      const row = screen.getByTestId('PaymentsCard__row-0');
      expect(row.querySelector('rect')).toBeNull();
      expect(row.querySelector('circle')).toBeNull();
      expect(row.querySelector('path')).toBeInTheDocument();
    });
  });

  describe('titleRight priority', () => {
    it('shows the creditBalance badge when isCreditNote=true, even if canAddPayment and isFullyPaid are also true', () => {
      render(
        <PaymentsCard
          isCreditNote
          canAddPayment
          isFullyPaid
          payments={[]}
          totalOutstanding={0}
        />,
      );
      expect(screen.getByText('creditBalance')).toBeInTheDocument();
      expect(screen.queryByText('previewCardAddPayment')).toBeNull();
      expect(screen.queryByText('cobrada')).toBeNull();
      expect(screen.queryByText('pagada')).toBeNull();
    });
  });

  describe('empty-state labels', () => {
    it('shows noApplicationsRegistered when isCreditNote=true and there are no payments', () => {
      render(<PaymentsCard isCreditNote payments={[]} totalOutstanding={0} />);
      expect(screen.getByText('noApplicationsRegistered')).toBeInTheDocument();
    });

    it('shows noCobroYet when isCreditNote=false and specName is sales-invoice', () => {
      render(<PaymentsCard payments={[]} totalOutstanding={0} specName="sales-invoice" />);
      expect(screen.getByText('noCobroYet')).toBeInTheDocument();
    });
  });

  describe('StateTag deposited/draft', () => {
    it('shows statusDeposited when the payment is processed', () => {
      const payments = [{ id: '1', amount: 10, paymentDate: '2026-01-01', documentNo: 'DOC-1', processed: true }];
      render(<PaymentsCard payments={payments} currencyCode="EUR" specName="purchase-invoice" />);
      expect(screen.getByText('statusDeposited')).toBeInTheDocument();
    });

    it('shows statusDeposited when the status is in the paid-statuses whitelist', () => {
      const payments = [{ id: '1', amount: 10, paymentDate: '2026-01-01', documentNo: 'DOC-1', status: 'RPR' }];
      render(<PaymentsCard payments={payments} currencyCode="EUR" specName="purchase-invoice" />);
      expect(screen.getByText('statusDeposited')).toBeInTheDocument();
    });

    it('shows statusDraft when the payment is neither processed nor in the whitelist', () => {
      const payments = [{ id: '1', amount: 10, paymentDate: '2026-01-01', documentNo: 'DOC-1', status: 'DR' }];
      render(<PaymentsCard payments={payments} currencyCode="EUR" specName="purchase-invoice" />);
      expect(screen.getByText('statusDraft')).toBeInTheDocument();
    });

    it('shows a bank transfer the bank only authorized as in progress, not deposited (ETP-4895)', () => {
      // This card and the invoice's payment modal are fed by the same invoicePayments action, so
      // they see the identical row — yet this one used to read "Depositado" for a transfer the
      // modal was already reporting as "Pago en progreso".
      const payments = [{ id: '1', amount: 10, paymentDate: '2026-01-01', documentNo: 'DOC-1', status: 'PPM', processed: true, viaPis: true, pisPending: true }];
      render(<PaymentsCard payments={payments} currencyCode="EUR" specName="purchase-invoice" />);
      expect(screen.getByTestId('payments-card-state-in-progress')).toHaveTextContent('cpPaymentStateInProgress');
      expect(screen.queryByText('statusDeposited')).toBeNull();
    });

    it('goes back to deposited once the transfer is executed and the bank transaction exists', () => {
      // Core moves the payment off PPM to PWNC when the withdrawal is recorded, so no extra
      // signal is needed for the reverse direction.
      const payments = [{ id: '1', amount: 10, paymentDate: '2026-01-01', documentNo: 'DOC-1', status: 'PWNC', processed: true, viaPis: true, pisPending: false }];
      render(<PaymentsCard payments={payments} currencyCode="EUR" specName="purchase-invoice" />);
      expect(screen.getByText('statusDeposited')).toBeInTheDocument();
    });

    it('shows a rejected bank transfer as an error', () => {
      const payments = [{ id: '1', amount: 10, paymentDate: '2026-01-01', documentNo: 'DOC-1', status: 'ETGOERR' }];
      render(<PaymentsCard payments={payments} currencyCode="EUR" specName="purchase-invoice" />);
      expect(screen.getByTestId('payments-card-state-error')).toHaveTextContent('cpPaymentStateError');
    });
  });

  // ETP-6247 — a remittance RETURN voids the collected payment (RPVOID); the invoice is pending again.
  describe('returned (voided) payment', () => {
    const VOIDED = {
      id: 'pay-v', amount: '55.66', appliedToInvoice: '27.83', paymentDate: '2026-01-01', documentNo: '1000109',
      status: 'RPVOID', processed: true,
    };

    it('shows an RPVOID payment as voided, never as deposited', () => {
      render(<PaymentsCard payments={[VOIDED]} currencyCode="EUR" specName="sales-invoice" />);
      expect(screen.getByTestId('payments-card-state-voided')).toHaveTextContent('statusVoid');
      expect(screen.queryByTestId('payments-card-state-deposited')).toBeNull();
    });

    it("shows this invoice's share, unsigned and struck through", () => {
      render(<PaymentsCard payments={[VOIDED]} currencyCode="EUR" specName="sales-invoice" />);
      const amount = screen.getByTestId('PaymentsCard__amount-0');
      expect(amount).toHaveTextContent('27,83 €');
      expect(amount).not.toHaveTextContent('55,66');
      expect(amount).not.toHaveTextContent('+');
      expect(amount.style.textDecoration).toBe('line-through');
    });
  });

  it("shows a grouped payment's share of this invoice, not the payment's total (ETP-6247)", () => {
    const payments = [{ id: 'g1', amount: '55.66', appliedToInvoice: '27.83', paymentDate: '2026-01-01', documentNo: 'G-1', status: 'RPR', processed: true }];
    render(<PaymentsCard payments={payments} currencyCode="EUR" specName="sales-invoice" />);
    const amount = screen.getByTestId('PaymentsCard__amount-0');
    expect(amount).toHaveTextContent('+ 27,83 €');
    expect(amount.style.textDecoration).toBe('');
  });

  describe('confirmed remittance', () => {
    const REMITTED = {
      id: 'pay-r', amount: 60, paymentDate: '2026-01-01', documentNo: 'PAY-R', status: 'REM_SENT', processed: true,
      remittanceId: 'rem-1', remittanceDocumentNo: '1000123',
    };

    it('shows a REM_SENT payment as remitted, never as deposited', () => {
      render(<PaymentsCard payments={[REMITTED]} currencyCode="EUR" specName="sales-invoice" />);
      expect(screen.getByTestId('payments-card-state-remitted')).toHaveTextContent('statusRemSent');
      expect(screen.queryByText('statusDeposited')).toBeNull();
    });

    it('shows a compact remittance banner whose «Ver remesa» opens it without opening the payment', () => {
      render(<PaymentsCard payments={[{ ...REMITTED, remittanceStatusLabel: 'Pendiente de envío' }]} currencyCode="EUR" specName="sales-invoice" />);
      const banner = screen.getByTestId('PaymentsCard__remittance-banner');
      expect(banner).toHaveTextContent('invoiceRemittanceBannerTitle');
      expect(banner).toHaveTextContent('Pendiente de envío');
      fireEvent.click(screen.getByTestId('PaymentsCard__remittance-banner-open'));
      expect(mockNavigate).toHaveBeenCalledTimes(1);
      expect(mockNavigate).toHaveBeenCalledWith('/remittance/rem-1');
    });

    it('shows the remittance as the method and the amount neutral, without a sign', () => {
      render(<PaymentsCard payments={[REMITTED]} currencyCode="EUR" specName="sales-invoice" />);
      expect(screen.getByTestId('PaymentsCard__remittance-method-0')).toHaveTextContent('remittancePaymentLink');
      expect(screen.getByTestId('PaymentsCard__row-0')).not.toHaveTextContent('+ ');
    });

    it('renders no banner and no remittance method for a payment that came from no remittance', () => {
      const payments = [{ id: '1', amount: 10, paymentDate: '2026-01-01', documentNo: 'DOC-1', processed: true }];
      render(<PaymentsCard payments={payments} currencyCode="EUR" specName="sales-invoice" />);
      expect(screen.queryByTestId('PaymentsCard__remittance-banner')).toBeNull();
      expect(screen.queryByTestId('PaymentsCard__remittance-method-0')).toBeNull();
    });

    it('splits a partial remittance into a free pending row and a remitted row', () => {
      render(
        <PaymentsCard payments={[REMITTED]} currencyCode="EUR" totalOutstanding={100} totalRemitted={60} specName="sales-invoice" />,
      );
      expect(screen.getByText('invoicePendingPayment')).toBeInTheDocument();
      expect(screen.getByText('40,00 €')).toBeInTheDocument();
      const remittedRow = screen.getByTestId('PaymentsCard__remitted');
      expect(remittedRow).toHaveTextContent('remittanceInvoiceChip');
      expect(remittedRow).toHaveTextContent('60,00 €');
    });

    it('shows only the remitted row when the whole outstanding is remitted', () => {
      render(
        <PaymentsCard payments={[REMITTED]} currencyCode="EUR" totalOutstanding={100} totalRemitted={100} specName="sales-invoice" />,
      );
      expect(screen.queryByText('invoicePendingPayment')).toBeNull();
      expect(screen.getByTestId('PaymentsCard__remitted')).toHaveTextContent('100,00 €');
    });

    it('caps the remitted row at the outstanding', () => {
      render(
        <PaymentsCard payments={[REMITTED]} currencyCode="EUR" totalOutstanding={50} totalRemitted={80} specName="sales-invoice" />,
      );
      expect(screen.getByTestId('PaymentsCard__remitted')).toHaveTextContent('50,00 €');
      expect(screen.queryByText('invoicePendingPayment')).toBeNull();
    });

    it('shows no remitted row when nothing is remitted', () => {
      render(<PaymentsCard payments={[REMITTED]} currencyCode="EUR" totalOutstanding={100} specName="sales-invoice" />);
      expect(screen.queryByTestId('PaymentsCard__remitted')).toBeNull();
      expect(screen.getByText('100,00 €')).toBeInTheDocument();
    });

    it('shows no add action at all when the remittance blocks it', () => {
      // Nothing the user does here unblocks it, and the banner says what happens next.
      render(
        <PaymentsCard addPaymentBlockedByRemittance payments={[]} totalOutstanding={100} specName="sales-invoice" />,
      );
      expect(screen.queryByText('previewCardAddCollection')).toBeNull();
      expect(screen.queryByTestId('payments-card-add-blocked-draft')).toBeNull();
    });

    it('gives the remittance block priority over the draft one', () => {
      render(
        <PaymentsCard addPaymentBlockedByRemittance addPaymentBlockedByDraft payments={[]} totalOutstanding={100} />,
      );
      expect(screen.queryByTestId('payments-card-add-blocked-draft')).toBeNull();
    });

    it('keeps the draft reason and its testid when only the drafts block it', () => {
      render(<PaymentsCard addPaymentBlockedByDraft payments={[]} totalOutstanding={100} />);
      expect(screen.getByTestId('payments-card-add-blocked-draft')).toHaveAttribute('title', 'cpAddPaymentBlockedByDraft');
    });
  });

  describe('row click navigation', () => {
    it('navigates to /payment-in/{id} when specName is sales-invoice', () => {
      const payments = [{ id: 'pay-9', amount: 10, paymentDate: '2026-01-01', documentNo: 'DOC-9' }];
      render(<PaymentsCard payments={payments} currencyCode="EUR" specName="sales-invoice" />);
      fireEvent.click(screen.getByTestId('PaymentsCard__row-0'));
      expect(mockNavigate).toHaveBeenCalledWith('/payment-in/pay-9');
    });

    it('navigates to /payment-out/{id} when specName is not sales-invoice', () => {
      const payments = [{ id: 'pay-8', amount: 10, paymentDate: '2026-01-01', documentNo: 'DOC-8' }];
      render(<PaymentsCard payments={payments} currencyCode="EUR" specName="purchase-invoice" />);
      fireEvent.click(screen.getByTestId('PaymentsCard__row-0'));
      expect(mockNavigate).toHaveBeenCalledWith('/payment-out/pay-8');
    });
  });
});
