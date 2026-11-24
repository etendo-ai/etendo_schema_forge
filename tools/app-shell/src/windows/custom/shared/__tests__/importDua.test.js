// @covers tools/app-shell/src/windows/custom/shared/importDua.js
//
// The purchase-invoice "Importación con DUA" check: it drives the Lines tab cards for any
// organization, and the F5 invoice type of the SIF tab only for an organization in SII.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isImportDuaChecked, shouldShowImportDuaCards, importDuaInvoiceTypeToSet, needsUncheckConfirmation,
} from '../importDua.js';

describe('isImportDuaChecked', () => {
  it('reads a boolean or the Y/N serialization', () => {
    assert.equal(isImportDuaChecked({ etgoImportDua: true }), true);
    assert.equal(isImportDuaChecked({ etgoImportDua: 'Y' }), true);
    assert.equal(isImportDuaChecked({ etgoImportDua: false }), false);
    assert.equal(isImportDuaChecked({ etgoImportDua: 'N' }), false);
    assert.equal(isImportDuaChecked({}), false);
    assert.equal(isImportDuaChecked(null), false);
  });

  it('treats a legacy SII type F5 / LC as checked', () => {
    assert.equal(isImportDuaChecked({ etgoImportDua: false, aeatsiiClaveTipoFc: 'F5' }), true);
    assert.equal(isImportDuaChecked({ aeatsiiClaveTipoFc: 'LC' }), true);
    assert.equal(isImportDuaChecked({ etgoImportDua: false, aeatsiiClaveTipoFc: 'F1' }), false);
  });
});

describe('needsUncheckConfirmation', () => {
  it('asks only when manual import tax lines exist', () => {
    assert.equal(needsUncheckConfirmation({ hasManualTaxLines: true }), true);
    assert.equal(needsUncheckConfirmation({ hasManualTaxLines: 'Y' }), true);
    assert.equal(needsUncheckConfirmation({ hasManualTaxLines: false }), false);
    assert.equal(needsUncheckConfirmation(null), false);
  });
});

describe('shouldShowImportDuaCards — Lines tab cards follow the check', () => {
  it('shows them with the feature on and the effective check on (stored, or type F5 / LC)', () => {
    assert.equal(shouldShowImportDuaCards({ enabled: true, record: { etgoImportDua: true } }), true);
    assert.equal(shouldShowImportDuaCards({ enabled: true, record: { etgoImportDua: false, aeatsiiClaveTipoFc: 'F5' } }), true);
    assert.equal(shouldShowImportDuaCards({ enabled: true, record: { etgoImportDua: false, aeatsiiClaveTipoFc: 'F1' } }), false);
    assert.equal(shouldShowImportDuaCards({ enabled: false, record: { etgoImportDua: true } }), false);
  });
});

describe('importDuaInvoiceTypeToSet — F5 auto-switch of the SIF tab', () => {
  const base = {
    enabled: true, isPurchaseInvoice: true, showSii: true, isDraft: true, locked: false,
    recordId: 'inv-1', record: { etgoImportDua: true, aeatsiiClaveTipoFc: 'F1' }, typeField: 'aeatsiiClaveTipoFc',
  };

  it('sets F5 on a checked draft of an SII organization with another type', () => {
    assert.equal(importDuaInvoiceTypeToSet(base), 'F5');
    assert.equal(importDuaInvoiceTypeToSet({ ...base, record: { etgoImportDua: 'Y' } }), 'F5');
  });

  it('keeps F5 and LC (the user may pick LC)', () => {
    assert.equal(importDuaInvoiceTypeToSet({ ...base, record: { etgoImportDua: true, aeatsiiClaveTipoFc: 'F5' } }), null);
    assert.equal(importDuaInvoiceTypeToSet({ ...base, record: { etgoImportDua: true, aeatsiiClaveTipoFc: 'LC' } }), null);
  });

  it('does nothing without the check, outside SII, on a sales, new, non-draft or locked invoice, or with the feature off', () => {
    for (const patch of [
      { record: { etgoImportDua: false, aeatsiiClaveTipoFc: 'F1' } },
      { showSii: false },
      { isPurchaseInvoice: false },
      { recordId: null },
      { isDraft: false },
      { locked: true },
      { enabled: false },
    ]) {
      assert.equal(importDuaInvoiceTypeToSet({ ...base, ...patch }), null, JSON.stringify(patch));
    }
  });
});
