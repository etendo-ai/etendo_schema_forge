// @covers gateway/src/public-api/public-api.controller.ts
// The master-child document flow shared by sales-order and purchase-order.
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { api, createRecord, expectErrorDocument, expectStatus, resource } from './client.ts';
import { cleanupCreated, keepAsLeftover, scoped } from './cleanup.ts';
import { createAddress, createContact, createProduct, firstPaymentMethodId, firstWarehouseId } from './fixtures.ts';
import {
  expectDeleted, expectListed, expectMissingIfMatchRefused, expectPatchWithEtag, expectStaleEtagRefused,
  itemPath, patch, readWithEtag, type LifecycleSpec,
} from './lifecycle.ts';

const PARTNER_ROLE = {
  'sales-order': { is_customer: true },
  'purchase-order': { is_vendor: true },
} as const;

export function describeOrderFlow(kind: 'sales-order' | 'purchase-order'): void {
  after(cleanupCreated);

  describe(`${kind} with lines`, () => {
    let order: LifecycleSpec;
    let line: LifecycleSpec;
    let grossBefore = 0;
    let contactId = '';
    let addressId = '';
    let productId = '';
    let warehouseId = '';

    it('creates header and line from prerequisites', async () => {
      // The role is set explicitly: the default of is_customer / is_vendor depends on the tenant, and a
      // purchase order only accepts a vendor as its business partner.
      const contact = await createContact('partner', PARTNER_ROLE[kind]);
      contactId = contact.id;
      addressId = (await createAddress(contactId)).id;
      const product = await createProduct('item');
      productId = product.id;
      warehouseId = await firstWarehouseId(kind);

      const header = await createDraftOrder(kind, { contactId, addressId, warehouseId });
      order = { collection: kind, type: kind, id: header.id, firstPatch: { order_date: '2026-10-15' }, secondPatch: { order_date: '2026-10-16' } };
      assert.equal(header.data.relationships?.business_partner?.data?.id, contactId);
      assert.equal(header.data.attributes.warehouse, warehouseId);
      assert.equal(header.data.relationships?.warehouse, undefined);

      const created = await createRecord(
        `${kind}/${order.id}/lines`,
        resource(`${kind}-lines`, { ordered_quantity: 2, list_price: 25, discount: 0 }, { product: ['product', productId] }),
      );
      line = {
        collection: `${kind}/${order.id}/lines`, type: `${kind}-lines`, id: created.id,
        firstPatch: { ordered_quantity: 3 }, secondPatch: { description: 'stale write must not land' },
      };
      grossBefore = Number(created.data.attributes.line_gross_amount);
      assert.ok(Number.isFinite(grossBefore) && grossBefore > 0, 'the line carries a positive line_gross_amount');
    });

    it('assigns a warehouse on create when the new order omits it', async () => {
      const draft = await createRecord(
        kind,
        resource(kind, { order_date: '2026-10-14', partner_address: addressId }, { business_partner: ['contacts', contactId] }),
        'an order without warehouse is accepted',
      );
      const { res } = await readWithEtag(`${kind}/${draft.id}`);
      const warehouse = res.json.data.attributes.warehouse;
      assert.equal(typeof warehouse, 'string', 'the created order carries a warehouse');
      assert.ok(warehouse.length > 0, 'Etendo assigned a non-empty warehouse');
      await expectDeleted({ collection: kind, id: draft.id });
    });

    if (kind === 'purchase-order') {
      it('refuses a contact that is explicitly not a vendor: 422 reference_not_allowed', async () => {
        // The 422 comes from the purchase-order business-partner selector, which only offers vendors (ETP-6176 parity validation).
        const customerOnly = await createContact('customer-only', { is_customer: true, is_vendor: false });
        const address = await createAddress(customerOnly.id);
        const res = await api('POST', kind, {
          body: resource(kind, { order_date: '2026-10-14', partner_address: address.id, warehouse: warehouseId }, {
            business_partner: ['contacts', customerOnly.id],
          }),
        });
        expectErrorDocument(res, 422, 'reference_not_allowed');
      });
    }

    it('reads the header with its ETag and a grand total, and lists it', async () => {
      const { res } = await readWithEtag(`${kind}/${order.id}`);
      const total = res.json.data.attributes.grand_total_amount;
      assert.equal(typeof total, 'number', 'grand_total_amount is present');
      assert.ok(total > 0, 'grand_total_amount is positive once a line exists');
      await expectListed(order);
      await expectListed(line);
    });

    it('PATCHing the line quantity recomputes its amount, and the header total follows', async () => {
      await expectPatchWithEtag(line);
      const reread = (await readWithEtag(`${line.collection}/${line.id}`)).res.json.data.attributes;
      assert.equal(String(reread.ordered_quantity), '3');
      assert.ok(Number(reread.line_gross_amount) > grossBefore, 'line_gross_amount grew with the quantity');
      const header = await api('GET', `${kind}/${order.id}`);
      expectStatus(header, 200);
      assert.ok(Number(header.json.data.attributes.grand_total_amount) >= Number(reread.line_gross_amount), 'header total covers the line');
    });

    it('line: a stale ETag is 412 and a missing If-Match is 428', async () => {
      await expectStaleEtagRefused(line);
      await expectMissingIfMatchRefused(line);
    });

    it('header: PATCH with the ETag from the read, stale is 412, missing is 428', async () => {
      await expectPatchWithEtag(order);
      await expectStaleEtagRefused(order);
      await expectMissingIfMatchRefused(order);
    });

    it('deletes the line and the draft header, and both answer 404 afterwards', async () => {
      await expectDeleted(line);
      await expectDeleted(order);
    });

    // An order in a currency other than the organization's (docs/public-api.md 4.12): the header
    // carries the tenant's conversion rate as `currency_rate`, and a line created without a price
    // is priced from the catalog converted with that rate.
    describe('foreign currency', () => {
      const orderDate = new Date().toISOString().slice(0, 10);
      let setup: ForeignCurrencySetup | undefined;
      let skipReason = '';
      let foreign: LifecycleSpec;

      it('finds a foreign currency with a published conversion rate from the organization currency', async (t) => {
        const found = await findForeignCurrency(kind, { contactId, addressId, warehouseId }, orderDate);
        if (typeof found === 'string') {
          skipReason = found;
          t.skip(found);
          return;
        }
        setup = found;
      });

      it('answers the published rate as currency_rate on create, and a line without list_price is converted', async (t) => {
        if (!setup) return t.skip(skipReason);
        const { currencyId, rate, catalogPrice, productId: pricedProductId } = setup;
        const header = await createDraftOrder(kind, { contactId, addressId, warehouseId }, { order_date: orderDate, currency: currencyId });
        foreign = { collection: kind, type: kind, id: header.id, firstPatch: {}, secondPatch: {} };
        assert.equal(header.data.attributes.currency, currencyId);
        assert.equal(Number(header.data.attributes.currency_rate), rate, 'currency_rate is the multiple_rate_by of the published conversion rate');

        const line = await createRecord(
          `${kind}/${header.id}/lines`,
          resource(`${kind}-lines`, { ordered_quantity: 1, discount: 0 }, { product: ['product', pricedProductId] }),
        );
        assert.equal(Number(line.data.attributes.list_price), round2(catalogPrice * rate),
          `list_price is the catalog price ${catalogPrice} x rate ${rate}, rounded to 2 decimals`);
      });

      it('a line created WITH list_price keeps it unchanged', async (t) => {
        if (!setup) return t.skip(skipReason);
        const line = await createRecord(
          `${kind}/${foreign.id}/lines`,
          resource(`${kind}-lines`, { ordered_quantity: 1, list_price: 7.77, discount: 0 }, { product: ['product', setup.productId] }),
        );
        assert.equal(Number(line.data.attributes.list_price), 7.77, 'a caller price is in the document currency and is never converted');
      });

      it('a PATCH sending currency_rate keeps the sent rate', async (t) => {
        if (!setup) return t.skip(skipReason);
        const sent = round2(setup.rate * 2 + 0.5);
        const { etag } = await readWithEtag(itemPath(foreign));
        const res = await patch(foreign, { currency_rate: sent }, etag);
        expectStatus(res, 200);
        assert.equal(Number(res.json.data.attributes.currency_rate), sent, 'the PATCH answers the rate that was sent');
        const { res: reread } = await readWithEtag(itemPath(foreign));
        assert.equal(Number(reread.json.data.attributes.currency_rate), sent, 'the rate is kept on read');
      });

      it('accepts currency_rate on create and keeps the sent rate', async (t) => {
        if (!setup) return t.skip(skipReason);
        const sent = round2(setup.rate * 3 + 0.25);
        const header = await createDraftOrder(kind, { contactId, addressId, warehouseId },
          { order_date: orderDate, currency: setup.currencyId, currency_rate: sent });
        assert.equal(Number(header.data.attributes.currency_rate), sent, 'a rate sent on create is kept, not replaced by the published one');
      });
    });

    // Runs last: a completed order cannot be deleted, so it outlives the run (see cleanupCreated).
    // The integrator's flow, with no id known beforehand: look a payment method up, set it on the
    // contact, create an order (it inherits it) and complete it.
    describe('complete action', () => {
      let draft: LifecycleSpec;
      let completable: LifecycleSpec;
      let paymentMethodId = '';
      const contactField = CONTACT_PAYMENT_FIELD[kind];

      it('refuses to complete an order without a payment method: 422, and it stays a draft', async () => {
        const header = await createDraftOrder(kind, { contactId, addressId, warehouseId });
        await createRecord(
          `${kind}/${header.id}/lines`,
          resource(`${kind}-lines`, { ordered_quantity: 1, list_price: 10, discount: 0 }, { product: ['product', productId] }),
        );
        draft = { collection: kind, type: kind, id: header.id, firstPatch: { order_date: '2026-10-15' }, secondPatch: {} };
        assert.equal(header.data.attributes.document_status, 'DR', 'a new order is a draft');
        assert.equal(header.data.attributes.payment_method, null, 'a contact created through the API has no payment method');

        // Etendo's own rule (C_Order_Post) refuses it: proof that the action really reaches the document process.
        expectErrorDocument(await api('POST', `${kind}/${header.id}/actions/complete`), 422, 'business_rule');
        const { res } = await readWithEtag(itemPath(draft));
        assert.equal(res.json.data.attributes.document_status, 'DR');
      });

      it('an action the resource does not declare answers 404 unknown_action', async () => {
        expectErrorDocument(await api('POST', `${kind}/${draft.id}/actions/void`), 404, 'unknown_action');
      });

      it('looks a payment method up on the contact and on the order, and an undeclared lookup is 404 unknown_lookup', async () => {
        const contactLookup = await api('GET', `contacts/lookups/${contactField}?page[size]=100`);
        expectStatus(contactLookup, 200);
        const values: Array<{ type: string; id: string; attributes: { label: string | null } }> = contactLookup.json.data;
        assert.ok(values.length > 0, EMPTY_LOOKUP);
        for (const value of values) {
          assert.equal(value.type, 'payment-method');
          assert.equal(typeof value.id, 'string');
        }
        const [first] = values;
        paymentMethodId = first.id;

        const orderLookup = await api('GET', `${kind}/lookups/payment_method?page[size]=100`);
        expectStatus(orderLookup, 200);
        assert.ok(orderLookup.json.data.some((value: { id: string }) => value.id === paymentMethodId),
          `the ${kind} lookup offers the payment method the contact lookup offered`);

        if (first.attributes.label) {
          const searched = await api('GET', `${kind}/lookups/payment_method?filter[search]=${encodeURIComponent(first.attributes.label)}`);
          expectStatus(searched, 200);
          assert.ok(searched.json.data.some((value: { id: string }) => value.id === paymentMethodId), 'filter[search] by its label finds it');
        }

        expectErrorDocument(await api('GET', `${kind}/lookups/payment_terms`), 404, 'unknown_lookup');
      });

      it('sets the payment method on the contact with If-Match, and a new order inherits it', async () => {
        assert.ok(paymentMethodId, 'the lookup test must run first');
        const contact: LifecycleSpec = { collection: 'contacts', type: 'contacts', id: contactId, firstPatch: {}, secondPatch: {} };
        const { etag } = await readWithEtag(itemPath(contact));
        const updated = await patch(contact, { [contactField]: paymentMethodId }, etag);
        expectStatus(updated, 200);
        assert.equal(updated.json.data.attributes[contactField], paymentMethodId, `the contact reads back its ${contactField}`);

        const header = await createDraftOrder(kind, { contactId, addressId, warehouseId });
        await createRecord(
          `${kind}/${header.id}/lines`,
          resource(`${kind}-lines`, { ordered_quantity: 1, list_price: 10, discount: 0 }, { product: ['product', productId] }),
        );
        completable = { collection: kind, type: kind, id: header.id, firstPatch: { order_date: '2026-10-15' }, secondPatch: {} };
        assert.equal(header.data.attributes.payment_method, paymentMethodId, 'the order inherits the payment method of its contact');
      });

      it('completes the order: 200, and it reads back with document_status CO', async () => {
        const res = await api('POST', `${kind}/${completable.id}/actions/complete`);
        markCompleted(res, itemPath(completable));
        expectStatus(res, 200);
        assert.equal(res.json.data.id, completable.id, 'the answer is the order re-read after the action');
        assert.equal(res.json.data.attributes.document_status, 'CO', 'the answer shows the new status');
        assert.notEqual(res.json.meta?.alreadyApplied, true, 'the first completion really ran');

        const reread = await api('GET', itemPath(completable));
        expectStatus(reread, 200);
        assert.equal(reread.json.data.attributes.document_status, 'CO');
      });

      it('completing it again answers 200 with meta.alreadyApplied', async () => {
        const res = await api('POST', `${kind}/${completable.id}/actions/complete`);
        expectStatus(res, 200);
        assert.equal(res.json.meta?.alreadyApplied, true);
        assert.equal(res.json.data.attributes.document_status, 'CO');
      });

      it('a PATCH and a DELETE on the completed order are refused and leave it unchanged', async () => {
        const { etag } = await readWithEtag(itemPath(completable));
        expectErrorDocument(await patch(completable, completable.firstPatch, etag), COMPLETED_WRITE_STATUS);
        expectErrorDocument(await api('DELETE', itemPath(completable)), COMPLETED_WRITE_STATUS);
        const { res } = await readWithEtag(itemPath(completable));
        assert.equal(res.json.data.attributes.document_status, 'CO');
        assert.notEqual(String(res.json.data.attributes.order_date), '2026-10-15', 'the refused PATCH did not land');
      });

      it('a PATCH sending only currency_rate on the completed order answers 422 and leaves the rate unchanged', async () => {
        const { res: before, etag } = await readWithEtag(itemPath(completable));
        const rateBefore = Number(before.json.data.attributes.currency_rate);
        assert.ok(Number.isFinite(rateBefore), `the completed order must expose a numeric currency_rate, got ${JSON.stringify(before.json.data.attributes.currency_rate)}`);
        const sent = rateBefore + 0.5;
        expectErrorDocument(await patch(completable, { currency_rate: sent }, etag), COMPLETED_WRITE_STATUS);
        const { res } = await readWithEtag(itemPath(completable));
        assert.equal(Number(res.json.data.attributes.currency_rate), rateBefore, 'the refused PATCH did not change currency_rate');
      });
    });
  });
}

