/**
 * Statuses Core sets on a payment that has been confirmed. PWNC ("Withdrawn not Cleared") and
 * RPAE ("Awaiting Execution") are the confirmed states for payments-out / deferred accounts —
 * without them a confirmed purchase payment was mislabeled as a draft.
 */
export const DEPOSITED_STATUSES = new Set(['RPR', 'RPPC', 'RDNC', 'PPM', 'PWNC', 'RPAE']);

export const DEPOSITED_STATUSES_LIST = ['RPR', 'RPPC', 'RDNC', 'PPM', 'PWNC', 'RPAE'];

/**
 * "Payment Made" — Core sets it on a payment that is confirmed but has NOT been withdrawn from its
 * financial account, so no {@code FIN_Finacc_Transaction} exists for it yet. Once the withdrawal is
 * recorded Core moves the payment on to PWNC.
 *
 * This is the state a Salt Edge transfer sits in between `authorized` (the bank committed to it)
 * and `executed` (the money actually moved): the accounts Etendo Go pays from over PIS are
 * configured without automatic withdrawal precisely so the transaction only appears once Salt Edge
 * reports execution.
 *
 * So calling PPM "deposited" is wrong in every case, not only the PIS one — the money has not left
 * the account yet (ETP-4895).
 */
export const STATUS_PAYMENT_MADE = 'PPM';

/**
 * FIN_Payment status added by com.etendoerp.go for a bank transfer the bank rejected *after* it
 * had already committed to it — the only rejection that leaves a payment behind, since a payment
 * is not created until `authorized`. A rejection before that point creates nothing at all and is
 * reported in the payment modal instead.
 *
 * The payment stays **processed**: it is deliberately not reactivated, so it keeps holding the
 * invoice's installment and any credit it consumed, which is what lets the retry reuse it instead
 * of registering a second payment. The trade-off is that the invoice still reads as paid until the
 * retry succeeds — this row is the only signal that it is not (ETP-4895).
 */
export const PAYMENT_STATUS_ERROR = 'ETGOERR';

/**
 * "Remitted" — the status Classic REM gives the payment of a CONFIRMED remittance due that the bank
 * has not collected yet (ETP-6247). The money has not moved: the invoice keeps its full outstanding
 * until the remittance is collected, and the payment then moves on to RPR/PPM and RDNC/PWNC. A draft
 * remittance creates no payment at all, so it never shows up here.
 *
 * The payment is not the user's to edit: the remittance owns its lifecycle and the backend refuses a
 * reactivation or removal (`ETGO_PaymentInRemittance`). So it counts as processed — never a draft
 * the invoice modal would offer to edit or delete, or reserve against the outstanding — but it is
 * NOT a deposited status: reading it as "Cobro depositado" is exactly the lie this state replaces.
 *
 * `REM_CANCEL` ("settled in remittance") is a settled status and stays out of this: it keeps
 * reading as deposited.
 */
export const STATUS_REMITTED = 'REM_SENT';

/**
 * "Void" — the status Core gives a payment that was undone after it was confirmed. The case that
 * reaches an invoice is a remittance RETURN (ETP-6247): the collected payment is voided, the
 * invoice gets its outstanding back, and the payment keeps its (cancelled) schedule details, so the
 * invoice's payment list still shows it. It moved no money that still counts: it is neither
 * deposited nor a draft, and must not be counted as a registered payment.
 *
 * Shown with the same "Anulado" label (`statusVoid`) and destructive tone as the payment window's
 * own status badge (lib/statusBadge.js `rpvoid`).
 */
export const STATUS_VOIDED = 'RPVOID';

/**
 * True when the payment is confirmed rather than an editable draft. A voided payment is not
 * editable either, so it counts here — whatever its `processed` flag says.
 */
export function isPaymentProcessed(payment) {
  const status = payment?.status || '';
  return payment?.processed === true || DEPOSITED_STATUSES.has(status)
    || status === STATUS_REMITTED || status === STATUS_VOIDED;
}

/** True for a voided payment: shown in the list, but no longer counted as a registered payment. */
export function isPaymentVoided(payment) {
  return paymentDisplayState(payment) === 'voided';
}

