// @covers artifacts/sales-invoice/custom/InvoiceDeliveryBadge.jsx
// @covers artifacts/sales-invoice/custom/InvoiceHeaderTable.jsx
// A sales rectificative invoice has no delivery to track (the backend counts the
// return receipt as a delivery), so neither the detail topbar chip nor the list
// "delivered" cell is shown for it; an ordinary invoice (FAC) keeps both.
// Lives under app-shell because Vitest only collects `src/**` and these
// artifact components render JSX.

let capturedColumns = null;

vi.mock('@/components/contract-ui', () => ({
  DataTable: ({ columns }) => {
    capturedColumns = columns;
    return <div data-testid="data-table" />;
  },
}));

vi.mock('@/i18n', () => ({
  useUI: () => (key) => key,
  useLabel: () => (key) => key,
  useMenuLabel: () => (key) => key,
  useLocale: () => ({ genericLabels: {}, statuses: {} }),
  useLocaleSwitch: () => ({ locale: 'en_US', setLocale: vi.fn() }),
}));

vi.mock('@/auth/AuthContext.jsx', () => ({
  useAuth: () => ({ selectedOrg: { id: 'org-1' }, logout: vi.fn() }),
}));

vi.mock('@/windows/custom/fiscal-config/useFiscalConfig.js', () => ({
  useFiscalConfig: () => ({ profile: null, earliestSiiCutoverDate: null, earliestVerifactuCutoverDate: null }),
}));

vi.mock('@/windows/custom/shared/InvoicePaymentHistoryModal.jsx', () => ({
  default: () => <div data-testid="payment-history-modal" />,
}));

import { render, screen, fireEvent, within } from '@testing-library/react';
import InvoiceDeliveryBadge from '@generated/sales-invoice/custom/InvoiceDeliveryBadge.jsx';
import InvoiceHeaderTable from '@generated/sales-invoice/custom/InvoiceHeaderTable.jsx';

const FAC = { arInvoiceSubtype: 'FAC', documentStatus: 'CO', eTGODeliveryStatus: 60 };
const RECTIFICATIVA = { ...FAC, arInvoiceSubtype: 'RECTIFICATIVA' };

describe('InvoiceDeliveryBadge', () => {
  it('renders the delivery chip for a completed ordinary invoice', () => {
    render(<InvoiceDeliveryBadge data={FAC} />);
    expect(screen.getByTestId('delivery-badge')).toHaveTextContent('soAllDelivered 60%');
  });

  it('renders nothing for a completed rectificative invoice', () => {
    render(<InvoiceDeliveryBadge data={RECTIFICATIVA} />);
    expect(screen.queryByTestId('delivery-badge')).not.toBeInTheDocument();
  });
});

describe('InvoiceHeaderTable — delivery status column', () => {
  function deliveryColumn() {
    capturedColumns = null;
    render(<InvoiceHeaderTable apiBaseUrl="/api" />);
    return capturedColumns.find((c) => c.key === 'eTGODeliveryStatus');
  }

  it('stays a real percent column so it remains filterable and sortable', () => {
    const col = deliveryColumn();
    expect(col).toMatchObject({ column: 'em_etgo_delivery_status', type: 'percent' });
  });

  it.each([
    ['FAC', FAC, '60%'],
    ['RECTIFICATIVA', RECTIFICATIVA, null],
  ])('renders the delivery cell of a %s row', (_label, row, expectedText) => {
    const col = deliveryColumn();
    render(<div data-testid="cell">{col.render(row)}</div>);
    const cell = screen.getByTestId('cell');
    if (expectedText) {
      expect(cell).toHaveTextContent(expectedText);
    } else {
      expect(cell).toBeEmptyDOMElement();
    }
  });
});

// A confirmed remittance: the remitted part is the bank's to collect, so the list neither offers it
// as an amount to register nor paints its due date as overdue.
describe('InvoiceHeaderTable — confirmed remittance', () => {
  // A past due date: without the remittance it reads overdue.
  const PENDING = {
    documentStatus: 'CO', grandTotalAmount: '100', outstandingAmount: '100',
    eTGODueDate: '2020-01-01', 'currency$_identifier': 'EUR',
  };

  function renderCell(key, row) {
    capturedColumns = null;
    render(<InvoiceHeaderTable apiBaseUrl="/api" />);
    const col = capturedColumns.find((c) => c.key === key);
    const { container } = render(<div>{col.render(row)}</div>);
    return { container, ...within(container) };
  }

  it('shows the "in remittance" chip, no amount, when the whole outstanding is remitted', () => {
    const { getByTestId, container } = renderCell('outstandingAmount', { ...PENDING, etgoRemittedAmt: '100' });
    expect(getByTestId('invoice-remitted')).toHaveTextContent('remittanceInvoiceChip');
    expect(container.textContent).not.toMatch(/100,00/);
  });

  it('opens the payments modal from the remitted chip', () => {
    const { getByTestId } = renderCell('outstandingAmount', { ...PENDING, etgoRemittedAmt: '100' });
    fireEvent.click(getByTestId('invoice-remitted'));
    expect(screen.getByTestId('payment-history-modal')).toBeInTheDocument();
  });

  it('shows the free part plus the remitted suffix for a partial remittance', () => {
    const { getByTestId } = renderCell('outstandingAmount', { ...PENDING, etgoRemittedAmt: '60' });
    const pill = getByTestId('invoice-partially-remitted');
    expect(pill).toHaveTextContent('40,00 €');
    expect(pill).toHaveTextContent('remittanceInvoiceRemittedSuffix');
  });

  it('keeps the plain pending amount when nothing is remitted', () => {
    const { container, queryByTestId } = renderCell('outstandingAmount', PENDING);
    expect(queryByTestId('invoice-remitted')).toBeNull();
    expect(queryByTestId('invoice-partially-remitted')).toBeNull();
    expect(container).toHaveTextContent('100,00 €');
  });

  it('paints a fully remitted overdue due with the neutral dot, not the destructive one', () => {
    const { container } = renderCell('eTGODueDate', { ...PENDING, etgoRemittedAmt: '100' });
    expect(container.querySelector('.rounded-full').style.backgroundColor).toBe('var(--status-neutral-fg)');
  });

  it('keeps the overdue dot for a partial remittance (the free part is still owed)', () => {
    const { container } = renderCell('eTGODueDate', { ...PENDING, etgoRemittedAmt: '60' });
    expect(container.querySelector('.rounded-full').style.backgroundColor).toBe('hsl(var(--destructive))');
  });
});