/** The contact field an order of each kind inherits its payment method from. */
const CONTACT_PAYMENT_FIELD = { 'sales-order': 'payment_method', 'purchase-order': 'purchase_payment_method' } as const;

const EMPTY_LOOKUP = 'the payment-method lookup answered no value: the test tenant needs at least one active payment method '
  + '(the lookup lists the same payment methods the app offers)';

/** Status the API answers to a write on a completed order (Etendo's own document rule). */
const COMPLETED_WRITE_STATUS = 422;

export async function createDraftOrder(
  kind: string,
  { contactId, addressId, warehouseId }: { contactId: string; addressId: string; warehouseId: string },
  extra: Record<string, unknown> = {},
) {
  return createRecord(
    kind,
    resource(kind, { order_date: '2026-10-14', partner_address: addressId, warehouse: warehouseId, ...extra }, {
      business_partner: ['contacts', contactId],
    }),
  );
}

export const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

interface ForeignCurrencySetup { currencyId: string; rate: number; catalogPrice: number; productId: string; orgCurrency: string }

const MAX_PRODUCT_CANDIDATES = 10;

/**
 * The organization currency is read from a draft order created without `currency` (Etendo defaults
 * it), and the foreign one from the first published conversion rate that starts at it and is valid
 * on `orderDate`. The catalog price of a product is what the same line costs on that org-currency
 * order (no `list_price` sent), which is the price list the foreign order converts, so the
 * expectation does not depend on how the tenant maintains product prices. Returns the reason to
 * skip when the tenant lacks the setup.
 */