/**
 * The amount a payment means on ONE invoice's surfaces (its payment modal and preview card).
 *
 * A payment can settle several invoices at once — a remittance grouped by customer creates one
 * payment for all of that customer's invoices (ETP-6247) — so its header `amount` is the whole
 * payment, not this invoice's share. The invoice payment-list action sends `appliedToInvoice`, the
 * sum of the payment's schedule details on THIS invoice (negative when it consumes a credit note),
 * which survives a void because Core cancels those details instead of deleting them. Falls back to
 * `amount` when the backend did not send it. Always non-negative; the caller owns the sign.
 *
 * @param payment a row of the invoice payment-list action
 * @returns {number} this invoice's share of the payment
 */
export function paymentAmountOnInvoice(payment) {
  const applied = payment?.appliedToInvoice;
  const raw = applied != null && applied !== '' && Number.isFinite(Number(applied))
    ? applied
    : payment?.amount;
  return Math.abs(Number(raw) || 0);
}

/**
 * The single place that decides how a payment reads to the user.
 *
 * Every surface that shows a payment goes through here — the invoice's payment modal, the invoice
 * preview card, the payments grid and the payment window — because each of them used to carry its
 * own copy of the status list. That is exactly how one PIS transfer ended up reading "Pago en
 * progreso" in the modal and "Pago depositado" in the payment window at the same time (ETP-4895).
 *
 * @param payment a payment row; `pisPending` is optional (see below)
 * @returns one of `'error' | 'voided' | 'remitted' | 'inProgress' | 'deposited' | 'draft'`
 */
export function paymentDisplayState(payment) {
  const status = payment?.status || '';
  if (status === PAYMENT_STATUS_ERROR) return 'error';
  // Ahead of the processed check for the same reason as 'remitted' below: a voided payment keeps
  // `processed`, and without this a remittance return read "Cobro depositado" in green on the
  // invoice whose outstanding it had just given back (ETP-6247).
  if (status === STATUS_VOIDED) return 'voided';
  // Ahead of the processed check on purpose: a remitted payment is processed, and without this it
  // read "Cobro depositado" in green while the bank had not collected anything (ETP-6247).
  if (status === STATUS_REMITTED) return 'remitted';
  // `pisPending` is the backend's exact answer — processed, initiated over PIS, and with no bank
  // transaction. Only the invoice payment-list action carries it; where it is absent, PPM answers
  // the same question from the status alone (see STATUS_PAYMENT_MADE).
  if (payment?.pisPending === true) return 'inProgress';
  if (status === STATUS_PAYMENT_MADE) return 'inProgress';
  if (isPaymentProcessed(payment)) return 'deposited';
  return 'draft';
}

// ── Salt Edge PIS transfer statuses ─────────────────────────────────────────
// The 8 values of AD reference D5483E7D91134499B42BBD963BC2F9CC (Bank Integration module).
// Classification is explicit on success and failure and treats EVERYTHING else — including a
// status this list does not know yet — as still running: defaulting an unknown status to failure
// once reported a healthy 'initiated_info_required' transfer as failed (ETP-4895), while
// defaulting it to "keep polling" is self-healing if Salt Edge ever adds a value.
export const PIS_SUCCESS_STATUSES = ['executed', 'settled'];
// The user approved the transfer at the bank, so the payment is registered — but the funds have
// not moved yet. Resolutive all the same ("AUTHORIZED → create payment" in the spec): whoever is
// watching must stop waiting on it, because the payment already exists.
export const PIS_REGISTERED_STATUSES = ['authorized'];
export const PIS_FAILURE_STATUSES = ['failed'];

/**
 * Classifies a Salt Edge PIS status into the outcomes a watcher reacts to.
 *
 * @param {string} status the Salt Edge status
 * @returns {'success'|'registered'|'failure'|'pending'} what the caller should do about it
 */
export function pisOutcome(status) {
  if (PIS_SUCCESS_STATUSES.includes(status)) return 'success';
  if (PIS_REGISTERED_STATUSES.includes(status)) return 'registered';
  if (PIS_FAILURE_STATUSES.includes(status)) return 'failure';
  return 'pending';
}
