// @covers artifacts/sales-invoice/custom/InvoiceTopbarExtra.jsx
// The payment badge of the sales-invoice form topbar, driven by the payment plan (or, without one,
// by the header). Covers the confirmed-remittance states: a due fully in a confirmed remittance is
// the bank's to collect — neither pending nor overdue for the customer — and a partial remittance
// shows only the FREE part as owed, plus how much the remittance collects.
// Lives under app-shell because Vitest only collects `src/**` and the artifact component renders JSX.

vi.mock('@/i18n', () => ({
  // Interpolating translator, so the remitted amount is visible inside the suffix.
  useUI: () => (key, params) => (params ? `${key}(${params.amount ?? ''})` : key),
  useMenuLabel: () => (key) => key,
}));

vi.mock('@/windows/custom/shared/InvoicePaymentHistoryModal.jsx', () => ({
  default: () => <div data-testid="payment-history-modal" />,
}));

vi.mock('@/components/contract-ui/SendDocumentModal', () => ({
  default: () => <div data-testid="send-document-modal" />,
}));

vi.mock('@/windows/custom/shared/useInvoicePdf.js', () => ({
  useInvoicePdf: () => ({ pdfUrl: null, loading: false }),
}));

const mockApiFetch = vi.fn();
vi.mock('@/auth/useApiFetch.js', () => ({ useApiFetch: () => mockApiFetch }));

vi.mock('@/lib/formatCurrency.js', () => ({
  formatCurrency: (currency, amount) => `${currency}:${amount}`,
  getCurrencySymbol: () => '€',
}));

import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import InvoiceTopbarExtra from '@generated/sales-invoice/custom/InvoiceTopbarExtra.jsx';

const DATA = {
  id: 'inv-001',
  documentStatus: 'CO',
  'currency$_identifier': 'EUR',
  grandTotalAmount: 100,
  outstandingAmount: 100,
};

function answerPlan(installments) {
  mockApiFetch.mockResolvedValue({
    ok: true,
    json: async () => ({ response: { data: installments } }),
  });
}

function renderTopbar(data = DATA) {
  return render(
    <InvoiceTopbarExtra data={data} recordId="inv-001" token="tok" apiBaseUrl="/sws/neo/sales-invoice" />,
  );
}

describe('InvoiceTopbarExtra — payment badge with a confirmed remittance', () => {
  beforeEach(() => {
    mockApiFetch.mockReset();
  });

  it('shows "in remittance" with the remitted amount when everything still owed is remitted', async () => {
    answerPlan([{ amount: '100', paidAmount: '0', outstandingAmount: '100', remittedAmount: '100', daysOverdue: '0' }]);
    renderTopbar();

    const badge = await screen.findByTestId('payment-status-badge');
    expect(badge).toHaveTextContent('remittanceInvoiceChip · EUR:100');
    expect(badge).not.toHaveTextContent('statusPending');
  });

  it('never reads an overdue due as overdue when the remittance covers it', async () => {
    answerPlan([{ amount: '100', paidAmount: '0', outstandingAmount: '100', remittedAmount: '100', daysOverdue: '12' }]);
    renderTopbar();

    const badge = await screen.findByTestId('payment-status-badge');
    expect(badge).toHaveTextContent('remittanceInvoiceChip');
    expect(badge).not.toHaveTextContent('statusOverdue');
  });

  it('counts paid installments with remitted ones as "all remitted"', async () => {
    answerPlan([
      { amount: '40', paidAmount: '40', outstandingAmount: '0', daysOverdue: '0' },
      { amount: '60', paidAmount: '0', outstandingAmount: '60', remittedAmount: '60', daysOverdue: '0' },
    ]);
    renderTopbar();

    const badge = await screen.findByTestId('payment-status-badge');
    expect(badge).toHaveTextContent('remittanceInvoiceChip · EUR:60');
  });

  it('shows only the free part as pending, like any pending invoice, for a partial remittance', async () => {
    answerPlan([{ amount: '100', paidAmount: '0', outstandingAmount: '100', remittedAmount: '60', daysOverdue: '0' }]);
    renderTopbar();

    const badge = await screen.findByTestId('payment-status-badge');
    expect(badge).toHaveTextContent('statusPending · EUR:40');
    expect(badge).not.toHaveTextContent('EUR:60');
  });

  it('keeps the overdue state on the free part of a partial remittance', async () => {
    answerPlan([{ amount: '100', paidAmount: '0', outstandingAmount: '100', remittedAmount: '60', daysOverdue: '3' }]);
    renderTopbar();

    const badge = await screen.findByTestId('payment-status-badge');
    expect(badge).toHaveTextContent('statusOverdue · EUR:40');
    expect(badge).not.toHaveTextContent('EUR:60');
  });

  it('keeps the plain partial-paid label on a partial remittance', async () => {
    answerPlan([
      { amount: '50', paidAmount: '50', outstandingAmount: '0', daysOverdue: '0' },
      { amount: '50', paidAmount: '0', outstandingAmount: '50', remittedAmount: '20', daysOverdue: '0' },
    ]);
    renderTopbar();

    const badge = await screen.findByTestId('payment-status-badge');
    expect(badge).toHaveTextContent('statusPartial · EUR:50 of EUR:100');
    expect(badge).not.toHaveTextContent('EUR:20');
  });

  it('shows the plain pending label when nothing is remitted', async () => {
    answerPlan([{ amount: '100', paidAmount: '0', outstandingAmount: '100', daysOverdue: '0' }]);
    renderTopbar();

    const badge = await screen.findByTestId('payment-status-badge');
    expect(badge).toHaveTextContent('statusPending · EUR:100');
  });

  it('opens the payments modal from the remitted badge', async () => {
    answerPlan([{ amount: '100', paidAmount: '0', outstandingAmount: '100', remittedAmount: '100', daysOverdue: '0' }]);
    renderTopbar();

    fireEvent.click(await screen.findByTestId('payment-status-badge'));
    expect(screen.getByTestId('payment-history-modal')).toBeInTheDocument();
  });

  describe('header fallback (no payment plan)', () => {
    it('shows "in remittance" from etgoRemittedAmt when the whole outstanding is remitted', async () => {
      answerPlan([]);
      renderTopbar({ ...DATA, etgoRemittedAmt: 100 });

      const badge = await screen.findByTestId('payment-status-badge');
      expect(badge).toHaveTextContent('remittanceInvoiceChip · EUR:100');
    });

    it('shows only the free part as pending for a partial header remittance', async () => {
      answerPlan([]);
      renderTopbar({ ...DATA, etgoRemittedAmt: 30 });

      const badge = await screen.findByTestId('payment-status-badge');
      expect(badge).toHaveTextContent('statusPending · EUR:70');
      expect(badge).not.toHaveTextContent('EUR:30');
    });

    it('keeps the plain partial-paid header label on a partial remittance', async () => {
      answerPlan([]);
      renderTopbar({ ...DATA, outstandingAmount: 60, etgoRemittedAmt: 20 });

      const badge = await screen.findByTestId('payment-status-badge');
      expect(badge).toHaveTextContent('statusPartial · EUR:40 of EUR:100');
      expect(badge).not.toHaveTextContent('EUR:20');
    });

    it('keeps the plain pending header label without etgoRemittedAmt', async () => {
      answerPlan([]);
      renderTopbar();

      const badge = await screen.findByTestId('payment-status-badge');
      expect(badge).toHaveTextContent('statusPending · EUR:100');
    });
  });
});
