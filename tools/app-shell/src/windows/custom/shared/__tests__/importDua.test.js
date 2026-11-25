// @covers tools/app-shell/src/windows/custom/shared/importDua.js
//
// The purchase-invoice "Importación con DUA" check: it drives the Lines tab cards for any
// organization, and the F5 invoice type of the SIF tab only for an organization in SII.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isImportDuaChecked, shouldShowImportDuaCards, importDuaInvoiceTypeToSet, needsUncheckConfirmation,
  isImportDuaLockedOn, importDuaUncheckPatch,
} from '../importDua.js';

describe('isImportDuaLockedOn — only a legacy F5 / LC locks the switch', () => {
  it('locks F5 / LC while the stored check is off (false, N or null)', () => {
    assert.equal(isImportDuaLockedOn({ etgoImportDua: false, aeatsiiClaveTipoFc: 'F5' }), true);
    assert.equal(isImportDuaLockedOn({ etgoImportDua: 'N', aeatsiiClaveTipoFc: 'LC' }), true);
    assert.equal(isImportDuaLockedOn({ etgoImportDua: null, aeatsiiClaveTipoFc: 'F5' }), true);
  });

  it('keeps it toggleable when the user checked it, even after the SIF tab set F5', () => {
    assert.equal(isImportDuaLockedOn({ etgoImportDua: true, aeatsiiClaveTipoFc: 'F5' }), false);
    assert.equal(isImportDuaLockedOn({ etgoImportDua: 'Y', aeatsiiClaveTipoFc: 'LC' }), false);
  });

  it('does not lock any other type', () => {
    assert.equal(isImportDuaLockedOn({ etgoImportDua: false, aeatsiiClaveTipoFc: 'F1' }), false);
    assert.equal(isImportDuaLockedOn(null), false);
  });
});

describe('importDuaUncheckPatch — what one header save writes on uncheck', () => {
  const base = {
    record: { etgoImportDua: true, aeatsiiClaveTipoFc: 'F5' }, isDraft: true, siiLocked: false, showSii: true,
  };

  it('writes the check off and moves F5 / LC back to F1, check first', () => {
    assert.deepEqual(importDuaUncheckPatch(base), [['etgoImportDua', false], ['aeatsiiClaveTipoFc', 'F1']]);
    assert.deepEqual(importDuaUncheckPatch({ ...base, record: { etgoImportDua: 'Y', aeatsiiClaveTipoFc: 'LC' } }),
      [['etgoImportDua', false], ['aeatsiiClaveTipoFc', 'F1']]);
  });

  it('leaves the effective check off, so the SIF tab does not set F5 again', () => {
    const next = { ...base.record, ...Object.fromEntries(importDuaUncheckPatch(base)) };
    assert.equal(isImportDuaChecked(next), false);
    assert.equal(importDuaInvoiceTypeToSet({
      enabled: true, isPurchaseInvoice: true, showSii: true, isDraft: true, locked: false,
      recordId: 'inv-1', record: next, typeField: 'aeatsiiClaveTipoFc',
    }), null);
  });

  it('writes only the check when the type is not F5 / LC, or on a non-draft, locked or non-SII invoice', () => {
    for (const patch of [
      { record: { etgoImportDua: true, aeatsiiClaveTipoFc: 'F1' } },
      { record: { etgoImportDua: true } },
      { isDraft: false },
      { siiLocked: true },
      { showSii: false },
    ]) {
      assert.deepEqual(importDuaUncheckPatch({ ...base, ...patch }), [['etgoImportDua', false]], JSON.stringify(patch));
    }
  });
});

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
