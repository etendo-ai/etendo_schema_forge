/**
 * Case- and accent-insensitive form of a string for client-side option search ("borr" / "Borr" /
 * "bórr" all match "Borrador"): NFD, strip the combining marks, lowercase. Shared by the app list
 * toolbar's filters (`ListFilterBar`) and the customer portal's (`PortalListFilters`, ETP-6209).
 */
export function normalizeSearchText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}
