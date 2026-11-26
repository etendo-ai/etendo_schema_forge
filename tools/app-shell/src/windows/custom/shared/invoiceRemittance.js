// ETP-6247 — what a CONFIRMED remittance means on the invoice side, in one place.
//
// Confirming a remittance makes Classic REM create one payment per due in status REM_SENT and link
// the invoice installment to it; a partial remittance links only the remitted part. The invoice
// amounts do not move: its outstanding stays full until the bank collects the remittance, so totals,
// KPIs, aging and the "pending" filters keep counting it. What the remitted part can no longer be
// is registered as a payment from the invoice — the remittance already collects it — and the
// backend refuses that registration (`ETGO_InvoiceInRemittance`).
//
// The backend exposes it in two places, and both are read here:
//   * the invoice record: `etgoRemittedAmt` (stored computed column, 0 when nothing is remitted);
//   * each `paymentPlan` installment: `remittedAmount` and `payableAmount`.
// A payload without them (a backend that predates ETP-6247, or a window whose decisions do not
// expose the column yet) reads as "nothing remitted", which is the pre-ETP-6247 behaviour.
//
// No feature-flag gate, like the backend: a REM_SENT payment only exists where a remittance was
// confirmed, i.e. where `sepa-remittances` was on. Gating the display would only hide a real
// remittance from a tenant whose flag was turned off afterwards.

/** Amounts below this are treated as zero — guards against float dust in sums. */
export const REMITTANCE_EPSILON = 0.001;

function toAmount(value) {
  const n = typeof value === 'string' ? parseFloat(value) : value;
  return Number.isFinite(n) ? n : 0;
}

/**
 * The part of an invoice that sits in a confirmed remittance, from the record's `etgoRemittedAmt`.
 *
 * @param {object} record invoice row or detail record
 * @returns {number} the remitted amount, never negative; 0 when absent
 */
export function invoiceRemittedAmount(record) {
  return Math.abs(toAmount(record?.etgoRemittedAmt));
}

/**
 * The part of one installment that sits in a confirmed remittance.
 *
 * @param {object} installment a `paymentPlan` row
 * @returns {number} the remitted amount, never negative; 0 when absent
 */
export function installmentRemittedAmount(installment) {
  return Math.abs(toAmount(installment?.remittedAmount));
}

/**
 * What a payment registered from the invoice may still take on one installment: its outstanding
 * minus the remitted part.
 *
 * Deliberately NOT the backend's `payableAmount`: that one also leaves out the details a DRAFT
 * payment already links, and every caller here subtracts the drafts itself (`freeToAllocate`, which
 * must add the edited draft's own amount back). Reading `payableAmount` would take the drafts off
 * twice. `outstanding − remitted` is the same figure before the drafts, so the two agree once the
 * caller has reserved them.
 *
 * @param {object} installment a `paymentPlan` row
 * @returns {number} never negative
 */
export function installmentFreeAmount(installment) {
  const outstanding = Math.max(0, toAmount(installment?.outstandingAmount));
  return Math.max(0, outstanding - installmentRemittedAmount(installment));
}

/**
 * The remittance view of a payment plan: what is still owed, how much of it a confirmed remittance
 * will collect, and what is free to register as a payment.
 *
 * @param {object[]} installments the invoice's `paymentPlan` rows
 * @returns {{ outstanding: number, remitted: number, free: number }}
 */
export function summarizeInstallmentRemittance(installments = []) {
  return installments.reduce((acc, installment) => ({
    outstanding: acc.outstanding + Math.max(0, toAmount(installment?.outstandingAmount)),
    remitted: acc.remitted + installmentRemittedAmount(installment),
    free: acc.free + installmentFreeAmount(installment),
  }), { outstanding: 0, remitted: 0, free: 0 });
}

/**
 * `summarizeInstallmentRemittance` when the payment plan is loaded, else the same view from the
 * invoice header: `fallbackOutstanding` with the record's `etgoRemittedAmt` (capped at it).
 *
 * @param {object[]} installments the invoice's `paymentPlan` rows (may be empty)
 * @param {number} fallbackOutstanding what the caller reads as outstanding without installments
 * @param {object} record the invoice row or detail record
 * @returns {{ outstanding: number, remitted: number, free: number }}
 */
