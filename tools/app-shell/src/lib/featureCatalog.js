import menuConfig from '@/menu.json';
import { buildFeatureKey } from '@etendo-ai/app-shell-core/auth';

/**
 * ETP-5646 — the canonical spec of "what is a feature" for usage analytics.
 *
 * One stable key per actionable menu entry, derived deterministically from `menu.json`:
 *
 * | kind      | menu entry                                           | key                      |
 * |-----------|------------------------------------------------------|--------------------------|
 * | `window`  | has `windowId`, or is a `routeOnly` spec window      | `window.<name>`          |
 * | `process` | has `obuiappProcessId`                               | `process.<name>`         |
 * | `report`  | has `reportId`                                       | `report.<reportId>`      |
 * | `custom`  | any other page (dashboard, inbox, settings, lists)   | `custom.<name>`          |
 *
 * An entry with `redirect` has no key of its own: it resolves to the entry it redirects to, so an
 * alias never counts as a second feature. The key is the menu `name` (the route segment), which
 * is already stable and low-cardinality; it never contains a record id, a label or a user input.
 * A route that is not in the menu has no feature (nothing is attributed or counted).
 */

function kindOf(item) {
  if (item.reportId) return 'report';
  if (item.obuiappProcessId) return 'process';
  if (item.windowId || item.routeOnly) return 'window';
  return 'custom';
}

function keyOf(item) {
  const kind = kindOf(item);
  return buildFeatureKey(kind, kind === 'report' ? item.reportId : item.name);
}

function indexItems(config) {
  const items = new Map();
  for (const group of config?.menu ?? []) {
    for (const item of group.items ?? []) {
      if (item?.name && !items.has(item.name)) items.set(item.name, item);
    }
  }
  return items;
}

/** Follows `redirect` (bounded) to the entry that owns the feature; `null` for a loop or a miss. */
function resolveItem(items, name, depth = 0) {
  const item = items.get(name);
  if (item?.redirect && depth < 3) {
    const target = String(item.redirect).replace(/^\//, '').split(/[/?#]/)[0];
    return target && target !== name ? resolveItem(items, target, depth + 1) : null;
  }
  return item ?? null;
}

function resolveReportViewer(search, items, features, byReportId) {
  const params = new URLSearchParams(search);
  const reportId = params.get('report');
  if (reportId && byReportId.has(reportId)) return features.get(keyOf(byReportId.get(reportId))) ?? null;
  const category = params.get('category');
  const listing = category ? resolveItem(items, `report-viewer-${category}`) : null;
  return listing ? features.get(keyOf(listing)) ?? null : null;
}

export function buildFeatureCatalog(config = menuConfig) {
  const items = indexItems(config);
  // Only the key is read by callers (`enterFeature`, the tracker).
  const features = new Map();
  for (const name of items.keys()) {
    const item = resolveItem(items, name);
    if (item) features.set(keyOf(item), { key: keyOf(item) });
  }
  const byReportId = new Map(
    [...items.values()].filter(item => item.reportId).map(item => [item.reportId, item]),
  );

  /** The feature of a location, or `null` when the route is not an actionable menu entry. */
  function resolveFeature(pathname = '/', search = '') {
    const segment = String(pathname).replace(/^\/+/, '').split('/')[0];
    if (!segment) return null;
    if (segment === 'report-viewer') return resolveReportViewer(search, items, features, byReportId);
    const item = resolveItem(items, segment);
    return item ? features.get(keyOf(item)) ?? null : null;
  }

  return { features, resolveFeature };
}

const defaultCatalog = buildFeatureCatalog();

export const FEATURE_CATALOG = defaultCatalog.features;
export const resolveFeature = defaultCatalog.resolveFeature;
