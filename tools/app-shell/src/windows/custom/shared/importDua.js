/**
 * ETP-6284 — pure rules of the purchase-invoice "Importación con DUA" check
 * (`C_Invoice.EM_Etgo_Import_Dua`, header field `etgoImportDua`, owned by com.etendoerp.go).
 *
 * The check marks an import with DUA independently of SII: the Lines tab shows the DUA and
 * import-tax cards while it is on (`ImportDuaLinesSection`). For an organization adopted to SII the
 * SIF tab then sets the SII invoice type to F5 (`importDuaInvoiceTypeToSet`), and the user can still
 * switch it to LC.
 *
 * Plain module (no React, no `@/` imports) so `node --test` and Vitest can both load it.
 */

/** SII invoice types of an import with DUA (purchase `aeatsiiClaveTipoFc`). */
export const IMPORT_DUA_TYPE_KEYS = Object.freeze(['F5', 'LC']);

/** The SII invoice type the SIF tab sets on an import with DUA that has another one. */
export const IMPORT_DUA_DEFAULT_TYPE = 'F5';

/** Whether a Y/N header value reads as yes: a boolean `true` or the stored `'Y'`. */
export function isYes(value) {
  return value === true || value === 'Y';
}

/** Whether the SII invoice type is F5 / LC: such an invoice is an import whatever the check says. */
export function isImportDuaTypeKey(record) {
  return IMPORT_DUA_TYPE_KEYS.includes(record?.aeatsiiClaveTipoFc);
}

/**
 * Whether a header record is an import with DUA — the EFFECTIVE value of the check: the stored
 * check on (boolean or 'Y'), or an SII invoice type F5 / LC (a legacy or Classic import without
 * the check counts as checked, as in com.etendoerp.go `PurchaseInvoiceImportDua.isImportDua`).
 */
export function isImportDuaChecked(record) {
  return isImportDuaStoredOn(record) || isImportDuaTypeKey(record);
}

/** The stored check alone (boolean or 'Y'), ignoring the SII invoice type. */
export function isImportDuaStoredOn(record) {
  return isYes(record?.etgoImportDua);
}

/**
 * Whether the switch is locked on: a legacy or Classic import — SII type F5 / LC while the stored
 * check is off (false, 'N' or null). Only changing Tipo factura in the SIF tab turns it off. When
 * the user checked it (stored on), the F5 the SIF tab then set must NOT lock it: the switch stays
 * toggleable and unchecking moves the type back (`importDuaUncheckPatch`).
 */
export function isImportDuaLockedOn(record) {
  return isImportDuaTypeKey(record) && !isImportDuaStoredOn(record);
}

/** The SII invoice type an unchecked import goes back to. */
export const IMPORT_DUA_UNCHECK_TYPE = 'F1';

/**
 * The fields to write, all in the same header save, when the user unchecks the switch: always
 * `etgoImportDua: false`, plus `aeatsiiClaveTipoFc: 'F1'` when the current type is F5 / LC and the
 * SIF tab could have set it — a draft, SII fields neither locked nor sent, of an organization that
 * files SII. Writing both keeps the EFFECTIVE check off (`isImportDuaChecked`), so the SIF tab does
 * not set F5 again, and com.etendoerp.go no longer asks for the DUA. Entries are ordered: the check
 * first, so no intermediate state ever reads "checked with a non-import type".
 *
 * @param {object} args
 * @param {object} args.record the live header record
 * @param {boolean} args.isDraft
 * @param {boolean} args.siiLocked the SII fields are read-only (completed, sent, read-only role)
 * @param {boolean} args.showSii the organization files SII
 * @returns {Array<[string, *]>} the [field, value] pairs, in write order
 */
export function importDuaUncheckPatch({ record, isDraft, siiLocked, showSii }) {
  const patch = [['etgoImportDua', false]];
  if (isImportDuaTypeKey(record) && isDraft && !siiLocked && showSii) {
    patch.push(['aeatsiiClaveTipoFc', IMPORT_DUA_UNCHECK_TYPE]);
  }
  return patch;
}

/**
 * Whether unchecking must be confirmed first: the invoice already carries manual import tax lines
 * (`hasManualTaxLines`), which stay on the invoice when the check goes off.
 */
export function needsUncheckConfirmation(record) {
  return isYes(record?.hasManualTaxLines);
}

/**
 * Whether the Lines tab shows the DUA and import-tax cards: the feature is on for the user
 * (capability `siiImportDua`) and the invoice has the check on. Independent of SII.
 */
export function shouldShowImportDuaCards({ enabled, record }) {
  return Boolean(enabled) && isImportDuaChecked(record);
}

/**
 * The SII invoice type the SIF tab must write on load, or `null` for none: a draft purchase
 * invoice of an organization in SII, with the import check on and a type other than F5 / LC gets
 * F5 (written as a pending edit, saved like a user change). Never touches a locked invoice
 * (completed, sent, read-only role) or a new one, and never overrides LC.
 *
 * @param {object} args
 * @param {boolean} args.enabled the `siiImportDua` capability
 * @param {boolean} args.isPurchaseInvoice
 * @param {boolean} args.showSii the organization files SII
 * @param {boolean} args.isDraft
 * @param {boolean} args.locked the SII fields are read-only
 * @param {string|null} args.recordId null while the invoice is new
 * @param {object} args.record the live header record
 * @param {string} args.typeField the SII invoice type field (`aeatsiiClaveTipoFc`)
 * @returns {string|null}
 */
export function importDuaInvoiceTypeToSet({
  enabled, isPurchaseInvoice, showSii, isDraft, locked, recordId, record, typeField,
}) {
  if (!enabled || !isPurchaseInvoice || !showSii || !isDraft || locked || !recordId) return null;
  if (!isImportDuaChecked(record)) return null;
  return IMPORT_DUA_TYPE_KEYS.includes(record?.[typeField]) ? null : IMPORT_DUA_DEFAULT_TYPE;
}
