import { ArrowsLeftRightIcon } from '@phosphor-icons/react';
import { useCapabilitiesSafe } from '@/hooks/useCapabilitiesSafe.js';
import { SEPA_REMITTANCES_CAPABILITY, isCapabilityVisible } from '@/lib/capabilityVisibility.js';
import { paymentDisplayState } from './paymentStatuses';

/**
 * The confirmed remittances an invoice's payments sit in (ETP-6247), one entry per remittance, in
 * the order their payments arrive. Only payments still REMITTED (`REM_SENT`) count: once the
 * remittance is collected the invoice simply reads collected and there is nothing to explain.
 *
 * `statusLabel` is the backend's translated remittance status (`remittanceStatusLabel` on the
 * `invoicePayments` row); absent on a backend that does not send it yet.
 *
 * @param {object[]} payments the `invoicePayments` rows
 * @returns {{ id: string, documentNo: string, statusLabel: string|null }[]}
 */
export function remittancesOf(payments = []) {
  const byId = new Map();
  for (const payment of payments) {
    if (!payment?.remittanceId || paymentDisplayState(payment) !== 'remitted') continue;
    if (byId.has(payment.remittanceId)) continue;
    byId.set(payment.remittanceId, {
      id: payment.remittanceId,
      documentNo: payment.remittanceDocumentNo || '',
      statusLabel: payment.remittanceStatusLabel || null,
    });
  }
  return [...byId.values()];
}

/**
 * Info banner for an invoice whose payments sit in a confirmed remittance (ETP-6247): one line per
 * remittance — «En la remesa N · <estado>» and a «Ver remesa →» action — plus what happens next
 * («Se marcará como cobrada/pagada cuando se cobre/pague la remesa»).
 *
 * The remittance route is guarded by the `sepaRemittances` capability (the `sepa-remittances` flag):
 * without it the remittance is still named, but no action leads into a page the user cannot open.
 * Fails closed on an unloaded capability map.
 *
 * Props:
 *   payments — the invoice's `invoicePayments` rows; renders nothing when none is remitted
 *   isSales  — collection (sales) or payment (purchase) wording
 *   ui       — the `useUI()` translator of the caller
 *   onOpen   — called with the remittance id
 *   compact  — the smaller variant for the invoice preview card
 *   testid   — data-testid prefix (default `remittance-banner`)
 */
export default function RemittanceInfoBanner({
  payments, isSales, ui, onOpen, compact = false, testid = 'remittance-banner',
}) {
  const canOpen = isCapabilityVisible(useCapabilitiesSafe(), SEPA_REMITTANCES_CAPABILITY);
  const remittances = remittancesOf(payments);
  if (remittances.length === 0) return null;
  const fontSize = compact ? 12 : 13;
  return (
    <div
      data-testid={testid}
      role="status"
      style={{
        display: 'flex', gap: compact ? 8 : 10, alignItems: 'flex-start',
        padding: compact ? '8px 10px' : '10px 12px', borderRadius: 8,
        background: 'var(--status-info-bg)', border: '1px solid var(--status-info-border)',
        color: 'var(--status-info-fg)',
      }}
    >
      <ArrowsLeftRightIcon size={compact ? 14 : 16} style={{ flexShrink: 0, marginTop: 2 }} data-testid="ArrowsLeftRight__remittance-banner" />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        {remittances.map((remittance) => (
          <div
            key={remittance.id}
            data-testid={`${testid}-line`}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}
          >
            <span style={{ fontSize, lineHeight: compact ? '16px' : '18px', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {ui('invoiceRemittanceBannerTitle', { documentNo: remittance.documentNo })}
              {remittance.statusLabel && <span style={{ fontWeight: 400 }}> · {remittance.statusLabel}</span>}
            </span>
            {canOpen && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onOpen(remittance.id); }}
                data-testid={`${testid}-open`}
                style={{ flexShrink: 0, padding: 0, border: 'none', background: 'none', cursor: 'pointer', fontSize, lineHeight: compact ? '16px' : '18px', fontWeight: 500, color: 'hsl(var(--primary))', whiteSpace: 'nowrap' }}
              >
                {ui('invoiceRemittanceViewLink')} &rarr;
              </button>
            )}
          </div>
        ))}
        <span style={{ fontSize: compact ? 11 : 12, lineHeight: '16px', opacity: 0.85 }}>
          {ui(isSales ? 'invoiceRemittanceBannerHintSales' : 'invoiceRemittanceBannerHintPurchase')}
        </span>
      </div>
    </div>
  );
}
