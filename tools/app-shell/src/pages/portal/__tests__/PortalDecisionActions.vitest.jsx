// @covers tools/app-shell/src/pages/portal/PortalDecisionActions.jsx
// New file: the component had no test, and driving its modal through PortalPage would bury its
// rules under the whole page's routing. The request itself is the real `requestPortalDecision`;
// only `apiFetch` (the network boundary) is a double.

/** The mocked translation: the key, plus its variables, so the email and tenant show. */
function t(key, vars) {
  return vars ? `${key} ${JSON.stringify(vars)}` : key;
}

vi.mock('@/i18n', () => ({ useUI: () => t }));

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PortalDecisionActions from '../PortalDecisionActions.jsx';

const TOKEN = 'tok-abcdef0123456789';

function jsonResponse(body, { status = 200 } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => 'application/json' },
    json: async () => body,
  };
}

/**
 * A pending quotation, valid far into the future. The row's own `canDecide` (QA CP-49: emailed to
 * this link's address) follows the decision's unless a test says otherwise.
 */
const quotation = (decision, overrides = {}) => ({
  kind: 'QUOTATION', id: 'q-1', documentNo: 'PR/0001', documentStatus: 'UE', validUntil: '2999-01-10',
  canDecide: decision?.canDecide === true, decision, ...overrides,
});
const OPEN = { canDecide: true, blockedReason: null, acceptAvailable: true, email: 'contact@acme.com' };
const RECIPIENTS = ['contact@acme.com', 'buyer@acme.com', 'finance@acme.com'];

function renderActions(document, { apiFetch = vi.fn(), onInvalid = vi.fn(), variant } = {}) {
  render(
    <PortalDecisionActions
      apiFetch={apiFetch}
      token={TOKEN}
      document={document}
      tenantName="Acme SA"
      onInvalid={onInvalid}
      variant={variant}
    />,
  );
  return { apiFetch, onInvalid };
}

/** The JSON body of the n-th decision request. */
const bodyOf = (apiFetch, n = 0) => JSON.parse(apiFetch.mock.calls[n][1].body);

describe('PortalDecisionActions — when it shows', () => {
  it('renders nothing for a document with no decision block', () => {
    renderActions({ kind: 'INVOICE', id: 'inv-1', decision: null });

    expect(screen.queryByTestId('portal-decision-panel')).not.toBeInTheDocument();
    expect(screen.queryByTestId('portal-decision-blocked')).not.toBeInTheDocument();
  });

  for (const [blockedReason, key] of [
    ['expired', 'portalDecisionBlockedExpired'],
    ['no_recipient', 'portalDecisionBlockedNoRecipient'],
  ]) {
    it(`says why it cannot be answered when blocked as ${blockedReason}`, () => {
      renderActions(quotation({ canDecide: false, blockedReason, acceptAvailable: true }));

      expect(screen.getByTestId('portal-decision-blocked').textContent).toBe(t(key, { tenantName: 'Acme SA' }));
      expect(screen.queryByTestId('portal-decision-reject')).not.toBeInTheDocument();
    });
  }

  // Already answered or closed: the status badge says it; an unknown reason has nothing to say.
  // CP-49: a quotation not emailed to this link's address simply reads without buttons.
  for (const blockedReason of ['not_pending', 'not_recipient', 'something_new', null]) {
    it(`shows nothing when blocked as ${blockedReason}`, () => {
      renderActions(quotation({ canDecide: false, blockedReason, acceptAvailable: true }));

      expect(screen.queryByTestId('portal-decision-blocked')).not.toBeInTheDocument();
      expect(screen.queryByTestId('portal-decision-reject')).not.toBeInTheDocument();
    });
  }

  // The browser only refuses on top of the backend, never grants: each gate alone hides the buttons.
  for (const [label, document] of [
    ['the row is not decidable for this address (canDecide false)', quotation(OPEN, { canDecide: false })],
    ['the row has no canDecide flag', quotation(OPEN, { canDecide: undefined })],
    ['the quotation was already accepted', quotation(OPEN, { documentStatus: 'ETGO_AC' })],
    ['the quotation is past its validity date', quotation(OPEN, { validUntil: '2020-01-10' })],
  ]) {
    it(`offers no buttons and opens no popup when ${label}`, () => {
      renderActions(document);

      expect(screen.queryByTestId('portal-decision-accept')).not.toBeInTheDocument();
      expect(screen.queryByTestId('portal-decision-reject')).not.toBeInTheDocument();
      expect(screen.queryByTestId('portal-accept-modal')).not.toBeInTheDocument();
    });
  }

  it('offers Rechazar without Aceptar when the backend has accepting off', () => {
    renderActions(quotation({ ...OPEN, acceptAvailable: false }));

    expect(screen.getByTestId('portal-decision-reject')).toBeInTheDocument();
    expect(screen.queryByTestId('portal-decision-accept')).not.toBeInTheDocument();
  });
});

