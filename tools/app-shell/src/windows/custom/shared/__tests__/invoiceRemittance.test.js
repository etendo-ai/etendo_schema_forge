// @covers tools/app-shell/src/windows/custom/shared/invoiceRemittance.js
//
// The invoice side of a CONFIRMED remittance: what is still owed, how much a remittance collects and
// what is free to register as a payment. Every caller (preview card, payments modal, topbars, grids)
// reads these figures, so a wrong one here offers a payment the remittance collects a second time.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  REMITTANCE_EPSILON,
  installmentFreeAmount,
  installmentRemittedAmount,
  invoiceRemittedAmount,
  isBlockedByRemittance,
  resolvePaymentTarget,
  resolveRemittanceSummary,
  summarizeInstallmentRemittance,
} from '../invoiceRemittance.js';

describe('invoiceRemittedAmount', () => {
  it('reads the header etgoRemittedAmt, numeric or string', () => {
    assert.equal(invoiceRemittedAmount({ etgoRemittedAmt: 60 }), 60);
    assert.equal(invoiceRemittedAmount({ etgoRemittedAmt: '60.50' }), 60.5);
  });

  it('is never negative (a payment remittance may carry a signed amount)', () => {
    assert.equal(invoiceRemittedAmount({ etgoRemittedAmt: -40 }), 40);
  });

  it('reads a missing, null or unparseable field as 0 (backend that predates the column)', () => {
    assert.equal(invoiceRemittedAmount({}), 0);
    assert.equal(invoiceRemittedAmount({ etgoRemittedAmt: null }), 0);
    assert.equal(invoiceRemittedAmount({ etgoRemittedAmt: 'abc' }), 0);
    assert.equal(invoiceRemittedAmount(null), 0);
    assert.equal(invoiceRemittedAmount(undefined), 0);
  });
});

describe('installmentRemittedAmount', () => {
  it('reads remittedAmount, as an absolute value', () => {
    assert.equal(installmentRemittedAmount({ remittedAmount: 25 }), 25);
    assert.equal(installmentRemittedAmount({ remittedAmount: '-25' }), 25);
  });

  it('reads a missing field as 0', () => {
    assert.equal(installmentRemittedAmount({ outstandingAmount: 100 }), 0);
    assert.equal(installmentRemittedAmount(undefined), 0);
  });
});

describe('installmentFreeAmount', () => {
  it('is the outstanding minus the remitted part', () => {
    assert.equal(installmentFreeAmount({ outstandingAmount: 100, remittedAmount: 60 }), 40);
  });

  it('is 0 for a fully remitted installment', () => {
    assert.equal(installmentFreeAmount({ outstandingAmount: 100, remittedAmount: 100 }), 0);
  });

  it('never goes negative when the remitted part exceeds the outstanding', () => {
    assert.equal(installmentFreeAmount({ outstandingAmount: 30, remittedAmount: 100 }), 0);
  });

  it('is the full outstanding when nothing is remitted or the field is absent', () => {
    assert.equal(installmentFreeAmount({ outstandingAmount: '100' }), 100);
    assert.equal(installmentFreeAmount({ outstandingAmount: 100, remittedAmount: 0 }), 100);
  });

  it('treats a missing or negative outstanding as 0', () => {
    assert.equal(installmentFreeAmount({}), 0);
    assert.equal(installmentFreeAmount({ outstandingAmount: -20 }), 0);
  });

  it('ignores payableAmount, so a draft is not subtracted twice (callers reserve drafts themselves)', () => {
    // payableAmount = outstanding − remitted − drafts. A caller subtracting its drafts on top of it
    // would take them off twice; the free amount is the figure BEFORE drafts.
    const inst = { outstandingAmount: 100, remittedAmount: 60, payableAmount: 10 };
    assert.equal(installmentFreeAmount(inst), 40);
  });
});

describe('summarizeInstallmentRemittance', () => {
  it('adds outstanding, remitted and free across installments', () => {
    const summary = summarizeInstallmentRemittance([
      { outstandingAmount: 100, remittedAmount: 100 },
      { outstandingAmount: 50, remittedAmount: 20 },
      { outstandingAmount: '30' },
    ]);
    assert.deepEqual(summary, { outstanding: 180, remitted: 120, free: 60 });
  });

  it('caps each installment at its outstanding (free never negative per installment)', () => {
    const summary = summarizeInstallmentRemittance([
      { outstandingAmount: 10, remittedAmount: 50 },
      { outstandingAmount: 40 },
    ]);
    assert.equal(summary.free, 40);
  });

  it('is all zeros for an empty or omitted plan', () => {
    assert.deepEqual(summarizeInstallmentRemittance([]), { outstanding: 0, remitted: 0, free: 0 });
    assert.deepEqual(summarizeInstallmentRemittance(), { outstanding: 0, remitted: 0, free: 0 });
  });
});

