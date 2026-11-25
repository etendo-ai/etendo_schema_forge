// @covers tools/app-shell/src/windows/custom/product/ProductMovementsTab.jsx
// @covers tools/app-shell/src/windows/custom/product/productMovements.js
// @covers tools/app-shell/src/windows/custom/product/ProductSidebar.jsx
// @covers tools/app-shell/src/windows/custom/product/useStockHistory.js
// @covers tools/app-shell/src/windows/custom/product/ProductSidebarCollapsed.jsx
// @covers tools/app-shell/src/windows/custom/product/ProductSidebarDividerToggle.jsx
// @covers tools/app-shell/src/windows/custom/product/useSidebarCollapsed.js
// @covers tools/app-shell/src/lib/chartPalette.js
// @covers tools/app-shell/src/components/contract-ui/TabStripButton.jsx
// @covers tools/app-shell/src/components/contract-ui/saveActions.jsx
import { test, expect } from '../../helpers/test.js';
import { login } from '../../helpers/auth.js';

/**
 * Product Movements tab, stock side panel and the Product header — mocked spec.
 *
 * Guards: the row layout (date + time on one line, type pill + document link) at a constrained
 * container width, the scroll box and its sticky header, the 7-day default period, the server-side
 * Type sort request, the sticky period-total row fed by `response.totals` (asked for on the first
 * page only), the two empty states, the side panel (divider toggle, collapsed strip, stock card,
 * warehouse cards, chart palette) and its failed reads, and the Product header (filled Save, blue
 * active tab, no counter on Movimientos). The mock session renders in es_ES.
 */

const PRODUCT = {
  id: 'PROD-MOV-1',
  searchKey: 'PROD-MOV-1',
  name: 'Stocked product',
  '_identifier': 'Stocked product',
  productType: 'I',
  'productType$_identifier': 'Item',
  stocked: true,
  organization: 'org-1',
  client: 'client-1',
};

const MOVEMENT = {
  id: 'mov-1',
  movementDate: '2026-10-20',
  etgoProcessTime: '2026-10-20T14:35:10',
  movementQuantity: 12,
  movementType: 'V+',
  etgoDocKind: 'goods-receipt',
  etgoDocWindow: 'goods-receipt',
  etgoDocHeaderId: 'doc-1',
  etgoDocLabel: 'GR-0001',
  'etgoWarehouse$_identifier': 'Main warehouse',
  transactionCost: 100,
  etgoStockAfter: 12,
};

const OUT_MOVEMENT = {
  ...MOVEMENT,
  id: 'mov-2',
  etgoProcessTime: '2026-10-20T16:05:00',
  movementQuantity: -15,
  movementType: 'C-',
  etgoDocKind: 'goods-shipment',
  etgoDocWindow: 'goods-shipment',
  etgoDocHeaderId: 'doc-2',
  etgoDocLabel: 'GS-0002',
  etgoStockAfter: -3,
};

const STOCK_ROWS = [{ storageBin: 'LOC1', 'warehouse$_identifier': 'Main warehouse', quantityOnHand: 1530 }];
const HISTORY_ROWS = [{ movementDate: '2026-10-20', etgoProcessTime: '2026-10-20T14:35:10', movementQuantity: 1530, storageBin: 'LOC1' }];

// Two warehouses: the stock card shows "2 ubicaciones" and the chart draws two series.
const TWO_WAREHOUSE_STOCK = [
  { storageBin: 'LOC1', warehouse: 'WH-1', 'warehouse$_identifier': 'Main warehouse', quantityOnHand: 1000 },
  { storageBin: 'LOC2', warehouse: 'WH-2', 'warehouse$_identifier': 'Second warehouse', quantityOnHand: 530 },
];
const TWO_WAREHOUSE_HISTORY = [
  { movementDate: '2026-10-20', etgoProcessTime: '2026-10-20T09:12:00', movementQuantity: 1000, storageBin: 'LOC1' },
  { movementDate: '2026-10-21', etgoProcessTime: '2026-10-21T16:40:30', movementQuantity: 530, storageBin: 'LOC2' },
];

// Design tokens (index.css), as the browser computes them.
const NEGATIVE_FG = 'rgb(184, 46, 0)';
const POSITIVE_FG = 'rgb(23, 102, 58)';
const SURFACE_SUBTLE = 'rgb(245, 247, 249)';
const PRIMARY = 'rgb(50, 92, 255)';
const PRIMARY_HOVER_STRONG = 'rgb(43, 72, 188)';
const SERIES_FILLS = ['rgb(184, 250, 80)', 'rgb(179, 161, 255)', 'rgb(50, 92, 255)'];

