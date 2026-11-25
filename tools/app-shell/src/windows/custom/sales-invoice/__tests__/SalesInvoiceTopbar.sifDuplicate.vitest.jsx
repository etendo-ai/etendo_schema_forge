// @covers tools/app-shell/src/windows/custom/sales-invoice/SalesInvoiceTopbar.jsx
// @covers artifacts/sales-invoice/custom/InvoiceTopbarExtra.jsx
// Ownership of the fiscal send action in the sales-invoice form topbar.
//
// ETP-5027: SalesInvoiceTopbar NESTS InvoiceTopbarExtra, and both used to render
// their own send button, so the toolbar showed the action twice.
// ETP-5700: the form view now offers the action ONLY from the kebab
// (SifSendMenuItem via window.customComponents.moreMenuContent, covered by
// shared/__tests__/SifSendMenuItem.vitest.jsx); the topbar renders none at all.
//
// This suite mounts the REAL SalesInvoiceTopbar with the REAL InvoiceTopbarExtra
// child under an sii+tbai profile with a completed, pending invoice — the setup in
// which a topbar send button used to render — and asserts that none does.

vi.mock('@/i18n', () => ({
  useUI: () => (key) => key,
  useLabel: () => (key) => key,
  useMenuLabel: () => (key) => key,
}));

vi.mock('@etendosoftware/app-shell-core', () => ({
  useUI: () => (key) => key,
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock('react-dom', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, createPortal: (node) => node };
});

vi.mock('@/components/contract-ui/CloneOrderModal', () => ({
  default: () => <div data-testid="clone-order-modal" />,
}));

vi.mock('@/components/contract-ui/CopyRecordLinkButton', () => ({
  default: () => <button type="button" data-testid="copy-record-link" />,
}));

vi.mock('@/components/contract-ui/SendDocumentModal', () => ({
  default: (props) => <div data-testid="send-document-modal" data-document-type={props.documentType} />,
  SendDocumentButton: (props) => (
    <button type="button" data-testid="send-document-btn" onClick={props.onClick} />
  ),
}));

vi.mock('@/windows/custom/shared/InvoicePaymentHistoryModal.jsx', () => ({
  default: () => <div data-testid="payment-history-modal" />,
}));

vi.mock('@/windows/custom/shared/useInvoicePdf.js', () => ({
  useInvoicePdf: () => ({ pdfUrl: null, loading: false }),
}));

vi.mock('@/windows/custom/shared/useInvoiceUpdatedListener.js', () => ({
  useInvoiceUpdatedListener: vi.fn(),
}));

vi.mock('@/auth/AuthContext.jsx', () => ({
  useAuth: () => ({ selectedOrg: { id: 'org-1' }, logout: vi.fn() }),
}));

// ETP-4576: InvoiceTopbarExtra reads its installments through apiFetch now, not a raw
// fetch, so this mock has to DELEGATE to the `global.fetch` stub installed in beforeEach.
// Returning a bare `vi.fn()` hands the component `undefined` instead of a response, the
// installments list comes back empty, and it takes an early return — so the
// "no send button" assertion below would pass vacuously.
vi.mock('@/auth/useApiFetch.js', () => ({
  useApiFetch: vi.fn(() => (...args) => global.fetch(...args)),
}));

// The org profile under which a send action applies — 'verifactu' never has one.
// tbaiRecord/earliestSiiCutoverDate are far in the past so neither the TBAI
// adoption-date gate (ETP-5122) nor the SII cutover-date gate (ETP-5432 #3)
// hides the button given DATA's invoiceDate/accountingDate below.
vi.mock('@/windows/custom/fiscal-config/useFiscalConfig.js', () => ({
  useFiscalConfig: vi.fn(() => ({
    profile: 'sii+tbai',
    tbaiRecord: { tbaisystemdate: '2020-01-01T00:00:00.000Z' },
    earliestSiiCutoverDate: '2020-01-01T00:00:00.000Z',
  })),
}));

vi.mock('@/lib/formatCurrency.js', () => ({
  formatCurrency: (currency, amount) => `${currency}:${amount}`,
  getCurrencySymbol: () => '€',
}));

import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import SalesInvoiceTopbar from '../SalesInvoiceTopbar.jsx';

const DATA = {
  id: 'inv-001',
  documentStatus: 'CO',
  'currency$_identifier': 'EUR',
  grandTotalAmount: 1000,
  outstandingAmount: 1000,
  aeatsiiIssent: false,
  tbaiIssent: false,
  invoiceDate: '2026-06-15',
  accountingDate: '2026-06-15',
};

// One pending installment, so InvoiceTopbarExtra reaches its main return
// branch (the one that used to own the send button) instead of an early return.
const INSTALLMENTS = [
  { amount: '1000', paidAmount: '0', outstandingAmount: '1000', daysOverdue: '0' },
];

function renderTopbar(data = DATA) {
  return render(
    <SalesInvoiceTopbar
      data={data}
      recordId="inv-001"
      token="tok"
      apiBaseUrl="/sws/neo/sales-invoice"
      api={{}}
      onProcess={vi.fn()}
      onRefresh={vi.fn()}
    />,
  );
}

describe('SalesInvoiceTopbar — fiscal send action ownership (ETP-5027, ETP-5700)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ response: { data: INSTALLMENTS } }),
    })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('renders no fiscal send button in the topbar — the form view sends from the kebab only', async () => {
    renderTopbar();

    // Wait for InvoiceTopbarExtra's installment fetch to settle, so the assertion
    // runs against its main branch rather than the loading placeholder.
    await waitFor(() => {
      expect(screen.getByTestId('payment-status-badge')).toBeInTheDocument();
    });

    expect(screen.queryAllByRole('button', { name: /^sendToSifLabel/ })).toHaveLength(0);
    // ETP-5260: "Send by email" lives in topbarSecondary, never in this tree.
    expect(screen.queryByTestId('send-document-btn')).not.toBeInTheDocument();
  });
});