describe('PortalDecisionActions — Aceptar', () => {
  it('asks first, naming where the confirmation goes, and sends nothing on Cancelar', async () => {
    const user = userEvent.setup();
    const apiFetch = vi.fn();
    renderActions(quotation(OPEN), { apiFetch });

    await user.click(screen.getByTestId('portal-decision-accept'));

    expect(screen.getByTestId('portal-accept-modal')).toHaveTextContent('portalAcceptConfirmTitle');
    expect(screen.getByTestId('portal-decision-email')).toHaveTextContent('contact@acme.com');
    await user.click(screen.getByTestId('portal-accept-cancel'));
    await waitFor(() => expect(screen.queryByTestId('portal-accept-modal')).not.toBeInTheDocument());
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('sends on Continuar, then says to check the email, and keeps saying where it went', async () => {
    const user = userEvent.setup();
    const apiFetch = vi.fn(async () => jsonResponse({ email: 'sales@acme.com' }));
    renderActions(quotation(OPEN), { apiFetch });

    await user.click(screen.getByTestId('portal-decision-accept'));
    // QA 24/11 (e): the FIRST press on Continuar sends, nothing needs a second one.
    await user.click(screen.getByTestId('portal-accept-continue'));

    await waitFor(() => expect(screen.getByTestId('portal-check-email-modal')).toBeInTheDocument());
    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('portal-check-email-modal'))
      .toHaveTextContent(t('portalCheckEmailDescription', { email: 'sales@acme.com' }));
    await user.click(screen.getByTestId('portal-check-email-ok'));
    await waitFor(() => expect(screen.queryByTestId('portal-check-email-modal')).not.toBeInTheDocument());
    expect(screen.getByTestId('portal-decision-sent').textContent).toBe(t('portalDecisionSent', { email: 'sales@acme.com' }));
    expect(apiFetch.mock.calls[0][0]).toBe('/sws/portal/quotations/q-1/decision');
    expect(bodyOf(apiFetch)).toEqual({ decision: 'ACCEPT' });
    expect(screen.queryByTestId('portal-decision-accept')).not.toBeInTheDocument();
  });

  it('lays Aceptar then Rechazar out as items of the side panel row (inline variant)', () => {
    renderActions(quotation(OPEN), { variant: 'inline' });

    const panel = screen.getByTestId('portal-decision-panel');
    expect(panel).toHaveClass('contents');
    const [first, second] = panel.querySelectorAll('button');
    expect([first.dataset.testid, second.dataset.testid]).toEqual(['portal-decision-accept', 'portal-decision-reject']);
  });

  it('labels the mobile bar button as accepting the quotation, under its hint', () => {
    renderActions(quotation(OPEN), { variant: 'bar' });

    expect(screen.getByTestId('portal-decision-bar')).toHaveTextContent(t('portalDecisionAcceptHint', { tenantName: 'Acme SA' }));
    expect(screen.getByTestId('portal-decision-accept')).toHaveTextContent('portalDecisionAcceptQuotation');
  });
});

// QA CP-45 — the confirmation goes to every To recipient of the original send (never the CC).
describe('PortalDecisionActions — confirmation recipients', () => {
  it.each([
    ['one recipient', ['contact@acme.com'], 'portalConfirmationEmailLabel'],
    ['three recipients', RECIPIENTS, 'portalConfirmationEmailsLabel'],
  ])('names %s in the popup, under the matching label', async (_label, recipients, labelKey) => {
    const user = userEvent.setup();
    renderActions(quotation({ ...OPEN, confirmationRecipients: recipients }));

    await user.click(screen.getByTestId('portal-decision-accept'));

    const box = screen.getByTestId('portal-decision-email');
    expect(box).toHaveTextContent(labelKey);
    expect(screen.getAllByTestId('portal-decision-email-address').map((el) => el.textContent)).toEqual(recipients);
  });

  it('says it was sent to every recipient the answer lists, joined as one phrase', async () => {
    const user = userEvent.setup();
    const apiFetch = vi.fn(async () => jsonResponse({ email: 'contact@acme.com', confirmationRecipients: RECIPIENTS }));
    renderActions(quotation({ ...OPEN, confirmationRecipients: RECIPIENTS }), { apiFetch });

    await user.click(screen.getByTestId('portal-decision-accept'));
    await user.click(screen.getByTestId('portal-accept-continue'));
    await waitFor(() => expect(screen.getByTestId('portal-check-email-modal')).toBeInTheDocument());
    await user.click(screen.getByTestId('portal-check-email-ok'));

    const phrase = 'contact@acme.com, buyer@acme.com portalRecipientsLastSeparator finance@acme.com';
    await waitFor(() => expect(screen.getByTestId('portal-decision-sent').textContent)
      .toBe(t('portalDecisionSent', { email: phrase })));
  });
});

describe('PortalDecisionActions — Rechazar', () => {
  async function openReject(apiFetch) {
    const user = userEvent.setup();
    renderActions(quotation(OPEN), { apiFetch });
    await user.click(screen.getByTestId('portal-decision-reject'));
    await waitFor(() => expect(screen.getByTestId('portal-reject-modal')).toBeInTheDocument());
    return user;
  }

  /** Continuar from the reasons, then Enviar solicitud from the confirmation popup. */
  async function confirmAndSend(user) {
    await user.click(screen.getByTestId('portal-reject-continue'));
    await waitFor(() => expect(screen.getByTestId('portal-reject-confirm-modal')).toBeInTheDocument());
    await user.click(screen.getByTestId('portal-reject-submit'));
  }

  it('needs a reason, and a text for "Otros", before it can continue', async () => {
    const user = await openReject(vi.fn());

    expect(screen.getByTestId('portal-reject-continue')).toBeDisabled();
    await user.click(screen.getByTestId('portal-reject-reason-other'));
    expect(screen.getByTestId('portal-reject-continue')).toBeDisabled();
    await user.type(screen.getByTestId('portal-reject-other-text'), '   ');
    expect(screen.getByTestId('portal-reject-continue')).toBeDisabled();
    await user.type(screen.getByTestId('portal-reject-other-text'), 'Ya no');
    expect(screen.getByTestId('portal-reject-continue')).toBeEnabled();
  });

  it('asks to confirm by email before sending, and Volver keeps the chosen reason', async () => {
    const apiFetch = vi.fn();
    const user = await openReject(apiFetch);

    await user.click(screen.getByTestId('portal-reject-reason-delivery'));
    await user.click(screen.getByTestId('portal-reject-continue'));
    await waitFor(() => expect(screen.getByTestId('portal-reject-confirm-modal')).toBeInTheDocument());
    expect(screen.getByTestId('portal-decision-email')).toHaveTextContent('contact@acme.com');
    expect(apiFetch).not.toHaveBeenCalled();
    // Volver and Cancelar take the app's outline hover; the label keeps the Figma's colour.
    for (const testId of ['portal-reject-back', 'portal-reject-confirm-cancel']) {
      expect(screen.getByTestId(testId)).toHaveClass('hover:bg-accent', 'text-[#1B1A1F]');
    }

    await user.click(screen.getByTestId('portal-reject-back'));
    await waitFor(() => expect(screen.getByTestId('portal-reject-modal')).toBeInTheDocument());
    expect(screen.getByTestId('portal-reject-reason-delivery')).toBeChecked();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('clears the "Otros" text when another reason is chosen, and sends no text with it', async () => {
    const apiFetch = vi.fn(async () => jsonResponse({ email: 'sales@acme.com' }));
    const user = await openReject(apiFetch);

    await user.click(screen.getByTestId('portal-reject-reason-other'));
    await user.type(screen.getByTestId('portal-reject-other-text'), 'Texto que no debe viajar');
    await user.click(screen.getByTestId('portal-reject-reason-price'));
    expect(screen.queryByTestId('portal-reject-other-text')).not.toBeInTheDocument();
    await user.click(screen.getByTestId('portal-reject-reason-other'));
    expect(screen.getByTestId('portal-reject-other-text')).toHaveValue('');

    await user.click(screen.getByTestId('portal-reject-reason-price'));
    await confirmAndSend(user);

    await waitFor(() => expect(screen.getByTestId('portal-check-email-modal')).toBeInTheDocument());
    expect(bodyOf(apiFetch)).toEqual({ decision: 'REJECT', reasonCode: 'PRICE' });
  });

  it('sends the trimmed text only with "Otros"', async () => {
    const apiFetch = vi.fn(async () => jsonResponse({ email: 'sales@acme.com' }));
    const user = await openReject(apiFetch);

    await user.click(screen.getByTestId('portal-reject-reason-other'));
    await user.type(screen.getByTestId('portal-reject-other-text'), '  Ya no lo necesitamos  ');
    await confirmAndSend(user);

    await waitFor(() => expect(screen.getByTestId('portal-check-email-modal')).toBeInTheDocument());
    expect(bodyOf(apiFetch)).toEqual({ decision: 'REJECT', reasonCode: 'OTHER', reasonText: 'Ya no lo necesitamos' });
  });
});

describe('PortalDecisionActions — a refused request', () => {
  for (const [label, answer, key] of [
    ['a cooldown', () => jsonResponse({ error: 'cooldown' }, { status: 409 }), 'portalDecisionCooldown'],
    ['no recipient', () => jsonResponse({ error: 'no_recipient' }, { status: 409 }), 'portalDecisionBlockedNoRecipient'],
    ['an expired quotation', () => jsonResponse({ error: 'expired' }, { status: 409 }), 'portalDecisionBlockedExpired'],
    ['a quotation no longer pending', () => jsonResponse({ error: 'not_pending' }, { status: 409 }), 'portalDecisionBlockedNotPending'],
    ['an unknown refusal', () => jsonResponse({ error: 'boom' }, { status: 400 }), 'portalDecisionError'],
    ['a request that never completed', () => { throw new TypeError('Failed to fetch'); }, 'portalDecisionError'],
  ]) {
    it(`says so for ${label}, and keeps the buttons`, async () => {
      const user = userEvent.setup();
      renderActions(quotation(OPEN), { apiFetch: vi.fn(async () => answer()) });

      await user.click(screen.getByTestId('portal-decision-accept'));
      await user.click(screen.getByTestId('portal-accept-continue'));

      await waitFor(() => expect(screen.getByTestId('portal-decision-error')).toBeInTheDocument());
      expect(screen.getByTestId('portal-decision-error').textContent).toBe(t(key, { tenantName: 'Acme SA' }));
      expect(screen.getByTestId('portal-decision-accept')).toBeEnabled();
      expect(screen.queryByTestId('portal-decision-sent')).not.toBeInTheDocument();
    });
  }

  // CP-49 in a race with the detail: the backend refuses because the quotation was not emailed to
  // this address — the buttons go, the reason stays.
  it('hides the buttons and says why when the request answers not_recipient', async () => {
    const user = userEvent.setup();
    renderActions(quotation(OPEN), {
      apiFetch: vi.fn(async () => jsonResponse({ error: 'not_recipient' }, { status: 409 })),
    });

    await user.click(screen.getByTestId('portal-decision-accept'));
    await user.click(screen.getByTestId('portal-accept-continue'));

    await waitFor(() => expect(screen.getByTestId('portal-decision-blocked'))
      .toHaveTextContent('portalDecisionBlockedNotRecipient'));
    expect(screen.queryByTestId('portal-decision-accept')).not.toBeInTheDocument();
    expect(screen.queryByTestId('portal-decision-reject')).not.toBeInTheDocument();
    expect(screen.queryByTestId('portal-decision-error')).not.toBeInTheDocument();
  });

  it('hands a rejected token to the page instead of showing an error', async () => {
    const user = userEvent.setup();
    const { onInvalid } = renderActions(quotation(OPEN), {
      apiFetch: vi.fn(async () => jsonResponse({}, { status: 401 })),
    });

    await user.click(screen.getByTestId('portal-decision-accept'));
    await user.click(screen.getByTestId('portal-accept-continue'));

    await waitFor(() => expect(onInvalid).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('portal-decision-error')).not.toBeInTheDocument();
  });
});

describe('PortalDecisionActions — 409 accept_unavailable', () => {
  it('says accepting is unavailable instead of the generic send error', async () => {
    const user = userEvent.setup();
    const apiFetch = vi.fn(async () => jsonResponse({ error: 'accept_unavailable' }, { status: 409 }));
    renderActions(quotation(OPEN), { apiFetch });

    await user.click(screen.getByTestId('portal-decision-accept'));
    await user.click(screen.getByTestId('portal-accept-continue'));

    await waitFor(() => expect(screen.getByTestId('portal-decision-error').textContent)
      .toBe(t('portalDecisionAcceptUnavailable', { tenantName: 'Acme SA' })));
  });
});

// Mobile redesign (2026-11-25): the list card's options menu opens these popups with no buttons
// of its own (`variant="headless"`), and is told when the flow is over.
describe('PortalDecisionActions — headless (list card options)', () => {
  function renderHeadless(document, { initialStep = 'accept', apiFetch = vi.fn() } = {}) {
    const onDone = vi.fn();
    render(
      <PortalDecisionActions
        apiFetch={apiFetch}
        token={TOKEN}
        document={document}
        tenantName="Acme SA"
        onInvalid={vi.fn()}
        variant="headless"
        initialStep={initialStep}
        onDone={onDone}
      />,
    );
    return { onDone, apiFetch };
  }

  it.each([
    ['accept', 'portal-accept-modal'],
    ['reject', 'portal-reject-modal'],
  ])('opens straight on the %s popup, with no buttons', (initialStep, modal) => {
    renderHeadless(quotation(OPEN), { initialStep });

    expect(screen.getByTestId(modal)).toBeInTheDocument();
    expect(screen.queryByTestId('portal-decision-panel')).not.toBeInTheDocument();
    expect(screen.queryByTestId('portal-decision-accept')).not.toBeInTheDocument();
  });

  it('opens nothing and reports why when the quotation was not sent to this address (CP-49)', async () => {
    const { onDone } = renderHeadless(quotation({ ...OPEN, canDecide: false, blockedReason: 'not_recipient' }));

    await waitFor(() => expect(onDone).toHaveBeenCalledWith('portalDecisionBlockedNotRecipient'));
    expect(screen.queryByTestId('portal-accept-modal')).not.toBeInTheDocument();
  });

  it('opens no accept popup and reports why when accepting is unavailable, but still offers rejecting', async () => {
    const { onDone } = renderHeadless(quotation({ ...OPEN, acceptAvailable: false }));

    await waitFor(() => expect(onDone).toHaveBeenCalledWith('portalDecisionAcceptUnavailable'));
    expect(screen.queryByTestId('portal-accept-modal')).not.toBeInTheDocument();
  });

  it('opens the reject popup when accepting is unavailable', () => {
    renderHeadless(quotation({ ...OPEN, acceptAvailable: false }), { initialStep: 'reject' });

    expect(screen.getByTestId('portal-reject-modal')).toBeInTheDocument();
  });

  it('ends once the customer closes the popup', async () => {
    const user = userEvent.setup();
    const { onDone } = renderHeadless(quotation(OPEN));

    await user.click(screen.getByTestId('portal-accept-cancel'));

    await waitFor(() => expect(onDone).toHaveBeenCalledWith(null));
  });

  it('ends with no message once the sent confirmation is acknowledged', async () => {
    const user = userEvent.setup();
    const apiFetch = vi.fn(async () => jsonResponse({ state: 'sent', email: 'contact@acme.com' }));
    const { onDone } = renderHeadless(quotation(OPEN), { apiFetch });

    await user.click(screen.getByTestId('portal-accept-continue'));
    await user.click(await screen.findByTestId('portal-check-email-ok'));

    await waitFor(() => expect(onDone).toHaveBeenCalledWith(null));
    expect(bodyOf(apiFetch)).toEqual({ decision: 'ACCEPT' });
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  // A refused send closes the popup and hands the reason to the card, which shows it as a toast.
  it.each([
    ['a cooldown', 'cooldown', 'portalDecisionCooldown'],
    ['a quotation not sent to this address', 'not_recipient', 'portalDecisionBlockedNotRecipient'],
    ['a quotation no longer pending', 'not_pending', 'portalDecisionBlockedNotPending'],
  ])('ends with the reason when the send is refused for %s', async (_label, code, key) => {
    const user = userEvent.setup();
    const apiFetch = vi.fn(async () => jsonResponse({ error: code }, { status: 409 }));
    const { onDone } = renderHeadless(quotation(OPEN), { apiFetch });

    await user.click(screen.getByTestId('portal-accept-continue'));

    await waitFor(() => expect(onDone).toHaveBeenCalledWith(key));
    expect(screen.queryByTestId('portal-accept-modal')).not.toBeInTheDocument();
    expect(screen.queryByTestId('portal-check-email-modal')).not.toBeInTheDocument();
  });

  // The detail re-read for the card may say the quotation can no longer be answered: no popup may
  // be left open over the list, and the flow must still end so the card can open another one.
  it.each([
    ['an answered quotation', quotation({ ...OPEN, canDecide: false, blockedReason: 'not_pending' }, { documentStatus: 'CJ' }), null],
    ['an expired quotation', quotation({ ...OPEN, canDecide: false, blockedReason: 'expired' }, { validUntil: '2020-01-10' }), 'portalDecisionBlockedExpired'],
    ['a detail with no decision block', quotation(undefined), null],
  ])('opens no popup and ends on %s', async (_label, document, key) => {
    const { onDone } = renderHeadless(document, { initialStep: 'reject' });

    await waitFor(() => expect(onDone).toHaveBeenCalledWith(key));
    expect(screen.queryByTestId('portal-reject-modal')).not.toBeInTheDocument();
    expect(screen.queryByTestId('portal-accept-modal')).not.toBeInTheDocument();
  });
});