const json = (route, status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
/** A NEO list page; `totals` is the opt-in `response.totals` of the Movements tab (omitted when undefined). */
const page_ = (data, totals) => ({ response: { data, totalRows: data.length, ...(totals ? { totals } : {}) } });
const isProbe = (url) => url.includes('_endRow=0');
/** The side panel also reads a 500-row history from /transactions; the tab's own pages are the others. */
const tabCalls = (calls) => calls.filter((u) => !u.includes('_endRow=499'));
const startRowOf = (url) => Number(new URL(url).searchParams.get('_startRow'));

/**
 * Installs the product detail, /stock and /transactions mocks AFTER login() (LIFO route matching).
 * `transactions(url)` decides each answer; every /transactions URL is recorded in `calls`.
 */
async function installMocks(page, { stock = () => [200, page_(STOCK_ROWS)], transactions }, calls) {
  await page.route('**/sws/neo/product/product/**', async (route) => {
    const url = route.request().url();
    if (route.request().method() !== 'GET' || /\/selectors\//.test(url)) return route.fallback();
    return json(route, 200, { response: { data: [PRODUCT] } });
  });
  await page.route('**/sws/neo/product/stock**', async (route) => {
    const [status, body] = await stock(route.request().url());
    return json(route, status, body);
  });
  await page.route('**/sws/neo/product/transactions**', async (route) => {
    const url = route.request().url();
    calls.push(url);
    const [status, body] = transactions(url);
    return json(route, status, body);
  });
}

async function openMovements(page) {
  await page.goto(`/product/${PRODUCT.id}`);
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
  await page.getByTestId('tab-custom:movements').click();
}

/** Opens the product with the given transactions answer and returns the recorded /transactions URLs. */
async function openMovementsWith(page, transactions) {
  const calls = [];
  await login(page);
  await installMocks(page, { transactions }, calls);
  await openMovements(page);
  return calls;
}

test.describe('Product movements tab — layout and sort', () => {
  let calls;

  test.beforeEach(async ({ page }) => {
    calls = [];
    await login(page);
    await installMocks(page, { transactions: () => [200, page_([MOVEMENT, OUT_MOVEMENT])] }, calls);
    await openMovements(page);
  });

  test('keeps date and time on one line and the type pill beside the document chip, even in a narrow container', async ({ page }) => {
    const row = page.getByTestId('product-movements-row').first();
    await expect(row).toBeVisible({ timeout: 10_000 });

    const time = row.getByTestId('product-movements-time');
    await expect(time).toHaveText('14:35');
    const dateBox = await row.getByText('2026', { exact: false }).first().boundingBox();
    const timeBox = await time.boundingBox();
    expect(Math.abs((dateBox.y + dateBox.height / 2) - (timeBox.y + timeBox.height / 2))).toBeLessThan(6);

    const chip = row.getByTestId('product-movements-doc-link');
    await expect(chip).toContainText('GR-0001');
    await expect(chip.locator('svg').first()).toBeVisible();

    // Constrain the container (not the window): the page itself must not grow a horizontal scrollbar
    // and the cells of a row must never overlap each other.
    await page.getByTestId('product-movements-tab').evaluate((el) => { el.style.width = '640px'; });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    const cells = await row.locator('[role="cell"]').evaluateAll((els) => els.map((e) => {
      const r = e.getBoundingClientRect();
      return { left: r.left, right: r.right };
    }));
    for (let i = 1; i < cells.length; i++) expect(cells[i].left).toBeGreaterThanOrEqual(cells[i - 1].right - 1);
  });

  test('rows are one line, the document is an underlined link and the quantity sign picks the colour', async ({ page }) => {
    const rows = page.getByTestId('product-movements-row');
    await expect(rows).toHaveCount(2, { timeout: 10_000 });
    const [inRow, outRow] = [rows.nth(0), rows.nth(1)];

    // Date cell and type cell never wrap; the link (icon + label) stays on one line.
    await expect(inRow.locator('[role="cell"]').nth(0)).toHaveCSS('white-space', 'nowrap');
    await expect(inRow.locator('[role="cell"]').nth(1)).toHaveCSS('white-space', 'nowrap');
    const link = inRow.getByTestId('product-movements-doc-link');
    await expect(link).toHaveCSS('text-decoration-line', 'underline');
    const linkBox = await link.boundingBox();
    expect(linkBox.height).toBeLessThan(24);
    const typeBox = await inRow.getByTestId('product-movements-type').boundingBox();
    expect(Math.abs((typeBox.y + typeBox.height / 2) - (linkBox.y + linkBox.height / 2))).toBeLessThan(4);

    // Quantity column (4th cell): green with a plus for an entry, the dark-red token with U+2212 for an exit.
    const inQty = inRow.locator('[role="cell"]').nth(3);
    const outQty = outRow.locator('[role="cell"]').nth(3);
    await expect(inQty).toHaveText('+12');
    await expect(inQty).toHaveCSS('color', POSITIVE_FG);
    await expect(outQty).toHaveText('−15');
    await expect(outQty).toHaveCSS('color', NEGATIVE_FG);
  });

  test('the scroll box has no frame, a compact floor (at most 200 px, never the old 340) and a white sticky header', async ({ page }) => {
    await expect(page.getByTestId('product-movements-row').first()).toBeVisible({ timeout: 10_000 });
    const box = page.getByTestId('product-movements-scroll');
    // Loaded rows use the compact floor: min(MOVEMENTS_TABLE_COMPACT_MIN_HEIGHT = 200, content), not 340.
    const minHeight = Number.parseFloat(await box.evaluate((el) => getComputedStyle(el).minHeight));
    expect(minHeight).toBeGreaterThan(0);
    expect(minHeight).toBeLessThanOrEqual(200);
    await expect(box).toHaveCSS('border-top-width', '0px');
    await expect(box).toHaveCSS('border-left-width', '0px');
    await expect(box).toHaveCSS('border-top-left-radius', '0px');
    expect((await box.boundingBox()).height).toBeGreaterThanOrEqual(minHeight - 1);

    const header = box.locator('[role="row"]').first();
    await expect(header.getByRole('columnheader').first()).toBeVisible();
    await expect(header).toHaveCSS('position', 'sticky');
    await expect(header).toHaveCSS('top', '0px');
    await expect(header).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  });

  test('opens on the last 7 days: the first page asks for today minus 6 to today', async ({ page }) => {
    await expect(page.getByTestId('product-movements-row').first()).toBeVisible({ timeout: 10_000 });
    const [from, to] = await page.evaluate(() => {
      const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const today = new Date();
      const weekAgo = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6);
      return [iso(weekAgo), iso(today)];
    });
    const criteria = JSON.parse(new URL(tabCalls(calls)[0]).searchParams.get('criteria'));
    expect(criteria).toEqual(expect.arrayContaining([
      { fieldName: 'transactionProcessDate', operator: 'greaterOrEqual', value: from },
      { fieldName: 'transactionProcessDate', operator: 'lessOrEqual', value: to },
    ]));
  });

  test('sorting by Type sends the label order next to the Type sort and aria-sort follows it', async ({ page }) => {
    await expect(page.getByTestId('product-movements-row').first()).toBeVisible({ timeout: 10_000 });
    expect(calls.some((u) => u.includes('typeLabelOrder'))).toBe(false);

    const typeHeader = page.getByRole('columnheader').nth(1);
    const request = page.waitForRequest((r) => r.url().includes('/transactions') && r.url().includes('typeLabelOrder'));
    await typeHeader.getByRole('button').click();
    const params = new URL((await request).url()).searchParams;
    expect(params.get('_sortBy')).toMatch(/^-?etgoDocKind,/);
    expect(params.get('typeLabelOrder').split(',').sort()).toEqual([
      'customer-return', 'customer-shipment', 'internal-consumption', 'inventory-in',
      'inventory-out', 'transfer', 'vendor-receipt', 'vendor-return',
    ]);
    await expect(typeHeader).toHaveAttribute('aria-sort', /ascending|descending/);
  });
});

/**
 * Horizontal edges of the numeric columns (Cantidad, Costo, Stock resultante) in the header, every data row and
 * the period Total. The Total row has no cell per column: its Cantidad value is the 4th grid item and its
 * trailing spacer spans Costo + Stock, so the spacer's left edge is Costo's left edge and its right edge is
 * Stock's right edge.
 */
async function numericColumnEdges(page) {
  return page.getByTestId('product-movements-scroll').evaluate((box) => {
    const edge = (el) => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right }; };
    const headerCells = [...box.querySelector('[role="row"]').querySelectorAll('[role="columnheader"]')];
    const rows = [...box.querySelectorAll('[data-testid="product-movements-row"]')].map((row) => {
      const cells = row.querySelectorAll('[role="cell"]');
      return { quantity: edge(cells[3]), cost: edge(cells[4]), stock: edge(cells[5]), row: edge(row) };
    });
    const total = document.querySelector('[data-testid="product-movements-total"]');
    const spacer = total.querySelector('[aria-hidden="true"]');
    return {
      header: { quantity: edge(headerCells[3]), cost: edge(headerCells[4]), stock: edge(headerCells[5]), row: edge(box.querySelector('[role="row"]')) },
      rows,
      total: {
        quantity: edge(total.querySelector('[data-testid="product-movements-total-value"]')),
        costLeft: edge(spacer).left,
        stockRight: edge(spacer).right,
        row: edge(total.firstElementChild),
        outer: edge(total),
      },
    };
  });
}