export async function findForeignCurrency(
  kind: string,
  ids: { contactId: string; addressId: string; warehouseId: string },
  orderDate: string,
): Promise<ForeignCurrencySetup | string> {
  const probe = await createDraftOrder(kind, ids, { order_date: orderDate });
  const orgCurrency = probe.data.attributes.currency;
  if (typeof orgCurrency !== 'string' || !orgCurrency) return `the ${kind} created without currency carries no currency: cannot tell the organization currency`;

  const rates = await api('GET', 'conversion-rates?page[size]=100');
  expectStatus(rates, 200);
  // Validity is a date-time since ETP-6365; compare calendar days, as the order date has no time.
  const day = (value: string) => value.slice(0, 10);
  if (num(rates.json.meta?.page?.total) > 100) return 'the tenant has more than 100 conversion rates: the first page cannot tell which one applies, so the foreign-currency checks are skipped';
  const valid = (rates.json.data as Array<{ attributes: Record<string, any> }>).filter(({ attributes: a }) =>
    a.currency === orgCurrency && a.to_currency && a.to_currency !== orgCurrency && a.multiple_rate_by != null && Number(a.multiple_rate_by) > 0
    && (!a.valid_from_date || day(a.valid_from_date) <= orderDate)
    && (!a.valid_to_date || day(a.valid_to_date) >= orderDate));
  if (!valid.length) {
    return `the tenant has no conversion rate from the organization currency (${orgCurrency}) valid on ${orderDate}: `
      + 'add one (Currency > Conversion Rates) to run the foreign-currency order checks';
  }
  // A target currency with several rates valid on the same day (overlapping ranges) is ambiguous: which
  // one Etendo applies is not decidable from the list. Pick a currency that has exactly one; skip only
  // when none does.
  const perCurrency = new Map<string, typeof valid>();
  for (const rate of valid) perCurrency.set(rate.attributes.to_currency, [...(perCurrency.get(rate.attributes.to_currency) ?? []), rate]);
  const unambiguous = [...perCurrency.values()].find((group) => group.length === 1);
  if (!unambiguous) return `every target currency from ${orgCurrency} has several conversion rates valid on ${orderDate}: the applied one is ambiguous, foreign-currency checks skipped`;
  const match = unambiguous[0];

  const products = await api('GET', `product?page[size]=${MAX_PRODUCT_CANDIDATES}`);
  expectStatus(products, 200);
  for (const product of products.json.data as Array<{ id: string }>) {
    const res = await api('POST', `${kind}/${probe.id}/lines`, {
      body: resource(`${kind}-lines`, { ordered_quantity: 1, discount: 0 }, { product: ['product', product.id] }),
    });
    if (res.status !== 201) continue;
    const price = Number(res.json.data.attributes.list_price);
    if (Number.isFinite(price) && price > 0) {
      return { currencyId: match.attributes.to_currency, rate: Number(match.attributes.multiple_rate_by), catalogPrice: price, productId: product.id, orgCurrency };
    }
  }
  return `no product among the first ${MAX_PRODUCT_CANDIDATES} has a positive catalog price on the ${kind} price list: `
    + 'the tenant needs a priced product to check the conversion';
}