export function resolveRemittanceSummary(installments, fallbackOutstanding, record) {
  if (Array.isArray(installments) && installments.length > 0) {
    return summarizeInstallmentRemittance(installments);
  }
  const outstanding = Math.max(0, toAmount(fallbackOutstanding));
  const remitted = Math.min(invoiceRemittedAmount(record), outstanding);
  return { outstanding, remitted, free: outstanding - remitted };
}

/**
 * True when a confirmed remittance is the reason nothing is left to register: something is still
 * owed, something is remitted, and nothing is free. Drives the disabled "Añadir cobro/pago" button
 * and its `cpAddPaymentBlockedByRemittance` tooltip.
 *
 * @param {{ outstanding: number, remitted: number, free: number }} summary see
 *   `summarizeInstallmentRemittance`
 * @returns {boolean}
 */
export function isBlockedByRemittance(summary) {
  return summary.outstanding > REMITTANCE_EPSILON
    && summary.remitted > REMITTANCE_EPSILON
    && summary.free <= REMITTANCE_EPSILON;
}

/** The id the register body sends as `scheduleId` for an installment row. */
function scheduleIdOf(installment) {
  return installment?.finPaymentScheduleID || installment?.id || '';
}

/**
 * Picks the installment a new payment goes to: the first one with something still FREE to register.
 *
 * An installment in a confirmed remittance keeps its full `outstandingAmount`, but the remitted part
 * is collected by the remittance and the backend refuses a payment over the free part
 * (`ETGO_InvoiceInRemittance`). So the free amount decides: `payableAmount` when the backend sends
 * it, else `outstandingAmount` (a backend that predates ETP-6247, where nothing is remitted). A fully
 * remitted first installment is skipped in favour of the next free one.
 *
 * When a draft is being edited the old rule stays: `payableAmount` leaves out the details a draft
 * already links, so the installment the edited draft holds would read 0 and be skipped.
 *
 * @param {object[]} plan the `paymentPlan` rows
 * @param {{ editing?: boolean }} [options] `editing` — a draft is being re-opened
 * @returns {object|undefined} the installment row
 */
export function pickPaymentInstallment(plan = [], { editing = false } = {}) {
  const outstanding = (p) => toAmount(p?.outstandingAmount);
  const free = (p) => toAmount(p?.payableAmount ?? p?.outstandingAmount);
  return (!editing && plan.find((p) => free(p) > 0))
    || plan.find((p) => outstanding(p) > 0)
    || plan[0];
}

/**
 * What a NEW payment registered from the invoice can take, and on which installment.
 *
 * The register action applies a payment to ONE installment (`scheduleId`): it links the funds to
 * that installment's free details and, when the installment is partly or fully remitted, refuses any
 * amount over its payable part (`InvoiceRemittance.installmentRefusal` compares the funds against
 * `payableAmount(schedule)`). Offering the free part of the whole invoice there — 30 + 50 = 80 over
 * two installments — and assigning it to the first one (free 30) made the default amount itself a
 * 422. So when the invoice has anything remitted, the target is the installment
 * `pickPaymentInstallment` chooses and the amount is capped at its `payableAmount` (which already
 * leaves out the details drafts hold, the same figure the backend compares).
 *
 * With nothing remitted the behaviour is the pre-ETP-6247 one, untouched: the whole free amount, and
 * the installment resolved by the entry modal itself (`scheduleId: null`).
 *
 * @param {object[]} installments the invoice's `paymentPlan` rows
 * @param {number} freeToAllocate the invoice's free amount minus what drafts reserve
 * @returns {{ amount: number, scheduleId: string|null }}
 */
export function resolvePaymentTarget(installments, freeToAllocate) {
  const list = Array.isArray(installments) ? installments : [];
  if (summarizeInstallmentRemittance(list).remitted <= REMITTANCE_EPSILON) {
    return { amount: freeToAllocate, scheduleId: null };
  }
  const target = pickPaymentInstallment(list);
  const payable = toAmount(target?.payableAmount ?? installmentFreeAmount(target));
  if (!target || payable <= REMITTANCE_EPSILON) return { amount: freeToAllocate, scheduleId: null };
  return { amount: Math.min(freeToAllocate, payable), scheduleId: scheduleIdOf(target) || null };
}