// The "Enviar / Descargar" button lives in SalesInvoiceSecondaryActions and only
// dispatches 'sales-invoice:open-send-modal'; InvoiceTopbarExtra hosts the modal.
// Every non-draft branch of InvoiceTopbarExtra must render it, not only the main
// one — a credit instrument (negative total) or an invoice without installments
// used to swallow the click silently.
describe('InvoiceTopbarExtra — send modal opens on every non-draft branch', () => {
  function mockInstallments(rows) {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ response: { data: rows } }),
    })));
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function openSendModalAfterBadge() {
    await waitFor(() => {
      expect(screen.getByTestId('payment-status-badge')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('send-document-modal')).not.toBeInTheDocument();
    window.dispatchEvent(new CustomEvent('sales-invoice:open-send-modal'));
    await waitFor(() => {
      expect(screen.getByTestId('send-document-modal')).toBeInTheDocument();
    });
  }

  it('opens for a completed credit note with a negative total (credit-instrument branch)', async () => {
    mockInstallments([
      { amount: '-500', paidAmount: '0', outstandingAmount: '-500', daysOverdue: '0' },
    ]);
    renderTopbar({ ...DATA, grandTotalAmount: -500, outstandingAmount: -500 });
    await openSendModalAfterBadge();
  });

  it('opens for a completed invoice with no installments (header fallback branch)', async () => {
    mockInstallments([]);
    renderTopbar();
    await openSendModalAfterBadge();
  });

  it('opens for a completed invoice whose fallback badge renders nothing', async () => {
    mockInstallments([]);
    // Completed, outstanding 0 and total 0: no fallback badge at all (the null case).
    renderTopbar({ ...DATA, grandTotalAmount: 0, outstandingAmount: 0 });
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalled();
    });
    window.dispatchEvent(new CustomEvent('sales-invoice:open-send-modal'));
    await waitFor(() => {
      expect(screen.getByTestId('send-document-modal')).toBeInTheDocument();
    });
  });

  // ETP-6209 QA pass 2: an app send names a rectificative invoice as the module does for an MCP
  // send («Factura rectificativa» / "Credit Note"), and any other invoice by the window label.
  it.each([
    ['a rectificative invoice', { arInvoiceSubtype: 'RECTIFICATIVA', grandTotalAmount: -500, outstandingAmount: -500 }, 'sendDocumentTypeCreditNote'],
    ['a regular invoice', {}, 'Sales Invoice'],
  ])('names %s in the send modal', async (_label, overrides, expected) => {
    mockInstallments([{ amount: '1000', paidAmount: '0', outstandingAmount: '1000', daysOverdue: '0' }]);
    renderTopbar({ ...DATA, ...overrides });
    await openSendModalAfterBadge();
    expect(screen.getByTestId('send-document-modal')).toHaveAttribute('data-document-type', expected);
  });
});
