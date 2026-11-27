// @covers artifacts/goods-shipment/custom/GoodsShipmentConfirmModal.jsx
// Wiring contract of a thin wrapper around the shared ConfirmInOutModal (policy point 7):
// the behaviour behind each prop is covered in ConfirmInOutModal.spec.jsx.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, '..', 'GoodsShipmentConfirmModal.jsx'), 'utf8');

describe('GoodsShipmentConfirmModal', () => {
  it('renders the shared ConfirmInOutModal for the goods-shipment spec', () => {
    assert.match(src, /import ConfirmInOutModal from '@\/components\/contract-ui\/ConfirmInOutModal'/);
    assert.match(src, /specName="goods-shipment"/);
    assert.match(src, /entityName="goodsShipment"/);
    assert.match(src, /invoiceAction="createDraftInvoice"/);
  });

  // ETP-6179 — the invoice dry run before completing is turned on for the return receipt
  // only; the shipment keeps the plain confirm.
  it('does not turn on the invoice dry run before confirming', () => {
    assert.doesNotMatch(src, /validateInvoiceFirst/);
  });
});