/** Header, every data row and the Total share the left and right edges of the three numeric columns (1 px). */
function expectAlignedColumns(e) {
  const near = (a, b) => expect(Math.abs(a - b)).toBeLessThanOrEqual(1);
  expect(e.rows.length).toBeGreaterThan(0);
  for (const r of e.rows) {
    for (const col of ['quantity', 'cost', 'stock']) {
      near(r[col].left, e.header[col].left);
      near(r[col].right, e.header[col].right);
    }
  }
  near(e.total.quantity.left, e.header.quantity.left);
  near(e.total.quantity.right, e.header.quantity.right);
  near(e.total.costLeft, e.header.cost.left);
  near(e.total.stockRight, e.header.stock.right);
}

const NUMERIC_ROWS = (n) => Array.from({ length: n }, (_, i) => ({
  ...MOVEMENT, id: `mov-num-${i}`, etgoDocLabel: `GR-${String(i).padStart(4, '0')}`, movementQuantity: 10 + i, transactionCost: 1234.5 + i, etgoStockAfter: 100 + i,
}));

test.describe('Product movements tab — column geometry', () => {
  test('the Fecha column reads day and time from the process timestamp (TrxProcessDate), not from the movement date', async ({ page }) => {
    // The movement date says 01/01 but the transaction was processed on 20/10 at 14:35: the tab shows the latter.
    const calls = await openMovementsWith(page, () => [200, page_([{ ...MOVEMENT, movementDate: '2026-01-01' }])]);
    const row = page.getByTestId('product-movements-row').first();
    await expect(row).toBeVisible({ timeout: 10_000 });
    await expect(row.locator('[role="cell"]').first()).toContainText('20/10/2026');
    await expect(row.locator('[role="cell"]').first()).not.toContainText('01/01/2026');
    await expect(row.getByTestId('product-movements-time')).toHaveText('14:35');
    // Newest-first by the same field, id as the tie-break.
    expect(new URL(tabCalls(calls)[0]).searchParams.get('_sortBy')).toBe('-transactionProcessDate,-id');
  });

  test('the cost header is 170 px wide and never truncates its label, with no sort and in both sort directions', async ({ page }) => {
    await openMovementsWith(page, () => [200, page_([MOVEMENT, OUT_MOVEMENT], { netQuantity: -3, count: 2 })]);
    await expect(page.getByTestId('product-movements-row').first()).toBeVisible({ timeout: 10_000 });

    const costHeader = page.getByRole('columnheader').nth(4);
    const sortButton = page.getByTestId('column-header-sort-cost');
    const measure = () => costHeader.evaluate((el) => {
      const label = el.querySelector('span.truncate');
      return { width: el.getBoundingClientRect().width, scrollWidth: label.scrollWidth, clientWidth: label.clientWidth, text: label.textContent };
    });

    // Cycle the sort: none -> first direction -> the other direction, asserting each state once.
    const seen = new Set();
    for (let i = 0; i < 3; i++) {
      const state = (await costHeader.getAttribute('aria-sort')) ?? 'none';
      seen.add(state);
      const m = await measure();
      expect(Math.round(m.width), `cost column width (${state})`).toBe(170);
      expect(m.text.length).toBeGreaterThan(0);
      expect(m.scrollWidth, `cost label truncated (${state})`).toBeLessThanOrEqual(m.clientWidth);
      await sortButton.click();
      await expect(costHeader).not.toHaveAttribute('aria-sort', state === 'none' ? /^$/ : state);
    }
    expect(seen).toContain('ascending');
    expect(seen).toContain('descending');
    expect(seen).toContain('none');
  });

  test('header, rows and Total share the numeric columns edges at 1280x720, at both ends of the horizontal scroll', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    const ROWS = NUMERIC_ROWS(4);
    await openMovementsWith(page, () => [200, page_(ROWS, { netQuantity: 46, count: ROWS.length })]);
    await expect(page.getByTestId('product-movements-total')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('product-movements-row')).toHaveCount(ROWS.length);

    const box = page.getByTestId('product-movements-scroll');
    const total = page.getByTestId('product-movements-total');
    const metrics = await box.evaluate((el) => ({
      gridMin: el.querySelector('[role="row"]').getBoundingClientRect().width,
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
    }));
    expect(metrics.gridMin).toBeGreaterThanOrEqual(1014);
    expect(metrics.scrollWidth, 'the table box must scroll horizontally at 1280 px').toBeGreaterThan(metrics.clientWidth);

    await box.evaluate((el) => { el.scrollLeft = 0; });
    expectAlignedColumns(await numericColumnEdges(page));
    expect(await total.evaluate((el) => el.scrollLeft)).toBe(0);

    await box.evaluate((el) => { el.scrollLeft = el.scrollWidth; });
    const maxScroll = await box.evaluate((el) => el.scrollLeft);
    expect(maxScroll).toBeGreaterThan(0);
    // The Total follows through the scroll event.
    await expect.poll(() => total.evaluate((el) => el.scrollLeft)).toBeGreaterThanOrEqual(maxScroll - 1);
    expect(await total.evaluate((el) => el.scrollLeft)).toBeLessThanOrEqual(maxScroll + 1);
    expectAlignedColumns(await numericColumnEdges(page));
  });

  test('no scrollbar gutter is reserved: the Total padding is 0 without overflow and equals the live scrollbar with it', async ({ page }) => {
    let dataset = NUMERIC_ROWS(3);
    await openMovementsWith(page, () => [200, page_(dataset, { netQuantity: 1, count: dataset.length })]);
    const box = page.getByTestId('product-movements-scroll');
    const total = page.getByTestId('product-movements-total');
    await expect(page.getByTestId('product-movements-row')).toHaveCount(3, { timeout: 10_000 });
    await expect(total).toBeVisible();

    const scrollbar = () => box.evaluate((el) => el.offsetWidth - el.clientWidth);
    const paddingRight = () => total.evaluate((el) => Number.parseFloat(getComputedStyle(el).paddingRight));
    const rightEdges = async () => {
      const e = await numericColumnEdges(page);
      return { header: e.header.row.right, row: e.rows[0].row.right, total: e.total.row.right, e };
    };

    // Short list (3 rows: header + rows + the 1014 px grid's horizontal scrollbar stay under the 200 px compact cap): no vertical scrollbar (a shortfall of up to MOVEMENTS_TABLE_SCROLL_TOLERANCE_PX = 4 px is clipped, not scrolled).
    expect(await box.evaluate((el) => el.scrollHeight - el.clientHeight <= 4)).toBe(true);
    expect(await scrollbar()).toBe(0);
    expect(await paddingRight()).toBe(0);
    let edges = await rightEdges();
    expect(Math.abs(edges.header - edges.row)).toBeLessThanOrEqual(1);
    expect(Math.abs(edges.header - edges.total)).toBeLessThanOrEqual(1);
    expectAlignedColumns(edges.e);

    // Long list: the box overflows, classic scrollbars of headless Chromium take 10 px.
    dataset = NUMERIC_ROWS(20);
    await page.getByTestId('product-movements-direction').getByRole('button').nth(1).click();
    await expect(page.getByTestId('product-movements-row')).toHaveCount(20, { timeout: 10_000 });
    // Classic scrollbars take width (10 px); overlay ones (headless Chromium) take none. The invariant holds for both:
    // the Total reserves exactly what the box's live scrollbar takes.
    const live = await scrollbar();
    await expect.poll(paddingRight).toBe(live);
    if (live === 0) {
      test.info().annotations.push({ type: 'note', description: 'overlay scrollbars: the classic-scrollbar branch was not exercised' });
    }
    edges = await rightEdges();
    expect(Math.abs(edges.header - edges.row)).toBeLessThanOrEqual(1);
    expect(Math.abs(edges.header - edges.total)).toBeLessThanOrEqual(1);
    expectAlignedColumns(edges.e);

    // Back to a short list: the reserved width is released, never stale.
    dataset = NUMERIC_ROWS(3);
    await page.getByTestId('product-movements-direction').getByRole('button').nth(0).click();
    await expect(page.getByTestId('product-movements-row')).toHaveCount(3, { timeout: 10_000 });
    await expect.poll(scrollbar).toBe(0);
    await expect.poll(paddingRight).toBe(0);
    edges = await rightEdges();
    expect(Math.abs(edges.header - edges.total)).toBeLessThanOrEqual(1);
    expectAlignedColumns(edges.e);
  });
});

