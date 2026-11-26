/**
 * ETP-6051 currency phase A — pure helpers for the currency of an inbox review: the rate the
 * read-only picker shows, where the currency came from, the ambiguous-symbol notices and the
 * "currency not available" sentence of the exchange-rate blocker. No React, no i18n.
 */

/** The org-to-document rate for the picker: 1 when the answer carries none, null when it says there is none. */
export function currencyRateForPicker(currency) {
  if (!currency || currency.rate === undefined) return 1;
  const rate = currency.rate;
  if (rate === null || rate === '') return null;
  const n = Number(rate);
  return Number.isFinite(n) ? n : null;
}

/** `printed` / `default` / `manual`, or null (an older answer, or an unknown value) so no hint is shown. */
export function currencySourceOf(review) {
  const source = review?.currency?.source ?? review?.document?.header?.currencySource;
  return source === 'printed' || source === 'default' || source === 'manual' ? source : null;
}

/**
 * The `currency_symbol_ambiguous` notices of the document, one per distinct symbol. A notice is a
 * plain string code; the printed symbol is `header.currencyRaw` (an object `{code, symbol}` is
 * tolerated too, its own symbol winning).
 */
export function ambiguousCurrencyNotices(document) {
  const notices = Array.isArray(document?.notices) ? document.notices : [];
  const seen = new Set();
  const out = [];
  for (const notice of notices) {
    const code = typeof notice === 'string' ? notice : notice?.code;
    if (code !== 'currency_symbol_ambiguous') continue;
    const own = typeof notice === 'object' ? notice?.symbol : null;
    const symbol = String(own ?? document?.header?.currencyRaw ?? '');
    if (seen.has(symbol)) continue;
    seen.add(symbol);
    out.push({ symbol });
  }
  return out;
}

/**
 * The code of a currency the tenant does not have, or '' when the document carries no
 * `currencyUnavailable`. The flag may be a boolean (the printed code is then `currencyRaw`) or the code itself.
 */
export function unavailableCurrencyCode(document) {
  const header = document?.header;
  const flag = header?.currencyUnavailable;
  if (!flag) return '';
  if (typeof flag === 'string') return flag;
  return String(header?.currencyRaw ?? '');
}
