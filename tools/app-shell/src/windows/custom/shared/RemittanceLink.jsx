import { useCapabilitiesSafe } from '@/hooks/useCapabilitiesSafe.js';
import { SEPA_REMITTANCES_CAPABILITY, isCapabilityVisible } from '@/lib/capabilityVisibility.js';

const BASE_STYLE = {
  display: 'inline-block', maxWidth: '100%', fontSize: 12, lineHeight: '16px',
  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'left',
};

/**
 * The remittance a payment came from, as a link to its record (ETP-6247). Present on every payment a
 * remittance created — remitted, collected or returned alike — because that is where the payment is
 * managed: the backend refuses to reactivate or remove a remitted one from the payment itself.
 * Stops propagation so the click does not also open the row it sits in.
 *
 * The remittance route is guarded by the `sepaRemittances` capability (the `sepa-remittances` flag).
 * Without it — a tenant whose flag was turned off after remitting — the number is still shown, as
 * plain text, instead of a link into a page the user cannot open. Fails closed on an unloaded map.
 *
 * Props:
 *   payment — a payment row; renders nothing without `remittanceId`
 *   ui      — the `useUI()` translator of the caller
 *   onOpen  — called with the remittance id
 *   testid  — data-testid of the link (default `remittance-link`); the plain-text variant carries
 *             `<testid>-label`
 *   style   — extra inline style merged over the default one
 */
export default function RemittanceLink({ payment, ui, onOpen, testid = 'remittance-link', style }) {
  const canOpen = isCapabilityVisible(useCapabilitiesSafe(), SEPA_REMITTANCES_CAPABILITY);
  if (!payment?.remittanceId) return null;
  const label = ui('remittancePaymentLink', { documentNo: payment.remittanceDocumentNo || '' });
  if (!canOpen) {
    return (
      <span
        data-testid={`${testid}-label`}
        title={label}
        style={{ ...BASE_STYLE, color: 'hsl(var(--muted-foreground))', ...style }}
      >
        {label}
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onOpen(payment.remittanceId); }}
      data-testid={testid}
      title={label}
      style={{
        ...BASE_STYLE, padding: 0, border: 'none', background: 'none', cursor: 'pointer',
        color: 'hsl(var(--primary))', textDecoration: 'underline',
        ...style,
      }}
    >
      {label}
    </button>
  );
}
