// @covers tools/app-shell/src/windows/custom/invoice-inbox/invoiceInboxCurrency.js
// New file justification: invoiceInboxCurrency.js is a new module; no existing test file covers it
// (invoiceInboxReviewModel.test.js is the model, a different unit).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  currencyRateForPicker, currencySourceOf, ambiguousCurrencyNotices, unavailableCurrencyCode,
} from '../invoiceInboxCurrency.js';

describe('currencyRateForPicker', () => {
  it('is 1 when the answer carries no rate key (older answer) or no currency at all', () => {
    assert.equal(currencyRateForPicker({ id: 'EUR1', isoCode: 'EUR' }), 1);
    assert.equal(currencyRateForPicker(undefined), 1);
    assert.equal(currencyRateForPicker(null), 1);
  });
  it('is null when the answer says there is no rate (null or empty string)', () => {
    assert.equal(currencyRateForPicker({ rate: null }), null);
    assert.equal(currencyRateForPicker({ rate: '' }), null);
  });
  it('is the number, also when it arrives as text; null when it is not numeric', () => {
    assert.equal(currencyRateForPicker({ rate: 1.47 }), 1.47);
    assert.equal(currencyRateForPicker({ rate: '1.47' }), 1.47);
    assert.equal(currencyRateForPicker({ rate: 0 }), 0);
    assert.equal(currencyRateForPicker({ rate: 'abc' }), null);
  });
});

describe('currencySourceOf', () => {
  it('returns printed / default / manual', () => {
    for (const source of ['printed', 'default', 'manual']) {
      assert.equal(currencySourceOf({ currency: { source } }), source);
    }
  });
  it('the review answer wins over the header; the header is the fallback', () => {
    const review = { currency: { source: 'manual' }, document: { header: { currencySource: 'printed' } } };
    assert.equal(currencySourceOf(review), 'manual');
    assert.equal(currencySourceOf({ currency: {}, document: { header: { currencySource: 'printed' } } }), 'printed');
  });
  it('is null when absent or an unknown value, so no hint is shown', () => {
    assert.equal(currencySourceOf(undefined), null);
    assert.equal(currencySourceOf({}), null);
    assert.equal(currencySourceOf({ currency: { source: 'guessed' } }), null);
  });
});

describe('ambiguousCurrencyNotices', () => {
  it('plain string notice: the symbol is header.currencyRaw', () => {
    const doc = { notices: ['currency_symbol_ambiguous'], header: { currencyRaw: '$' } };
    assert.deepEqual(ambiguousCurrencyNotices(doc), [{ symbol: '$' }]);
  });
  it('object notice: its own symbol wins over currencyRaw', () => {
    const doc = { notices: [{ code: 'currency_symbol_ambiguous', symbol: 'US$' }], header: { currencyRaw: '$' } };
    assert.deepEqual(ambiguousCurrencyNotices(doc), [{ symbol: 'US$' }]);
  });
  it('object notice without symbol falls back to currencyRaw', () => {
    const doc = { notices: [{ code: 'currency_symbol_ambiguous' }], header: { currencyRaw: '$' } };
    assert.deepEqual(ambiguousCurrencyNotices(doc), [{ symbol: '$' }]);
  });
  it('dedupes by symbol and keeps distinct symbols', () => {
    const doc = {
      notices: ['currency_symbol_ambiguous', { code: 'currency_symbol_ambiguous', symbol: '$' },
        { code: 'currency_symbol_ambiguous', symbol: '£' }],
      header: { currencyRaw: '$' },
    };
    assert.deepEqual(ambiguousCurrencyNotices(doc), [{ symbol: '$' }, { symbol: '£' }]);
  });
  it('ignores other notices and a missing or non-array notices list', () => {
    assert.deepEqual(ambiguousCurrencyNotices({ notices: ['other', { code: 'x' }] }), []);
    assert.deepEqual(ambiguousCurrencyNotices({ notices: 'currency_symbol_ambiguous' }), []);
    assert.deepEqual(ambiguousCurrencyNotices(undefined), []);
  });
});

describe('unavailableCurrencyCode', () => {
  it('is empty without the flag (or with a falsy one)', () => {
    assert.equal(unavailableCurrencyCode(undefined), '');
    assert.equal(unavailableCurrencyCode({ header: {} }), '');
    assert.equal(unavailableCurrencyCode({ header: { currencyUnavailable: false, currencyRaw: 'CHF' } }), '');
  });
  it('a string flag is the code itself', () => {
    assert.equal(unavailableCurrencyCode({ header: { currencyUnavailable: 'CHF', currencyRaw: 'Fr.' } }), 'CHF');
  });
  it('a boolean flag uses the printed value (currencyRaw), empty when there is none', () => {
    assert.equal(unavailableCurrencyCode({ header: { currencyUnavailable: true, currencyRaw: 'GBP' } }), 'GBP');
    assert.equal(unavailableCurrencyCode({ header: { currencyUnavailable: true } }), '');
  });
});
