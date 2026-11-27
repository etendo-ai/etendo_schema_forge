import { formatGroupedNumber } from '@/lib/formatCurrency';

/**
 * Formats a stock quantity with the instance separators and up to 2 decimals
 * (12.5 kg -> "12,5", 1080 -> "1.080"). Shared by the product sidebar and the
 * movements tab so both agree.
 */
export const formatStockQuantity = (n) => formatGroupedNumber(n, { maximumFractionDigits: 2 });

/**
 * A stock quantity followed by the unit symbol of the product's unit of measure ("2,5 kg"). Without a symbol
 * (the backend left it out: no symbol on the UOM, flag off) it is the quantity alone, never a made-up unit.
 */
export const formatStockQuantityWithUnit = (n, unitSymbol) => {
  const quantity = formatStockQuantity(n);
  return unitSymbol ? `${quantity} ${unitSymbol}` : quantity;
};

/** The unit symbol of a product's stock rows: every row carries the product's UOM, so the first one that has it. */
export const stockUnitSymbol = (stockRows) => {
  const row = (stockRows ?? []).find(r => typeof r?.etgoUomSymbol === 'string' && r.etgoUomSymbol.trim() !== '');
  return row ? row.etgoUomSymbol.trim() : null;
};