test.describe('Product movements tab — period total row', () => {
  test('a sticky last row sums the period: count, net quantity in dark red with U+2212, bold 15 px', async ({ page }) => {
    // The compact floor lets a 2-row table fit the column at 1280x720; this test needs the column to overflow (it scrolls it to the end).
    await page.setViewportSize({ width: 1280, height: 560 });
    const calls = await openMovementsWith(page, () => [200, page_([MOVEMENT, OUT_MOVEMENT], { netQuantity: -3, count: 2 })]);
    const total = page.getByTestId('product-movements-total');
    await expect(total).toBeVisible({ timeout: 10_000 });
    await expect(total).toHaveAttribute('role', 'group');
    expect(await total.evaluate((el) => Boolean(el.closest('[data-testid="product-movements-scroll"]')))).toBe(false);
    await expect(total).toContainText('Total del período');
    await expect(total.getByTestId('product-movements-total-count')).toHaveText('· 2 movimientos');
    await expect(total).toHaveCSS('position', 'sticky');
    await expect(total).toHaveCSS('bottom', '-8px');
    await expect(total).toHaveCSS('background-color', SURFACE_SUBTLE);

    const value = total.getByTestId('product-movements-total-value');
    await expect(value).toHaveText('−3');
    await expect(value).toHaveCSS('color', NEGATIVE_FG);
    await expect(value).toHaveCSS('font-size', '15px');
    await expect(value).toHaveCSS('font-weight', '700');

    // The total sits under the Quantity column (the 4th cell of a movement row).
    const qtyBox = await page.getByTestId('product-movements-row').first().locator('[role="cell"]').nth(3).boundingBox();
    const valueBox = await value.boundingBox();
    expect(Math.abs((qtyBox.x + qtyBox.width) - (valueBox.x + valueBox.width))).toBeLessThan(2);

    // It is pinned to the column bottom while the page is not scrolled (it may overlay the table's lower edge
    // there, by design); scrolled to the end of the page it rests below every movement row.
    await (await contentColumn(total)).scrollTo('end');
    const lastRowBox = await page.getByTestId('product-movements-row').last().boundingBox();
    await expect.poll(async () => (await total.boundingBox()).y - (lastRowBox.y + lastRowBox.height)).toBeGreaterThanOrEqual(-1);

    // Only the first page asked for the totals.
    expect(tabCalls(calls)).toHaveLength(1);
    expect(new URL(tabCalls(calls)[0]).searchParams.get('etgoTotals')).toBe('true');
  });

  /**
   * The content column that scrolls the Movements tab: the nearest vertically scrolling ancestor of the Total. Fails
   * loudly (instead of silently picking another ancestor) when it is not the column holding the tab strip or does not
   * overflow in the mocked page, since every geometry assertion that uses it depends on that.
   */
  async function contentColumn(total) {
    const found = await total.evaluate((el) => {
      for (let n = el.parentElement; n; n = n.parentElement) {
        const oy = getComputedStyle(n).overflowY;
        if (oy === 'auto' || oy === 'scroll') {
          return { overflows: n.scrollHeight > n.clientHeight, scrollHeight: n.scrollHeight, clientHeight: n.clientHeight, hasTabs: Boolean(n.querySelector('[data-testid="tab-custom:movements"]')) };
        }
      }
      return null;
    });
    expect(found, 'no scrolling ancestor found above the Total').not.toBeNull();
    expect(found.hasTabs, 'the scrolling ancestor must be the content column that holds the tab strip').toBe(true);
    expect(found.overflows, `the content column must overflow in the mocked page (scrollHeight ${found.scrollHeight} vs clientHeight ${found.clientHeight})`).toBe(true);
    const onColumn = (fn, arg) => total.evaluate((el, [source, value]) => {
      for (let n = el.parentElement; n; n = n.parentElement) {
        const oy = getComputedStyle(n).overflowY;
        if (oy === 'auto' || oy === 'scroll') return new Function('n', 'value', source)(n, value);
      }
      return null;
    }, [fn, arg]);
    return {
      scrollTo: (top) => onColumn('n.scrollTop = value === "end" ? n.scrollHeight : value;', top),
      bottom: () => onColumn('return n.getBoundingClientRect().bottom;'),
    };
  }

  // 720 is the supported minimum height; 780 is the tallest viewport where the mocked column still overflows now that the box can shrink to its 200 px compact floor (at 900 it fits and never scrolls). The mocked product page is shorter than a real one
  // (fewer banners above the table), so the geometry that once clamped a Total nested in the table block (table top
  // within one Total height of the column bottom) is only reached at 560 (the 2-row Description puts the table top at about 546, so 600 no longer reaches it). The test asserts that precondition with the
  // measured numbers so it cannot pass vacuously.
  for (const height of [780, 720, 560]) {
    test(`at 1280x${height} nothing paints over the total: its label and value are hit-testable, inside the viewport, flush with the column bottom`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height });
      const MANY = Array.from({ length: 45 }, (_, i) => ({ ...MOVEMENT, id: `mov-many-${i}`, etgoDocLabel: `GR-${String(i).padStart(4, '0')}` }));
      await openMovementsWith(page, () => [200, page_(MANY, { netQuantity: 540, count: MANY.length })]);
      const total = page.getByTestId('product-movements-total');
      await expect(total).toBeVisible({ timeout: 10_000 });
      await expect(page.getByTestId('product-movements-row')).toHaveCount(45);

      const column = await contentColumn(total);
      await column.scrollTo(0);

      const box = await total.boundingBox();
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height).toBeLessThanOrEqual(height);

      // Flush with the content column bottom at scrollTop 0.
      const columnBottom = await column.bottom();
      expect(Math.abs(box.y + box.height - columnBottom)).toBeLessThanOrEqual(1);

      const scrollBox = await page.getByTestId('product-movements-scroll').boundingBox();
      console.log(`GEOMETRY height=${height} tableTop=${scrollBox.y} columnBottom=${columnBottom} totalHeight=${box.height} threshold=${columnBottom - box.height}`);
      if (height === 560) {
        expect(scrollBox.y, 'precondition: the table top must be within one Total height of the column bottom').toBeGreaterThan(columnBottom - box.height);
      }

      // The element painted at the centre of the label and of the value belongs to the Total, never to the table header.
      for (const target of [total.getByText('Total del período'), total.getByTestId('product-movements-total-value')]) {
        const hit = await target.evaluate((el) => {
          const r = el.getBoundingClientRect();
          const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
          return {
            insideTotal: Boolean(top?.closest('[data-testid="product-movements-total"]')),
            insideHeader: Boolean(top?.closest('[data-testid="product-movements-scroll"] > [role="row"]')),
          };
        });
        expect(hit.insideTotal).toBe(true);
        expect(hit.insideHeader).toBe(false);
      }

      // At the end of the column scroll the Total touches the table box (gap 0).
      await column.scrollTo('end');
      await expect.poll(async () => {
        const t = await total.boundingBox();
        const b = await page.getByTestId('product-movements-scroll').boundingBox();
        return Math.abs(t.y - (b.y + b.height));
      }).toBeLessThanOrEqual(1);
    });
  }

  // The table box fills the room left (never below its compact floor), so with FEW rows the Total still sits at the bottom of
  // the content column instead of floating under a short table.
  for (const height of [720, 955, 1100]) {
    test(`with two rows at 1850x${height} the total bottom equals the content column bottom`, async ({ page }) => {
      await page.setViewportSize({ width: 1850, height });
      await openMovementsWith(page, () => [200, page_([MOVEMENT, OUT_MOVEMENT], { netQuantity: -3, count: 2 })]);
      const total = page.getByTestId('product-movements-total');
      await expect(total).toBeVisible({ timeout: 10_000 });
      await expect(page.getByTestId('product-movements-row')).toHaveCount(2);
      await expect.poll(async () => total.evaluate((el) => {
        let col = el.parentElement;
        while (col && !['auto', 'scroll'].includes(getComputedStyle(col).overflowY)) col = col.parentElement;
        col.scrollTop = 0;
        const box = document.querySelector('[data-testid="product-movements-scroll"]').getBoundingClientRect();
        return {
          gap: Math.round(col.getBoundingClientRect().bottom - el.getBoundingClientRect().bottom),
          boxHeight: Math.round(box.height),
          outerOverflow: col.scrollHeight - col.clientHeight,
        };
      })).toMatchObject({ gap: 0 });
      // Two rows: the box floor is its content (header + 2 rows, about 120 px), never the old fixed 340.
      const box = await page.getByTestId('product-movements-scroll').boundingBox();
      expect(box.height).toBeGreaterThanOrEqual(100);
    });
  }

  test('a net entry is green with a plus and one movement reads in the singular', async ({ page }) => {
    await openMovementsWith(page, () => [200, page_([MOVEMENT], { netQuantity: 12, count: 1 })]);
    const total = page.getByTestId('product-movements-total');
    await expect(total.getByTestId('product-movements-total-count')).toHaveText('· 1 movimiento', { timeout: 10_000 });
    await expect(total.getByTestId('product-movements-total-value')).toHaveText('+12');
    await expect(total.getByTestId('product-movements-total-value')).toHaveCSS('color', POSITIVE_FG);
  });

  test('a response without totals hides the row, the movements still show', async ({ page }) => {
    await openMovementsWith(page, () => [200, page_([MOVEMENT, OUT_MOVEMENT])]);
    await expect(page.getByTestId('product-movements-row')).toHaveCount(2, { timeout: 10_000 });
    await expect(page.getByTestId('product-movements-total')).toHaveCount(0);
  });

  test('sorting keeps the same total', async ({ page }) => {
    await openMovementsWith(page, (url) => {
      const rows = url.includes('etgoDocKind') ? [OUT_MOVEMENT, MOVEMENT] : [MOVEMENT, OUT_MOVEMENT];
      return [200, page_(rows, { netQuantity: -3, count: 2 })];
    });
    const value = page.getByTestId('product-movements-total-value');
    await expect(value).toHaveText('−3', { timeout: 10_000 });

    const sorted = page.waitForResponse((r) => r.url().includes('/transactions') && r.url().includes('typeLabelOrder'));
    await page.getByRole('columnheader').nth(1).getByRole('button').click();
    await sorted;
    await expect(page.getByTestId('product-movements-row').first()).toContainText('GS-0002');
    await expect(value).toHaveText('−3');
    await expect(page.getByTestId('product-movements-total-count')).toHaveText('· 2 movimientos');
  });

  test('a later page never asks for totals and never replaces the first page ones', async ({ page }) => {
    const firstPage = Array.from({ length: 50 }, (_, i) => ({ ...MOVEMENT, id: `mov-p1-${i}`, etgoDocLabel: `GR-${i}` }));
    const calls = await openMovementsWith(page, (url) => (startRowOf(url) === 0
      ? [200, page_(firstPage, { netQuantity: 612, count: 51 })]
      // A backend that answered totals anyway must not overwrite the period total.
      : [200, page_([{ ...MOVEMENT, id: 'mov-p2-0', etgoDocLabel: 'GR-LAST' }], { netQuantity: 1, count: 1 })]));
    await expect(page.getByTestId('product-movements-row')).toHaveCount(50, { timeout: 10_000 });

    const nextPage = page.waitForRequest((r) => r.url().includes('/transactions') && r.url().includes('_startRow=50'));
    await page.getByTestId('product-movements-scroll').evaluate((el) => { el.scrollTop = el.scrollHeight; });
    await nextPage;
    await expect(page.getByTestId('product-movements-row')).toHaveCount(51);

    const firstUrl = tabCalls(calls).find((u) => startRowOf(u) === 0);
    const laterUrl = tabCalls(calls).find((u) => startRowOf(u) === 50);
    expect(new URL(firstUrl).searchParams.get('etgoTotals')).toBe('true');
    expect(new URL(laterUrl).searchParams.has('etgoTotals')).toBe(false);
    await expect(page.getByTestId('product-movements-total-count')).toHaveText('· 51 movimientos');
    await expect(page.getByTestId('product-movements-total-value')).toHaveText('+612');
  });
});