describe('resolveRemittanceSummary', () => {
  it('uses the installments when the plan is loaded, ignoring the header fallback', () => {
    const summary = resolveRemittanceSummary(
      [{ outstandingAmount: 100, remittedAmount: 60 }],
      999,
      { etgoRemittedAmt: 999 },
    );
    assert.deepEqual(summary, { outstanding: 100, remitted: 60, free: 40 });
  });

  it('falls back to the header etgoRemittedAmt without installments', () => {
    assert.deepEqual(
      resolveRemittanceSummary([], 100, { etgoRemittedAmt: 60 }),
      { outstanding: 100, remitted: 60, free: 40 },
    );
  });

  it('caps the header remitted amount at the fallback outstanding', () => {
    assert.deepEqual(
      resolveRemittanceSummary(undefined, 50, { etgoRemittedAmt: 80 }),
      { outstanding: 50, remitted: 50, free: 0 },
    );
  });

  it('reads as nothing remitted when the header has no etgoRemittedAmt', () => {
    assert.deepEqual(
      resolveRemittanceSummary(null, '120', {}),
      { outstanding: 120, remitted: 0, free: 120 },
    );
  });

  it('treats a missing or negative fallback outstanding as 0', () => {
    assert.deepEqual(resolveRemittanceSummary([], undefined, { etgoRemittedAmt: 10 }), { outstanding: 0, remitted: 0, free: 0 });
    assert.deepEqual(resolveRemittanceSummary([], -5, null), { outstanding: 0, remitted: 0, free: 0 });
  });
});

describe('isBlockedByRemittance', () => {
  it('is true when something is owed, all of it is remitted and nothing is free', () => {
    assert.equal(isBlockedByRemittance({ outstanding: 100, remitted: 100, free: 0 }), true);
  });

  it('treats float dust below the epsilon as nothing free', () => {
    assert.equal(isBlockedByRemittance({ outstanding: 100, remitted: 100, free: REMITTANCE_EPSILON / 2 }), true);
  });

  it('is false for a partial remittance (something is still free)', () => {
    assert.equal(isBlockedByRemittance({ outstanding: 100, remitted: 60, free: 40 }), false);
  });

  it('is false when nothing is remitted', () => {
    assert.equal(isBlockedByRemittance({ outstanding: 100, remitted: 0, free: 100 }), false);
  });

  it('is false for a settled invoice (nothing owed)', () => {
    assert.equal(isBlockedByRemittance({ outstanding: 0, remitted: 0, free: 0 }), false);
  });
});

describe('resolvePaymentTarget — a new payment goes to ONE installment', () => {
  // The register action applies the payment to the installment it is sent with and, when that one is
  // partly remitted, refuses anything over its payable part. Offering the free part of the whole
  // invoice (30 + 50) on the first installment (30) made the default amount itself a 422.
  it('caps the amount at the chosen installment when the invoice has anything remitted', () => {
    const plan = [
      { id: 'i1', finPaymentScheduleID: 'S1', outstandingAmount: 100, remittedAmount: 70, payableAmount: 30 },
      { id: 'i2', finPaymentScheduleID: 'S2', outstandingAmount: 50, remittedAmount: 0, payableAmount: 50 },
    ];
    assert.deepEqual(resolvePaymentTarget(plan, 80), { amount: 30, scheduleId: 'S1' });
  });

  it('skips a fully remitted installment and targets the next free one', () => {
    const plan = [
      { id: 'i1', outstandingAmount: 100, remittedAmount: 100, payableAmount: 0 },
      { id: 'i2', outstandingAmount: 50, remittedAmount: 0, payableAmount: 50 },
    ];
    assert.deepEqual(resolvePaymentTarget(plan, 50), { amount: 50, scheduleId: 'i2' });
  });

  it('never offers more than what the drafts leave free', () => {
    const plan = [{ id: 'i1', outstandingAmount: 100, remittedAmount: 40, payableAmount: 60 }];
    assert.deepEqual(resolvePaymentTarget(plan, 20), { amount: 20, scheduleId: 'i1' });
  });

  it('keeps the pre-ETP-6247 behaviour with nothing remitted', () => {
    const plan = [
      { id: 'i1', outstandingAmount: 30, payableAmount: 30 },
      { id: 'i2', outstandingAmount: 50, payableAmount: 50 },
    ];
    assert.deepEqual(resolvePaymentTarget(plan, 80), { amount: 80, scheduleId: null });
    assert.deepEqual(resolvePaymentTarget([], 10), { amount: 10, scheduleId: null });
  });
});
