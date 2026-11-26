/**
 * Resolves the AR invoice subtype from a record object.
 *
 * ETP-4737: the former separate 'NC' (credit note) and 'DEV' (return invoice)
 * subtypes are unified into a single 'RECTIFICATIVA' subtype, backed either by
 * the new "Factura Rectificativa" doc type (EM_Etsg_Isrectificative='Y' on
 * C_DocType) or, for backward compatibility with historical invoices, by
 * either legacy doc type (AR Credit Memo / Return Material Sales Invoice).
 *
 * Prefers the server-injected `arInvoiceSubtype` virtual field.
 * Falls back to inferring from the doc type identifier when the handler
 * has not yet been compiled/deployed — prevents rectificative invoices from
 * displaying as FAC because the identifier never contains a recognizable hint.
 *
 * @param {object|null|undefined} row
 * @returns {'FAC'|'RECTIFICATIVA'}
 */
export function getArSubtype(row) {
  if (!row) return 'FAC';
  if (row.arInvoiceSubtype) return row.arInvoiceSubtype;
  // Fallback: infer from the doc type name (English or Spanish identifier)
  const ident = (
    row['transactionDocument$_identifier'] ||
    row['cDocTypeTargetId$_identifier'] ||
    ''
  ).toLowerCase();
  if (
    ident.includes('rectificativ') ||
    ident.includes('credit') || ident.includes('memo') || ident.includes('crédito') ||
    ident.includes('return') || ident.includes('devoluci')
  ) {
    return 'RECTIFICATIVA';
  }
  return 'FAC';
}

/**
 * The document type a send of this sales invoice names in its email (the subject and the
 * "Te enviamos tu {documentType} …" line): «Factura rectificativa» / "Credit Note" for a
 * rectificative invoice ({@link getArSubtype}, the same rule as the list's type badge), the
 * window's own label («Factura de Venta» / "Sales Invoice") otherwise (ETP-6209, QA pass 2).
 *
 * It mirrors the module catalog's `sales-invoice-send.documentType` and
 * `sales-invoice-send.documentType.creditNote`, so an app send names the document as an MCP send
 * does; `defaultCopyInSync.vitest.js` keeps the two in sync. Every sales-invoice send path calls it.
 *
 * @param {object|null|undefined} row the invoice record
 * @param {{ tMenu: (key: string) => string, ui: (key: string) => string }} labels
 * @returns {string}
 */
export function salesInvoiceSendDocumentType(row, { tMenu, ui }) {
  return getArSubtype(row) === 'RECTIFICATIVA' ? ui('sendDocumentTypeCreditNote') : tMenu('Sales Invoice');
}