/** Geometry of the table box and of the content column that scrolls the tab (the nearest vertical scroller above it). */
async function boxGeometry(page) {
  return page.getByTestId('product-movements-scroll').evaluate((box) => {
    let col = box.parentElement;
    while (col && !['auto', 'scroll'].includes(getComputedStyle(col).overflowY)) col = col.parentElement;
    col.scrollTop = 0;
    const content = [...box.children].reduce((sum, child) => sum + child.getBoundingClientRect().height, 0) + (box.offsetHeight - box.clientHeight);
    const total = document.querySelector('[data-testid="product-movements-total"]');
    return {
      clientHeight: box.clientHeight,
      content: Math.round(content),
      inner: box.scrollHeight - box.clientHeight,
      outer: col.scrollHeight - col.clientHeight,
      overflowY: getComputedStyle(box).overflowY,
      scrollbar: box.offsetWidth - box.clientWidth,
      totalGap: total ? Math.round(col.getBoundingClientRect().bottom - total.getBoundingClientRect().bottom) : null,
    };
  });
}

test.describe('Product movements tab — compact floor and scroll tolerance', () => {
  const VIEWPORT_WIDTH = 1422;

  test('an empty state does not make the form column scroll at 1422x802', async ({ page }) => {
    await page.setViewportSize({ width: VIEWPORT_WIDTH, height: 802 });
    await openMovementsWith(page, () => [200, page_([])]);
    await expect(page.getByTestId('product-movements-empty')).toBeVisible({ timeout: 10_000 });
    await expect.poll(async () => (await boxGeometry(page)).outer).toBeLessThanOrEqual(0);
  });

  test('3 rows at 1422x802: no outer form scroll, no inner scroll and the Total at the card bottom', async ({ page }) => {
    await page.setViewportSize({ width: VIEWPORT_WIDTH, height: 802 });
    await openMovementsWith(page, () => [200, page_(NUMERIC_ROWS(3), { netQuantity: 3, count: 3 })]);
    await expect(page.getByTestId('product-movements-row')).toHaveCount(3, { timeout: 10_000 });
    await expect.poll(async () => (await boxGeometry(page)).outer).toBeLessThanOrEqual(0);
    const g = await boxGeometry(page);
    expect(g.inner).toBeLessThanOrEqual(4);
    expect(g.totalGap).toBe(0);
  });

  test('many rows at 1422x802: the table scrolls inside and the form column does not (one scroll)', async ({ page }) => {
    await page.setViewportSize({ width: VIEWPORT_WIDTH, height: 802 });
    await openMovementsWith(page, () => [200, page_(NUMERIC_ROWS(14), { netQuantity: 14, count: 14 })]);
    await expect(page.getByTestId('product-movements-row')).toHaveCount(14, { timeout: 10_000 });
    await expect.poll(async () => (await boxGeometry(page)).outer).toBeLessThanOrEqual(0);
    const g = await boxGeometry(page);
    expect(g.inner).toBeGreaterThan(4);
    expect(g.overflowY).toBe('auto');
    expect(g.totalGap).toBe(0);
  });

  test('a shortfall of 1-4 px clips the box without a vertical scrollbar, 0 and 5 px or more keep overflow-y auto', async ({ page }) => {
    const ROWS = NUMERIC_ROWS(7);
    await page.setViewportSize({ width: VIEWPORT_WIDTH, height: 1000 });
    await openMovementsWith(page, () => [200, page_(ROWS, { netQuantity: 7, count: 7 })]);
    await expect(page.getByTestId('product-movements-row')).toHaveCount(7, { timeout: 10_000 });
    // The box grows 1 px per px of viewport height while it fills the room left, so the viewport height that leaves
    // a given shortfall (content minus box) follows from one measurement at a taller viewport.
    const shortfallAt = async (wanted) => {
      let current = await boxGeometry(page);
      const height = (await page.viewportSize()).height + (current.content - wanted - current.clientHeight);
      await page.setViewportSize({ width: VIEWPORT_WIDTH, height });
      await expect.poll(async () => { current = await boxGeometry(page); return current.content - current.clientHeight; }).toBe(wanted);
      return current;
    };
    for (const wanted of [5, 8, 4, 2, 1]) {
      const g = await shortfallAt(wanted);
      if (wanted <= 4) {
        expect(g.overflowY, `shortfall ${wanted}`).toBe('hidden');
        expect(g.scrollbar, `shortfall ${wanted}`).toBe(0);
      } else {
        expect(g.overflowY, `shortfall ${wanted}`).toBe('auto');
      }
    }
    // Fitting exactly (shortfall 0) leaves the default overflow.
    const exact = await shortfallAt(0);
    expect(exact.overflowY).toBe('auto');
  });
});

