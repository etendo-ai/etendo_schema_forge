// @covers artifacts/remittance/custom/RemittanceFileCard.jsx
// @covers artifacts/remittance/custom/RemittanceSepaFileData.jsx
// @covers artifacts/remittance/custom/RemittanceAdvancedOptions.jsx
// @covers tools/app-shell/src/components/financial-accounts/CreditorIdControls.jsx
// @covers tools/app-shell/src/locales/en_US.json
// @covers tools/app-shell/src/locales/es_ES.json
// @covers tools/app-shell/src/locales/es_AR.json
//
// A i18n key used by the remittance SEPA block / «Antes de confirmar» / account creditor field that is missing
// from a locale is SILENT: `ui()` echoes the raw key. Every literal key those files use (ui('x'), the key maps,
// ternaries) must exist in en_US, es_ES and es_AR.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import enUS from '../en_US.json';
import esAR from '../es_AR.json';
import esES from '../es_ES.json';

const SRC = join(__dirname, '..', '..');
const ROOT = join(SRC, '..', '..', '..');
const FILES = [
  join(ROOT, 'artifacts/remittance/custom/RemittanceFileCard.jsx'),
  join(ROOT, 'artifacts/remittance/custom/RemittanceSepaFileData.jsx'),
  join(ROOT, 'artifacts/remittance/custom/RemittanceAdvancedOptions.jsx'),
  join(ROOT, 'artifacts/remittance/custom/RemittanceProcessConfirmModal.jsx'),
  join(SRC, 'components/financial-accounts/CreditorIdControls.jsx'),
  join(SRC, 'windows/custom/financial-account/SepaCreditorIdSection.jsx'),
  join(SRC, 'windows/custom/financial-account/useAccountCreditorId.js'),
  join(SRC, 'lib/sepaCreditorId.js'),
];
// ui('key'), ui(cond ? 'a' : 'b'), and the quoted keys of the files' own key maps.
const KEY = /'((?:remittance|sepaCreditorId|sepaFile|financeAccountsSepa)[A-Za-z0-9]*)'/g;
// Matched by the pattern below but not dictionary keys: the spec name and the keys of the header-form gate fields.
const NOT_I18N = new Set(['remittance', 'sepaFileIban', 'sepaFileCreditorId']);
const UI_CALL = /\bui\(\s*([^)]*)\)/g;

function usedKeys() {
  const keys = new Set();
  for (const file of FILES) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(KEY)) keys.add(m[1]);
    for (const call of text.matchAll(UI_CALL)) {
      for (const m of call[1].matchAll(/'([a-z][A-Za-z0-9]*)'/g)) keys.add(m[1]);
    }
  }
  return [...keys].filter((key) => !NOT_I18N.has(key));
}

describe('remittance SEPA i18n keys', () => {
  const keys = usedKeys();

  it('finds the keys the files use', () => {
    expect(keys).toEqual(expect.arrayContaining(['remittanceFileCreditorIdHint', 'sepaCreditorIdSourceSuggested', 'remittanceSchemeB2b']));
  });

  it.each([['en_US', enUS], ['es_ES', esES], ['es_AR', esAR]])('every key used exists in %s', (_name, dictionary) => {
    const labels = { ...dictionary.genericLabels, ...dictionary.ui };
    const missing = keys.filter((key) => !(key in labels));
    expect(missing).toEqual([]);
  });
});

// The invoice side of a CONFIRMED remittance: the chip on the invoice grids and topbars, the
// remittance banner of the payments modal and preview card, the disabled "add payment" reason, the payment sidebar
// label and the two backend refusals. A key missing from one locale is silent (the raw key shows).
describe('invoice-side remittance i18n keys', () => {
  const INVOICE_FILES = [
    join(SRC, 'windows/custom/shared/RemittanceInfoBanner.jsx'),
    join(SRC, 'windows/custom/shared/preview-cards/PaymentsCard.jsx'),
    join(SRC, 'windows/custom/shared/InvoicePaymentHistoryModal.jsx'),
    // The preview's «Añadir cobro/pago» action keeps the disabled reason (always rendered there).
    join(SRC, 'windows/custom/shared/InvoicePreview.jsx'),
    join(SRC, 'windows/custom/shared/PaymentDetailSidebarBase.jsx'),
    join(SRC, 'windows/custom/purchase-invoice/PurchaseInvoiceHeaderTable.jsx'),
    join(SRC, 'windows/custom/purchase-invoice/PurchaseInvoiceTopbar.jsx'),
    join(ROOT, 'artifacts/sales-invoice/custom/InvoiceHeaderTable.jsx'),
    join(ROOT, 'artifacts/sales-invoice/custom/InvoiceTopbarExtra.jsx'),
  ];
  // key → the placeholders its sentence must carry in every locale.
  const KEYS = {
    remittanceInvoiceChip: [],
    remittancePaymentLink: ['documentNo'],
    cpAddPaymentBlockedByRemittance: [],
    cobroConfirmadoEnRemesa: [],
    pagoConfirmadoEnRemesa: [],
    'backendError.invoiceInRemittance': ['remittance', 'amount'],
    'backendError.paymentInRemittance': ['remittance'],
    'backendError.invoiceFullyInRemittance': ['remittance'],
    invoiceRemittanceBannerTitle: ['documentNo'],
    invoiceRemittanceBannerHintSales: [],
    invoiceRemittanceBannerHintPurchase: [],
    invoiceRemittanceViewLink: [],
    invoicePendingCollection: [],
  };
  const LOCALES = [['en_US', enUS], ['es_ES', esES], ['es_AR', esAR]];
  const labelsOf = (dictionary) => ({ ...dictionary.genericLabels, ...dictionary.ui });
  const placeholders = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

  it('every non-backend key is used by the invoice-side files', () => {
    const text = INVOICE_FILES.map((file) => readFileSync(file, 'utf8')).join('\n');
    for (const key of Object.keys(KEYS).filter((k) => !k.startsWith('backendError.'))) {
      expect(text, key).toContain(`'${key}'`);
    }
  });

  it.each(LOCALES)('every remittance key the invoice-side files use exists in %s', (_name, dictionary) => {
    const labels = labelsOf(dictionary);
    const used = new Set();
    for (const file of INVOICE_FILES) {
      for (const m of readFileSync(file, 'utf8').matchAll(KEY)) used.add(m[1]);
    }
    const missing = [...used].filter((key) => !NOT_I18N.has(key) && !(key in labels));
    expect(missing).toEqual([]);
  });

  it.each(LOCALES)('has every key, non-empty, with its placeholders, in %s', (_name, dictionary) => {
    const labels = labelsOf(dictionary);
    for (const [key, params] of Object.entries(KEYS)) {
      expect(typeof labels[key] === 'string' && labels[key].trim(), `${key}`).toBeTruthy();
      expect(placeholders(labels[key]), key).toEqual([...params].sort());
    }
  });

  it('translates the Spanish locales instead of copying the English sentence', () => {
    for (const key of Object.keys(KEYS)) {
      expect(labelsOf(esES)[key], `es_ES ${key}`).not.toBe(labelsOf(enUS)[key]);
      expect(labelsOf(esAR)[key], `es_AR ${key}`).not.toBe(labelsOf(enUS)[key]);
    }
  });
});
