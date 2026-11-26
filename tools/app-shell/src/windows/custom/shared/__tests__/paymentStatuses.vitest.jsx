// @covers tools/app-shell/src/windows/custom/shared/paymentStatuses.js
import { describe, it, expect } from 'vitest';

import {
  isPaymentProcessed, isPaymentVoided, paymentAmountOnInvoice, paymentDisplayState,
} from '../paymentStatuses';

/**
 * The four surfaces that show a payment — the invoice's payment modal, the invoice preview card,
 * the payments grid and the payment window — each used to carry its own copy of the status list.
 * That is how a single Salt Edge transfer read "Pago en progreso" in one and "Pago depositado" in
 * another at the same time (ETP-4895). These tests pin the shared rule they now all go through.
 */
describe('paymentDisplayState', () => {
  it('reads PPM as in progress: confirmed, but not withdrawn from the account yet', () => {
    // Core sets PPM when a payment is confirmed without a FIN_Finacc_Transaction. The accounts
    // Etendo Go pays from over PIS are configured without automatic withdrawal precisely so the
    // transaction only appears once Salt Edge reports the transfer executed.
    expect(paymentDisplayState({ status: 'PPM', processed: true })).toBe('inProgress');
  });

  it('reads PWNC as deposited — the withdrawal is recorded, so the money moved', () => {
    expect(paymentDisplayState({ status: 'PWNC', processed: true })).toBe('deposited');
  });

  it('trusts pisPending over the status when the backend sends it', () => {
    // Only the invoice payment-list action carries pisPending; it is the exact answer (processed,
    // initiated over PIS, no bank transaction) where the status alone can only approximate it.
    expect(paymentDisplayState({ status: 'PWNC', processed: true, pisPending: true })).toBe('inProgress');
  });

  it.each(['RPR', 'RPPC', 'RDNC', 'RPAE'])('reads %s as deposited', (status) => {
    expect(paymentDisplayState({ status, processed: true })).toBe('deposited');
  });

  it('reads a rejected bank transfer as an error, ahead of everything else', () => {
    expect(paymentDisplayState({ status: 'ETGOERR', processed: false })).toBe('error');
  });

  it.each([{ status: 'RPAP', processed: false }, {}, null])('reads %j as a draft', (payment) => {
    expect(paymentDisplayState(payment)).toBe('draft');
  });

  // ETP-6247 — REM_SENT is the payment of a confirmed remittance the bank has not collected yet. It
  // is processed, so before this it fell through to "deposited" and read "Cobro depositado" in green.
  it('reads REM_SENT as remitted, ahead of the processed check', () => {
    expect(paymentDisplayState({ status: 'REM_SENT', processed: true })).toBe('remitted');
    expect(paymentDisplayState({ status: 'REM_SENT', processed: false })).toBe('remitted');
  });

  it('keeps REM_CANCEL (settled in remittance) as deposited', () => {
    expect(paymentDisplayState({ status: 'REM_CANCEL', processed: true })).toBe('deposited');
  });

  it('counts a remitted payment as processed: the remittance owns it, it is never a draft', () => {
    expect(isPaymentProcessed({ status: 'REM_SENT', processed: false })).toBe(true);
  });

  // ETP-6247 — a remittance RETURN voids the collected payment (RPVOID). It keeps `processed`, so
  // before this it fell through to "deposited" and read "Cobro depositado" on a pending invoice.
  it('reads RPVOID as voided, ahead of the processed check — never deposited', () => {
    expect(paymentDisplayState({ status: 'RPVOID', processed: true })).toBe('voided');
    expect(paymentDisplayState({ status: 'RPVOID', processed: false })).toBe('voided');
    expect(isPaymentVoided({ status: 'RPVOID', processed: true })).toBe(true);
    expect(isPaymentVoided({ status: 'RPR', processed: true })).toBe(false);
  });

  it('counts a voided payment as processed: it is never an editable draft', () => {
    expect(isPaymentProcessed({ status: 'RPVOID', processed: false })).toBe(true);
  });

  it('keeps "in progress" separate from "still a draft": a PPM payment is processed', () => {
    // The distinction the delete-draft button and the row-click navigation depend on. Folding PPM
    // into the draft bucket would offer to delete a payment the bank has already committed to.
    expect(isPaymentProcessed({ status: 'PPM', processed: true })).toBe(true);
    expect(isPaymentProcessed({ status: 'RPAP', processed: false })).toBe(false);
  });
});

describe('paymentAmountOnInvoice', () => {
  // ETP-6247 — a remittance grouped by customer pays several invoices with ONE payment: on an
  // invoice the row must show that invoice's share, not the payment's total.
  it("prefers the invoice's share (appliedToInvoice) over the payment total", () => {
    expect(paymentAmountOnInvoice({ amount: '55.66', appliedToInvoice: '27.83' })).toBeCloseTo(27.83);
  });

  it('is unsigned: a credit-note consumption arrives negative', () => {
    expect(paymentAmountOnInvoice({ amount: '50', appliedToInvoice: -20 })).toBe(20);
  });

  it('falls back to the payment amount when the backend sends no share', () => {
    expect(paymentAmountOnInvoice({ amount: '12.5' })).toBe(12.5);
    expect(paymentAmountOnInvoice({ amount: '12.5', appliedToInvoice: null })).toBe(12.5);
    expect(paymentAmountOnInvoice({ amount: '12.5', appliedToInvoice: '' })).toBe(12.5);
  });

  it('reads a missing payment as 0', () => {
    expect(paymentAmountOnInvoice(undefined)).toBe(0);
  });
});