test.describe('Product movements tab — empty states', () => {
  test('a product with no movements at all shows the empty state after one probe request', async ({ page }) => {
    // The default period filters, so the empty first page is followed by the unfiltered probe.
    const calls = await openMovementsWith(page, () => [200, page_([], { netQuantity: 0, count: 0 })]);
    await expect(page.getByTestId('product-movements-empty')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('product-movements-no-results')).toHaveCount(0);
    await expect(page.getByTestId('product-movements-total')).toHaveCount(0);
    const probe = calls.find((u) => isProbe(u) && !u.includes('criteria'));
    expect(probe).toBeTruthy();
    // Totals ride on the first page only, never on the probe.
    expect(new URL(probe).searchParams.has('etgoTotals')).toBe(false);
    expect(tabCalls(calls).filter((u) => !isProbe(u)).every((u) => new URL(u).searchParams.get('etgoTotals') === 'true')).toBe(true);
  });

  test('filters that match nothing show the no-results state, not the empty one', async ({ page }) => {
    const state = { filtered: false };
    // The probe (`_endRow=0`, no criteria) still sees a movement: the product has some, the filters match none.
    await openMovementsWith(page, (url) => (state.filtered && !isProbe(url)
      ? [200, page_([], { netQuantity: 0, count: 0 })]
      : [200, page_([MOVEMENT], { netQuantity: 12, count: 1 })]));
    await expect(page.getByTestId('product-movements-row').first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('product-movements-total')).toBeVisible();
    state.filtered = true;
    await page.getByTestId('product-movements-direction').getByRole('button').nth(1).click();
    await expect(page.getByTestId('product-movements-no-results')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('product-movements-empty')).toHaveCount(0);
    await expect(page.getByTestId('product-movements-total')).toHaveCount(0);
  });
});