// --- document rules shared by both orders -----------------------------------------------------------
// Each test creates what it needs inside scoped(), so it removes it even when it fails. The
// completed order of the last block cannot be removed: it is reported as left behind.

const CENT = 0.01;

/**
 * Declares a completed order (and its lines) as left behind right after the complete answer, before any
 * assertion can throw. A refusal (4xx) leaves a draft, which the cleanup deletes; a success or an
 * unknown outcome (5xx: the action may have been applied) is kept.
 */
function markCompleted(res: { status: number }, orderPath: string, linePaths: string[] = []): void {
  if (res.status >= 400 && res.status < 500) return;
  keepAsLeftover(orderPath, 'completed order: Etendo cannot delete it and the API publishes no void action');
  for (const path of linePaths) keepAsLeftover(path, 'line of a completed order');
}
const SNAKE_CASE = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/;
const num = (value: unknown) => Number(value);
const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
const taxIdOf = (line: any): string | undefined => line.relationships?.tax?.data?.id ?? (typeof line.attributes?.tax === 'string' ? line.attributes.tax : undefined);

interface Ctx { contactId: string; addressId: string; productId: string; warehouseId: string; paymentMethodId: string }

export function describeOrderDocumentRules(kind: 'sales-order' | 'purchase-order'): void {
  describe(`${kind} document rules`, () => {
    after(cleanupCreated);
    const ctx = {} as Ctx;
    const orderDate = new Date().toISOString().slice(0, 10);
    const draft = (extra: Record<string, unknown> = {}) => createDraftOrder(kind, ctx, { payment_method: ctx.paymentMethodId, ...extra });
    const addLine = (orderId: string, attributes: Record<string, unknown>, productId = ctx.productId) =>
      createRecord(`${kind}/${orderId}/lines`, resource(`${kind}-lines`, attributes, { product: ['product', productId] }));

    before(async () => {
      const contact = await createContact('rules-partner', kind === 'sales-order' ? { is_customer: true } : { is_vendor: true });
      ctx.contactId = contact.id;
      ctx.addressId = (await createAddress(contact.id)).id;
      ctx.productId = (await createProduct('rules-item')).id;
      ctx.warehouseId = await firstWarehouseId(kind);
      ctx.paymentMethodId = await firstPaymentMethodId(kind);
    });

    it('completing an order with no lines is refused with 422 and the order stays a draft', async () => {
      await scoped(async () => {
        const header = await draft();
        assert.equal(header.data.attributes.payment_method, ctx.paymentMethodId, 'the only missing piece is the lines, not the payment method');
        const error = expectErrorDocument(await api('POST', `${kind}/${header.id}/actions/complete`), 422);
        assert.match(error.code, SNAKE_CASE, 'the refusal carries a snake_case code');
        const { res } = await readWithEtag(`${kind}/${header.id}`);
        assert.equal(res.json.data.attributes.document_status, 'DR');
      });
    });

    it('PATCHing the product of a line re-prices it: list_price, uom, tax and line_gross_amount follow the new product', async (t) => {
      await scoped(async () => {
        const header = await draft();
        // Products created through the API have no price: two products with different catalog prices
        // are looked for among the tenant's own (the price a line takes when it is created without list_price).
        const priced = new Map<string, { id: string; price: number }>();
        const candidates = await api('GET', 'product?page[size]=10');
        expectStatus(candidates, 200);
        for (const product of candidates.json.data as Array<{ id: string }>) {
          if (priced.size >= 2) break;
          const probe = await api('POST', `${kind}/${header.id}/lines`, {
            body: resource(`${kind}-lines`, { ordered_quantity: 1, discount: 0 }, { product: ['product', product.id] }),
          });
          const price = num(probe.json?.data?.attributes?.list_price);
          if (probe.status === 201 && price > 0 && !priced.has(String(price))) priced.set(String(price), { id: product.id, price });
        }
        if (priced.size < 2) return t.skip('the tenant needs two products with different positive catalog prices on the price list');
        const [first, second] = [...priced.values()];

        const line = await addLine(header.id, { ordered_quantity: 2, discount: 0 }, first.id);
        const before = line.data;
        assert.equal(num(before.attributes.list_price), first.price);
        const { etag } = await readWithEtag(line.path);
        const res = await api('PATCH', line.path, {
          body: resource(`${kind}-lines`, {}, { product: ['product', second.id] }, line.id),
          headers: { 'If-Match': etag },
        });
        expectStatus(res, 200);
        const { res: reread } = await readWithEtag(line.path);
        const after = reread.json.data;
        assert.equal(after.relationships.product.data.id, second.id, 'the line points at the new product');
        assert.equal(num(after.attributes.list_price), second.price, 'list_price is the new product catalog price, not the old one');
        assert.notEqual(num(after.attributes.line_gross_amount), num(before.attributes.line_gross_amount), 'line_gross_amount was recalculated');
        assert.ok(num(after.attributes.line_gross_amount) > 0);
        assert.equal(typeof after.attributes.uom, 'string', 'uom is set from the new product');
        assert.ok(taxIdOf(after), 'a tax is set for the new product');
        const total = await api('GET', `${kind}/${header.id}`);
        assert.ok(num(total.json.data.attributes.grand_total_amount) >= num(after.attributes.line_gross_amount) - CENT, 'the header total follows the line');
      });
    });

    describe('currency_rate recalculation (docs/public-api.md 4.12)', () => {
      let setup: Awaited<ReturnType<typeof findForeignCurrency>>;

      before(async () => {
        setup = await scoped(() => findForeignCurrency(kind, ctx, orderDate));
      });

      const fetchRates = async () => {
        const rates = await api('GET', 'conversion-rates?page[size]=100');
        expectStatus(rates, 200);
        return rates.json.data as Array<{ attributes: Record<string, any> }>;
      };
      const rateOn = (rates: Awaited<ReturnType<typeof fetchRates>>, from: ForeignCurrencySetup, day: string): number | undefined => {
        const matches = rates.filter(({ attributes: a }) =>
          a.currency === from.orgCurrency && a.to_currency === from.currencyId && a.multiple_rate_by != null && Number(a.multiple_rate_by) > 0
          && (!a.valid_from_date || a.valid_from_date.slice(0, 10) <= day) && (!a.valid_to_date || a.valid_to_date.slice(0, 10) >= day));
        return matches.length === 1 ? Number(matches[0].attributes.multiple_rate_by) : undefined; // several candidates: ambiguous, the day is not used
      };

      it('changing currency without sending currency_rate recalculates it, and back to the organization currency sets 1', async (t) => {
        if (typeof setup === 'string') return t.skip(setup);
        const found = setup;
        await scoped(async () => {
          const header = await draft({ order_date: orderDate, currency: found.orgCurrency });
          const spec: LifecycleSpec = { collection: kind, type: kind, id: header.id, firstPatch: {}, secondPatch: {} };
          const initial = header.data.attributes.currency_rate;
          assert.ok(initial === null || initial === undefined || num(initial) === 1, `an order in the organization currency has no rate or 1, got ${initial}`);

          let { etag } = await readWithEtag(itemPath(spec));
          let res = await patch(spec, { currency: found.currencyId }, etag);
          expectStatus(res, 200);
          assert.equal(num(res.json.data.attributes.currency_rate), found.rate, 'the published rate valid on order_date is set');

          ({ etag } = await readWithEtag(itemPath(spec)));
          res = await patch(spec, { currency: found.orgCurrency }, etag);
          expectStatus(res, 200);
          assert.equal(num(res.json.data.attributes.currency_rate), 1, 'back to the organization currency sets the rate to 1');
        });
      });

      it('changing order_date without sending currency_rate replaces a rate set by hand with the one valid on the new date', async (t) => {
        if (typeof setup === 'string') return t.skip(setup);
        const found = setup;
        const rates = await fetchRates();
        let newDate = '';
        let expected: number | undefined;
        for (let back = 1; back <= 60 && expected === undefined; back += 1) {
          const day = new Date(Date.now() - back * 86_400_000).toISOString().slice(0, 10);
          expected = rateOn(rates, found, day);
          if (expected !== undefined) newDate = day;
        }
        if (expected === undefined) return t.skip('no conversion rate is valid on a day before today: the date change cannot be observed');
        await scoped(async () => {
          const byHand = round2(found.rate * 2 + 0.5);
          const header = await draft({ order_date: orderDate, currency: found.currencyId, currency_rate: byHand });
          assert.equal(num(header.data.attributes.currency_rate), byHand, 'the rate sent on create is kept');
          const spec: LifecycleSpec = { collection: kind, type: kind, id: header.id, firstPatch: {}, secondPatch: {} };
          const { etag } = await readWithEtag(itemPath(spec));
          const res = await patch(spec, { order_date: newDate }, etag);
          expectStatus(res, 200);
          assert.equal(num(res.json.data.attributes.currency_rate), expected, `the rate valid on ${newDate} replaces the hand-set ${byHand}`);
        });
      });
    });

    // The order of this block cannot be removed once completed: it is reported as left behind.
    describe('totals, taxes and the lock after completing (several lines, one with a discount)', () => {
      let orderId = '';
      let lines: Array<{ id: string; path: string; quantity: number }> = [];
      let draftTotal = 0;
      let draftLineAmounts: number[] = [];

      const readLines = async () => {
        const res = await api('GET', `${kind}/${orderId}/lines?page[size]=100&sort=id`);
        expectStatus(res, 200);
        return res.json.data as any[];
      };

      before(async () => {
        const header = await draft();
        orderId = header.id;
        const specs: Array<Record<string, unknown>> = [
          { ordered_quantity: 10, list_price: 100, discount: 0 },
          { ordered_quantity: 10, list_price: 100, discount: 10 },
          { ordered_quantity: 3, list_price: 5.5, discount: 0 },
        ];
        for (const spec of specs) {
          const line = await addLine(orderId, spec);
          lines.push({ id: line.id, path: line.path, quantity: Number(spec.ordered_quantity) });
        }
      });

      it('as a draft, the header total is the sum of the line gross amounts, and the discount lowers a line', async () => {
        const read = await readLines();
        assert.equal(read.length, lines.length);
        draftLineAmounts = lines.map((line) => num(read.find((r) => r.id === line.id).attributes.line_gross_amount));
        for (const amount of draftLineAmounts) assert.ok(Number.isFinite(amount) && amount > 0, 'every line carries a positive line_gross_amount');
        const header = await api('GET', `${kind}/${orderId}`);
        expectStatus(header, 200);
        draftTotal = num(header.json.data.attributes.grand_total_amount);
        assert.ok(Math.abs(draftTotal - sum(draftLineAmounts)) <= CENT * lines.length, `grand_total_amount ${draftTotal} is the sum of the lines ${sum(draftLineAmounts)}`);

        const [full, discounted] = draftLineAmounts;
        assert.ok(discounted < full, 'a line with discount 10 is worth less than the same line with discount 0');
        // discount is a percentage (Etendo standard, not spelled out in docs/public-api.md); tax is proportional.
        assert.ok(Math.abs(discounted / full - 0.9) < 0.01, `the 10% discount line is ${discounted}, expected 90% of ${full}`);
      });

      it('every line carries a tax that exists in the tax resource', async () => {
        for (const line of await readLines()) {
          const taxId = taxIdOf(line);
          assert.ok(taxId, `line ${line.id} has no tax`);
          expectStatus(await api('GET', `tax/${taxId}`), 200, `the tax ${taxId} of line ${line.id} is readable`);
        }
      });

      it('completes the order: 200 and CO', async () => {
        const res = await api('POST', `${kind}/${orderId}/actions/complete`);
        markCompleted(res, `${kind}/${orderId}`, lines.map((line) => line.path));
        expectStatus(res, 200);
        assert.equal(res.json.data.attributes.document_status, 'CO');
      });

      it('the total and every line amount are unchanged between DR and CO, and the total is still the sum of the lines', async () => {
        const read = await readLines();
        const amounts = lines.map((line) => num(read.find((r) => r.id === line.id).attributes.line_gross_amount));
        assert.deepEqual(amounts, draftLineAmounts, 'line amounts did not change on completion');
        const header = await api('GET', `${kind}/${orderId}`);
        assert.equal(num(header.json.data.attributes.grand_total_amount), draftTotal, 'grand_total_amount did not change on completion');
        assert.ok(Math.abs(num(header.json.data.attributes.grand_total_amount) - sum(amounts)) <= CENT * lines.length);
        for (const line of read) assert.ok(taxIdOf(line), `line ${line.id} still has its tax after completing`);
        // The header publishes no net or tax amount: tax is checked per line (tax) and through the gross total.
      });

      it('a line POST, PATCH and DELETE on the completed order are refused with 422 and change nothing', async () => {
        const before = await readLines();
        const post = await api('POST', `${kind}/${orderId}/lines`, {
          body: resource(`${kind}-lines`, { ordered_quantity: 1, list_price: 1, discount: 0 }, { product: ['product', ctx.productId] }),
        });
        expectErrorDocument(post, COMPLETED_WRITE_STATUS);

        const [target] = lines;
        const { etag } = await readWithEtag(target.path);
        const patched = await api('PATCH', target.path, {
          body: resource(`${kind}-lines`, { ordered_quantity: target.quantity + 1 }, undefined, target.id),
          headers: { 'If-Match': etag },
        });
        expectErrorDocument(patched, COMPLETED_WRITE_STATUS);
        expectErrorDocument(await api('DELETE', target.path), COMPLETED_WRITE_STATUS);

        const after = await readLines();
        assert.equal(after.length, before.length, 'no line was added or removed');
        assert.equal(num(after.find((r) => r.id === target.id).attributes.ordered_quantity), target.quantity, 'the refused PATCH did not land');
        const header = await api('GET', `${kind}/${orderId}`);
        assert.equal(header.json.data.attributes.document_status, 'CO');
        assert.equal(num(header.json.data.attributes.grand_total_amount), draftTotal);
      });
    });
  });
}