/** Opens the product with two warehouses of stock and a history, so the panel draws its chart. */
async function openStockedProduct(page) {
  await login(page);
  await installMocks(page, {
    stock: () => [200, page_(TWO_WAREHOUSE_STOCK)],
    transactions: () => [200, page_(TWO_WAREHOUSE_HISTORY)],
  }, []);
  await page.goto(`/product/${PRODUCT.id}`);
}

test.describe('Product side panel — stock card, warehouses and chart', () => {
  test('the whole stock card is one button that opens Almacenes; the locations count is a plain pill', async ({ page }) => {
    await openStockedProduct(page);
    const card = page.getByTestId('AvailabilityCardButton');
    await expect(card).toBeVisible({ timeout: 10_000 });
    await expect(card).toContainText('Stock disponible');
    await expect(card).toContainText('1.530');

    const pill = card.getByTestId('AvailabilityWarehousePill');
    await expect(pill).toHaveText('2 ubicaciones');
    await expect(pill).toHaveCSS('background-color', 'rgb(235, 239, 255)');
    await expect(pill).toHaveCSS('color', 'rgb(37, 56, 132)');
    // Not interactive: no link or button of its own inside the card button.
    expect(await pill.evaluate((el) => el.closest('a, [role="link"]') === null && el.querySelector('a, button') === null)).toBe(true);
    // Never cut, and on the same line as the label.
    expect(await pill.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    const labelRow = card.getByTestId('AvailabilityLabelRow');
    const labelBox = await labelRow.getByText('Stock disponible').boundingBox();
    const pillBox = await pill.boundingBox();
    expect(Math.abs((labelBox.y + labelBox.height / 2) - (pillBox.y + pillBox.height / 2))).toBeLessThan(4);

    await card.click();
    await expect(page.getByTestId('WarehouseCards')).toBeVisible();
  });

  test('warehouse cards keep Disponible on a subtle surface with 10 px square series indicators', async ({ page }) => {
    await openStockedProduct(page);
    await page.getByTestId('ProductSidebarTab-warehouses').click({ timeout: 10_000 });
    const cards = page.getByTestId('WarehouseCard');
    await expect(cards).toHaveCount(2);
    for (let i = 0; i < 2; i++) {
      const card = cards.nth(i);
      await expect(card).toContainText('Disponible');
      await expect(card).toHaveCSS('background-color', SURFACE_SUBTLE);
      await expect(card).toHaveCSS('border-top-width', '0px');
      const dot = card.getByTestId('WarehouseCardDot');
      await expect(dot).toHaveCSS('width', '10px');
      await expect(dot).toHaveCSS('height', '10px');
      await expect(dot).toHaveCSS('border-top-left-radius', '3px');
      await expect(dot).toHaveCSS('background-color', SERIES_FILLS[i]);
    }
  });

  test('chart areas use the series palette at 0.32 fill opacity with no gradient', async ({ page }) => {
    await openStockedProduct(page);
    await expect(page.getByTestId('StockChartExpandButton')).toBeVisible({ timeout: 10_000 });
    const areas = page.getByTestId('StockChartArea');
    await expect(areas).toHaveCount(2);
    const styles = await areas.evaluateAll((els) => els.map((el) => {
      const cs = getComputedStyle(el);
      return { fill: cs.fill, fillOpacity: cs.fillOpacity };
    }));
    expect(styles.map((s) => s.fill).sort()).toEqual([SERIES_FILLS[0], SERIES_FILLS[1]].sort());
    for (const s of styles) expect(Number(s.fillOpacity)).toBeCloseTo(0.32, 2);
    expect(await page.locator('svg linearGradient, svg radialGradient').count()).toBe(0);
  });
});

test.describe('Product side panel — divider toggle and collapsed strip', () => {
  test('one round 24 px toggle on the divider collapses the panel to a 48 px strip with two icons, and back', async ({ page }) => {
    await openStockedProduct(page);
    const collapse = page.getByTestId('ProductSidebarCollapseButton');
    await expect(collapse).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('ProductSidebarCollapseButton').or(page.getByTestId('ProductSidebarOpenButton'))).toHaveCount(1);
    await expect(collapse).toHaveAttribute('aria-label', 'Panel del producto');
    await expect(collapse).toHaveAttribute('aria-expanded', 'true');
    await expect(collapse).toHaveAttribute('aria-controls', 'product-sidebar-panel');
    await expect(page.locator('#product-sidebar-panel')).toHaveCount(1);
    const box = await collapse.boundingBox();
    expect(Math.round(box.width)).toBe(24);
    expect(Math.round(box.height)).toBe(24);
    expect(await collapse.evaluate((el) => parseFloat(getComputedStyle(el).borderTopLeftRadius) >= 12)).toBe(true);
    // Centred on the divider: the left border of the panel column.
    const dividerX = await page.getByTestId('ProductSidebarTab-summary').evaluate((el) => el.closest('.border-l.relative').getBoundingClientRect().left);
    expect(Math.abs(box.x + box.width / 2 - dividerX)).toBeLessThan(2);

    await collapse.click();
    const open = page.getByTestId('ProductSidebarOpenButton');
    await expect(open).toBeVisible();
    await expect(page.getByTestId('ProductSidebarCollapseButton')).toHaveCount(0);
    // Same control: stable name, the state is carried by aria-expanded and the rotated icon.
    await expect(open).toHaveAttribute('aria-label', 'Panel del producto');
    await expect(open).toHaveAttribute('aria-expanded', 'false');
    await expect(open).toHaveAttribute('aria-controls', 'product-sidebar-panel');
    await expect.poll(() => open.locator('svg').evaluate((svg) => {
      const cs = getComputedStyle(svg);
      if (cs.rotate && cs.rotate !== 'none') return Math.round(parseFloat(cs.rotate));
      const m = new DOMMatrix(cs.transform === 'none' ? undefined : cs.transform);
      return Math.round((Math.atan2(m.b, m.a) * 180) / Math.PI + 360) % 360;
    })).toBe(180);

    const strip = page.getByTestId('ProductSidebarCollapsed');
    await expect(strip).toBeVisible();
    await expect(strip).toHaveAttribute('id', 'product-sidebar-panel');
    const columnWidth = await strip.evaluate((el) => el.closest('.border-l.relative').getBoundingClientRect().width);
    expect(Math.round(columnWidth)).toBe(48);
    await expect(strip.getByRole('button')).toHaveCount(2);
    await expect(strip.getByTestId('ProductSidebarStripSummary')).toHaveAttribute('aria-label', 'Resumen');
    await expect(strip.getByTestId('ProductSidebarStripWarehouses')).toHaveAttribute('aria-label', 'Almacenes');
    await expect(strip.getByTestId('ProductSidebarOpenButton')).toHaveCount(0);

    // The divider toggle reopens it.
    await open.click();
    await expect(page.getByTestId('ProductSidebarCollapseButton')).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByTestId('ProductSidebarCollapsed')).toHaveCount(0);
  });

  test('the collapsed preference survives a reload, and a strip icon reopens on its tab', async ({ page }) => {
    await openStockedProduct(page);
    await page.getByTestId('ProductSidebarCollapseButton').click({ timeout: 10_000 });
    await expect(page.getByTestId('ProductSidebarCollapsed')).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('etendo.product.sidebar.collapsed'))).toBe('true');

    await page.reload();
    await expect(page.getByTestId('ProductSidebarCollapsed')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('ProductSidebarOpenButton')).toHaveAttribute('aria-expanded', 'false');

    await page.getByTestId('ProductSidebarStripWarehouses').click();
    await expect(page.getByTestId('WarehouseCards')).toBeVisible();
    await expect(page.getByTestId('ProductSidebarCollapsed')).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem('etendo.product.sidebar.collapsed'))).toBe('false');
  });
});

test.describe('Product side panel — failed reads', () => {
  test('a /stock 500 shows a dash and the unavailable note, with no chart', async ({ page }) => {
    await login(page);
    await installMocks(page, {
      stock: () => [500, { error: { message: 'boom' } }],
      transactions: () => [200, page_(HISTORY_ROWS)],
    }, []);
    await page.goto(`/product/${PRODUCT.id}`);
    await expect(page.getByTestId('AvailabilityUnavailable')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('StockUnavailableNote')).toBeVisible();
    await expect(page.getByTestId('StockChartExpandButton')).toHaveCount(0);
    // An unavailable stock is not a way into Almacenes.
    await expect(page.getByTestId('AvailabilityCard')).toBeVisible();
    await expect(page.getByTestId('AvailabilityCardButton')).toHaveCount(0);
  });

  test('a failed history keeps the real stock and shows the history note, with no chart', async ({ page }) => {
    await login(page);
    await installMocks(page, { transactions: () => [500, { error: { message: 'boom' } }] }, []);
    await page.goto(`/product/${PRODUCT.id}`);
    await expect(page.getByTestId('StockUnavailableNote')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('AvailabilityUnavailable')).toHaveCount(0);
    await expect(page.getByText('1.530').first()).toBeVisible();
    await expect(page.getByTestId('StockChartExpandButton')).toHaveCount(0);
  });

  test('while the stock loads the card is not clickable', async ({ page }) => {
    let release;
    const held = new Promise((resolve) => { release = resolve; });
    await login(page);
    await installMocks(page, {
      stock: async () => { await held; return [200, page_(STOCK_ROWS)]; },
      transactions: () => [200, page_(HISTORY_ROWS)],
    }, []);
    await page.goto(`/product/${PRODUCT.id}`);
    await expect(page.getByTestId('AvailabilityValueSkeleton')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('AvailabilityCard')).toBeVisible();
    await expect(page.getByTestId('AvailabilityCardButton')).toHaveCount(0);
    release();
    await expect(page.getByTestId('AvailabilityCardButton')).toBeVisible();
  });
});

test.describe('Product header — Save and tabs', () => {
  test('Guardar is filled primary with white text and the strong hover; the active tab is blue; Movimientos has no counter', async ({ page }) => {
    await openStockedProduct(page);
    const save = page.getByTestId('action-save');
    await expect(save).toBeVisible({ timeout: 10_000 });

    // Only a dirty form enables Save (a mocked spec: nothing is ever sent).
    await page.getByTestId('field-name').fill('Stocked product (edited)');
    await expect(save).toBeEnabled();
    await expect(save).toHaveCSS('background-color', PRIMARY);
    await expect(save).toHaveCSS('color', 'rgb(255, 255, 255)');
    await save.hover();
    await expect(save).toHaveCSS('background-color', PRIMARY_HOVER_STRONG);

    // The first secondary tab is active: its text is the brand blue, the others stay muted.
    const activeTab = page.getByTestId('tab-custom:pricing');
    await expect(activeTab).toHaveCSS('color', PRIMARY);
    const movementsTab = page.getByTestId('tab-custom:movements');
    await expect(movementsTab).not.toHaveCSS('color', PRIMARY);
    await expect(movementsTab).toHaveText('Movimientos');
    await movementsTab.click();
    await expect(movementsTab).toHaveCSS('color', PRIMARY);
    await expect(movementsTab).toHaveText('Movimientos');
  });

  test('the Description textarea declares 2 rows (decisions.json rows: 2): no 96 px floor, 58 px high', async ({ page }) => {
    await openStockedProduct(page);
    const description = page.getByTestId('field-description');
    await expect(description).toBeVisible({ timeout: 10_000 });
    await expect(description).toHaveAttribute('rows', '2');
    // 2 rows x 20 px line height + 2 x 8 px padding + 2 x 1 px border.
    expect(Math.round((await description.boundingBox()).height)).toBe(58);
  });
});
