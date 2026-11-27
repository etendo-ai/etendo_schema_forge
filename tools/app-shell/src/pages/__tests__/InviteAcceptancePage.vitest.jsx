// @covers tools/app-shell/src/pages/InviteAcceptancePage.jsx
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider, createMemoryAuthStorage } from '@etendo-ai/app-shell-core/auth';
import InviteAcceptancePage from '../InviteAcceptancePage.jsx';

/**
 * ETP-4960: this page renders the REAL `LoginStep` / `RegisterStep` from
 * `@etendo-ai/etendo-go-core`, not stand-ins.
 *
 * The page previously mocked the whole onboarding barrel with hand-written
 * forms whose submit handler always invoked `onAuthenticated`. That asserted
 * the page's reaction to a contract the real component was not honouring, and
 * it is how ETP-4958 — SSO login authenticating but never resuming the
 * invitation — reached a user with a green test suite.
 *
 * Only genuine external boundaries are stubbed: the i18n dictionaries and the
 * SSO provider SDK (there is no real Google Identity script in jsdom). `fetch`
 * is stubbed per test as before.
 */
vi.mock('@/i18n', () => ({
  useUI: () => (key) => key,
}));

const logoutMock = vi.fn();
vi.mock('@/auth/useLogout.js', () => ({
  useLogout: () => logoutMock,
}));

vi.mock('@etendo-ai/app-shell-core/i18n', () => ({
  useUI: () => (key) => key,
  // No setLocale → the shared auth steps skip the language selector.
  useLocaleSwitch: () => ({ locale: 'es_ES', setLocale: null }),
}));

// Captures the credential callback the auth step hands to the provider SDK, so
// a test can complete an SSO sign-in without a real Google button.
let ssoHandlers = null;

vi.mock('@etendo-ai/etendo-go-core/onboarding/sso', () => ({
  getConfiguredSsoProviders: () => ['google'],
  renderSsoProviderButton: async (provider, container, handlers) => {
    ssoHandlers = handlers;
  },
  loadGoogleIdentityScript: async () => {},
  buildGoogleSsoPayload: (payload) => payload,
  readCookie: () => null,
}));

describe('InviteAcceptancePage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    logoutMock.mockClear();
    ssoHandlers = null;
    globalThis.localStorage.clear();
  });

  /**
   * Wrapped in a signed-out AuthProvider, which is the arrangement the app itself has: this
   * route lives inside AppShellRuntime (runtime-routes.jsx), and every case in this file models
   * a visitor arriving with no session.
   *
   * It also has to be here rather than left implicit. ETP-5202's session guard asks
   * /sws/neo/session who is signed in, and ETP-4576 made it ask unconditionally — there is no
   * localStorage token left to rule the question out. The mocks below are an ORDERED
   * `mockResolvedValueOnce` queue, so that extra request silently consumed the response meant
   * for the next step and every assertion after it slid one place. A settled 'anonymous' lets
   * the guard answer without a request, which is both the real behaviour and a stable queue.
   */
  function renderPage(initialEntry = '/invite?token=valid-token-123') {
    return render(
      <AuthProvider restoreSession={null} storage={createMemoryAuthStorage()}>
        <MemoryRouter initialEntries={[initialEntry]}>
          <Routes>
            <Route path="/invite" element={<InviteAcceptancePage />} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    );
  }

  it('renders error state when token is missing', async () => {
    renderPage('/invite');

    await waitFor(() => {
      expect(screen.getByTestId('invite-error-state')).toBeInTheDocument();
      expect(screen.getByTestId('action-error-sign-in')).toBeInTheDocument();
    });
  });

  it('resolves existing-account branch and allows 1-click acceptance', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 'SENT',
          clientName: 'Acme Corp',
          email: 'existing.user@example.com',
          maskedEmail: 'e***r@example.com',
          branch: 'existing_account',
          accountExists: true,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          token: 'existing-session-token',
          account: { email: 'existing.user@example.com' },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 'success',
          message: 'Invitation accepted successfully',
          clientName: 'Acme Corp',
        }),
      });
    globalThis.fetch = fetchMock;

    const renderResult = renderPage('/invite?token=valid-token-123');

    const { container } = renderResult;
    await waitFor(() => {
      expect(screen.getByTestId('invite-shared-login')).toBeInTheDocument();
      expect(screen.getByTestId('action-login-submit')).toBeInTheDocument();
      expect(screen.getByDisplayValue('existing.user@example.com')).toBeInTheDocument();
    });

    fireEvent.change(container.querySelector('#login-password'), {
      target: { value: 'existing-password' },
    });
    fireEvent.click(screen.getByTestId('action-login-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('invite-authenticated-step')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('action-accept-invitation'));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        // ETP-4576 — logging in creates a SESSION now; the endpoint moved with it.
        expect.stringContaining('/sws/go/session'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            email: 'existing.user@example.com',
            password: 'existing-password',
          }),
        })
      );
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/sws/go/company-invitations/accept'),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ Authorization: 'Bearer existing-session-token', 'Accept-Language': 'es_ES' }),
          body: JSON.stringify({ token: 'valid-token-123' }),
        })
      );
      expect(screen.getByTestId('invite-success-state')).toBeInTheDocument();
      expect(screen.getByTestId('action-go-to-app')).toBeInTheDocument();
    });
  });

  // ETP-4958 regression: SSO authenticated the user but never returned control
  // to this page, so the acceptance step was never reached and the invitation
  // token stayed unconsumed. With the shared LoginStep mocked away, no test in
  // either repo exercised this path.
  it('resumes the invitation after an SSO login on the existing-account branch', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 'SENT',
          clientName: 'Acme Corp',
          email: 'existing.user@example.com',
          maskedEmail: 'e***r@example.com',
          branch: 'existing_account',
          accountExists: true,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          token: 'sso-session-token',
          account: { email: 'existing.user@example.com' },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 'success',
          message: 'Invitation accepted successfully',
          clientName: 'Acme Corp',
        }),
      });
    globalThis.fetch = fetchMock;

    renderPage('/invite?token=valid-token-789');

    await waitFor(() => {
      expect(screen.getByTestId('invite-shared-login')).toBeInTheDocument();
    });

    // Complete a successful SSO sign-in through the callback the real LoginStep
    // registered with the provider SDK.
    await waitFor(() => expect(ssoHandlers).not.toBeNull());
    ssoHandlers.onCredential('google', { credential: 'google-jwt' });

    // The page must advance to the acceptance step instead of leaving the user
    // on the login form.
    await waitFor(() => {
      expect(screen.getByTestId('invite-authenticated-step')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('action-login-submit')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('action-accept-invitation'));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        // ETP-4576 — same move for the SSO branch: /sws/go/session/sso/<provider>.
        expect.stringContaining('/sws/go/session/sso/google'),
        expect.objectContaining({
          method: 'POST',
          // ETP-6363: the body also carries the lead-attribution context (hubspotContext).
          body: expect.stringContaining('"credential":"google-jwt"'),
        })
      );
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/sws/go/company-invitations/accept'),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ Authorization: 'Bearer sso-session-token', 'Accept-Language': 'es_ES' }),
          body: JSON.stringify({ token: 'valid-token-789' }),
        })
      );
      expect(screen.getByTestId('invite-success-state')).toBeInTheDocument();
    });
  });

  // ETP-5385 — a signed-in invitee must see ONE outcome: the dead-link error screen for a
  // terminal failure, or the error alone (never next to the "continue to join this company"
  // prompt) for anything else.
  //
  // Only the `resolve` 404 below was recorded from the running environment
  // (GET /sws/go/company-invitations/resolve?token=bogus -> 404). The `accept` bodies
  // (EXPIRED_TOKEN, INVITATION_ACCOUNT_MISMATCH, ...) are modelled on that shape from the servlet's
  // writeError, not captured from the reported two-company scenario:
  //   {"error":{"code":"INVALID_TOKEN","message":"Invalid or unknown invitation link",
  //             "userMessage":"Invalid or unknown invitation link","status":404}}
  // i.e. the code is NESTED under `error`. A flat `{ error: true, code }` body is what the page
  // used to read and what the first version of these tests mocked, so the terminal branch passed
  // here and never matched against the server.
  const wireError = (status, code, message) => ({
    ok: false,
    status,
    json: async () => ({ error: { code, message, userMessage: message, status } }),
  });
  const SECOND_INVITATION = {
    status: 'SENT',
    clientName: 'Second Co',
    email: 'existing.user@example.com',
    branch: 'existing_account',
    accountExists: true,
  };

  async function signInAndAccept(acceptOutcome) {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => SECOND_INVITATION })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ token: 'existing-session-token', account: { email: 'existing.user@example.com' } }),
      });
    if (acceptOutcome instanceof Error) fetchMock.mockRejectedValueOnce(acceptOutcome);
    else fetchMock.mockResolvedValueOnce(acceptOutcome);
    globalThis.fetch = fetchMock;

    const { container } = renderPage('/invite?token=second-company-token');
    await waitFor(() => expect(screen.getByTestId('action-login-submit')).toBeInTheDocument());
    fireEvent.change(container.querySelector('#login-password'), { target: { value: 'pw' } });
    fireEvent.click(screen.getByTestId('action-login-submit'));
    await waitFor(() => expect(screen.getByTestId('invite-authenticated-step')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('action-accept-invitation'));
    return fetchMock;
  }

  // The page opened with a session already in place (accepted invitation A as X, then opens B):
  // no AuthProvider, so the session guard asks /sws/neo/session and lands on the signed-in step
  // by itself, with no click.
  function renderSignedIn(resolveOutcome, { acceptOutcome } = {}) {
    const fetchMock = vi.fn((url) => {
      if (String(url).includes('/company-invitations/resolve')) return Promise.resolve(resolveOutcome);
      if (String(url).includes('/sws/neo/session')) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ accountEmail: 'Existing.User@example.com' }) });
      }
      if (String(url).includes('/company-invitations/accept')) return Promise.resolve(acceptOutcome);
      return Promise.reject(new Error(`unexpected request ${url}`));
    });
    globalThis.fetch = fetchMock;
    render(
      <MemoryRouter initialEntries={['/invite?token=second-company-token']}>
        <Routes>
          <Route path="/invite" element={<InviteAcceptancePage />} />
        </Routes>
      </MemoryRouter>
    );
    return fetchMock;
  }

  const acceptCalls = (fetchMock) =>
    fetchMock.mock.calls.filter(([url]) => String(url).includes('/company-invitations/accept'));

  it('shows only the join prompt on load for a valid second invitation, with no click (ETP-5385)', async () => {
    const fetchMock = renderSignedIn({ ok: true, json: async () => SECOND_INVITATION });

    await waitFor(() => expect(screen.getByTestId('invite-authenticated-step')).toBeInTheDocument());
    expect(screen.getByText('invitePageAuthenticatedNotice')).toBeInTheDocument();
    expect(screen.queryByTestId('invite-action-error')).not.toBeInTheDocument();
    expect(screen.queryByTestId('invite-error-state')).not.toBeInTheDocument();
    expect(screen.queryByText('invitePageInvalidDescription')).not.toBeInTheDocument();
    expect(acceptCalls(fetchMock)).toHaveLength(0);
  });

  it('shows only the error screen on load when resolve rejects the second invitation (ETP-5385)', async () => {
    const fetchMock = renderSignedIn(wireError(404, 'INVALID_TOKEN', 'Invalid or unknown invitation link'));

    await waitFor(() => expect(screen.getByTestId('invite-error-state')).toBeInTheDocument());
    expect(screen.queryByTestId('invite-authenticated-step')).not.toBeInTheDocument();
    expect(screen.queryByText('invitePageAuthenticatedNotice')).not.toBeInTheDocument();
    expect(acceptCalls(fetchMock)).toHaveLength(0);
  });

  it('accepts a valid second invitation and shows the success screen only (ETP-5385)', async () => {
    renderSignedIn(
      { ok: true, json: async () => SECOND_INVITATION },
      { acceptOutcome: { ok: true, status: 200, json: async () => ({ clientName: 'Second Co' }) } }
    );
    await waitFor(() => expect(screen.getByTestId('action-accept-invitation')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('action-accept-invitation'));

    await waitFor(() => expect(screen.getByTestId('invite-success-state')).toBeInTheDocument());
    expect(screen.queryByTestId('invite-action-error')).not.toBeInTheDocument();
    expect(screen.queryByTestId('invite-error-state')).not.toBeInTheDocument();
    expect(screen.queryByText('invitePageAuthenticatedNotice')).not.toBeInTheDocument();
  });

  it.each([
    [404, 'INVALID_TOKEN', 'Invalid or unknown invitation link'],
    [400, 'EXPIRED_TOKEN', 'This invitation link has expired or has been revoked'],
  ])(
    'shows only the error screen when accept fails with %s %s (ETP-5385)',
    async (status, code, message) => {
      await signInAndAccept(wireError(status, code, message));

      await waitFor(() => expect(screen.getByTestId('invite-error-state')).toBeInTheDocument());
      expect(screen.queryByTestId('invite-authenticated-step')).not.toBeInTheDocument();
      expect(screen.queryByTestId('action-accept-invitation')).not.toBeInTheDocument();
      expect(screen.queryByText('invitePageAuthenticatedNotice')).not.toBeInTheDocument();
      // Already signed in: offering "sign in" would be wrong, so the page offers the app.
      expect(screen.getByTestId('action-error-go-to-app')).toHaveTextContent('invitePageGoToApp');
      expect(screen.queryByTestId('action-error-sign-in')).not.toBeInTheDocument();
    }
  );

  it('offers sign in, not the app, on the error screen for an anonymous visitor (ETP-5385)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce(wireError(404, 'INVALID_TOKEN', 'Invalid or unknown invitation link'));
    renderPage('/invite?token=dead-token');

    await waitFor(() => expect(screen.getByTestId('invite-error-state')).toBeInTheDocument());
    expect(screen.getByTestId('action-error-sign-in')).toHaveTextContent('invitePageSignIn');
    expect(screen.queryByTestId('action-error-go-to-app')).not.toBeInTheDocument();
  });

  it('shows the mismatch error with a sign-out instead of a retry, and no join prompt (ETP-5385)', async () => {
    await signInAndAccept(wireError(403, 'INVITATION_ACCOUNT_MISMATCH', 'Wrong account for this invitation'));

    await waitFor(() => expect(screen.getByTestId('invite-action-error')).toHaveTextContent('invitePageAccountMismatch'));
    expect(screen.queryByText('invitePageAuthenticatedNotice')).not.toBeInTheDocument();
    expect(screen.queryByTestId('invite-error-state')).not.toBeInTheDocument();
    // The same account would fail again, so there is no retry.
    expect(screen.queryByTestId('action-accept-invitation')).not.toBeInTheDocument();
    expect(screen.getByTestId('action-mismatch-sign-out')).toHaveTextContent('inviteSessionConflictLogoutUnknown');

    // The button must actually sign out and reload into the same invitation.
    const replace = vi.fn();
    vi.stubGlobal('location', { ...globalThis.location, pathname: '/invite', replace });
    try {
      fireEvent.click(screen.getByTestId('action-mismatch-sign-out'));
      expect(logoutMock).toHaveBeenCalledTimes(1);
      expect(replace).toHaveBeenCalledWith('/invite?token=second-company-token');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('does not call the link invalid when the accept request fails on the network (ETP-5385)', async () => {
    await signInAndAccept(new Error('network down'));

    await waitFor(() => expect(screen.getByTestId('invite-action-error')).toBeInTheDocument());
    expect(screen.getByTestId('invite-action-error')).toHaveTextContent('invitePageAcceptFailed');
    expect(screen.getByTestId('invite-action-error')).not.toHaveTextContent('invitePageInvalidDescription');
    expect(screen.queryByText('invitePageAuthenticatedNotice')).not.toBeInTheDocument();
    expect(screen.queryByTestId('invite-error-state')).not.toBeInTheDocument();
    // Retryable: the accept button stays.
    expect(screen.getByTestId('action-accept-invitation')).toBeInTheDocument();
  });

  // Recorded on 2026-11-27 in a local-env of develop + this branch: the invited email had already
  // joined another company and the second invitation's AD_User was deactivated, so accept answered
  // exactly this. Before this change the old page showed "invalid link" next to "continue to join";
  // the first version of this fix showed "try again", which fails the same way on every click.
  const RECORDED_USER_INVALID = {
    ok: false,
    status: 409,
    json: async () => ({
      error: {
        code: 'INVITATION_USER_CONFIGURATION_INVALID',
        message: 'The invitation user is no longer valid',
        userMessage: 'The invitation user is no longer valid',
        status: 409,
      },
    }),
  };

  it('shows a no-retry page of its own when the invitation user is no longer valid (ETP-5385, recorded 409)', async () => {
    await signInAndAccept(RECORDED_USER_INVALID);

    await waitFor(() => expect(screen.getByTestId('invite-error-state')).toBeInTheDocument());
    expect(screen.getByText('invitePageUserInvalidTitle')).toBeInTheDocument();
    expect(screen.getByText('invitePageUserInvalidDescription')).toBeInTheDocument();
    expect(screen.queryByText('invitePageInvalidTitle')).not.toBeInTheDocument();
    expect(screen.queryByText('invitePageAcceptFailed')).not.toBeInTheDocument();
    expect(screen.queryByText('invitePageAuthenticatedNotice')).not.toBeInTheDocument();
    expect(screen.queryByTestId('action-accept-invitation')).not.toBeInTheDocument();
    expect(screen.getByTestId('action-error-go-to-app')).toBeInTheDocument();
  });

  it('tells the support account it cannot join, with no retry (ETP-5385)', async () => {
    await signInAndAccept(wireError(403, 'SUPPORT_SESSION_FORBIDDEN', 'Not available in a support session'));

    await waitFor(() => expect(screen.getByTestId('invite-error-state')).toBeInTheDocument());
    expect(screen.getByText('invitePageSupportAccountTitle')).toBeInTheDocument();
    expect(screen.queryByTestId('action-accept-invitation')).not.toBeInTheDocument();
    expect(screen.queryByText('invitePageAuthenticatedNotice')).not.toBeInTheDocument();
  });

  it('sends the visitor back to sign in when the session is not the invited active account (ETP-5385)', async () => {
    await signInAndAccept(wireError(400, 'ACCOUNT_REQUIRED', 'No active platform account found. Registration is required.'));

    await waitFor(() => expect(screen.getByTestId('action-login-submit')).toBeInTheDocument());
    expect(screen.queryByTestId('invite-error-state')).not.toBeInTheDocument();
    expect(screen.queryByTestId('invite-action-error')).not.toBeInTheDocument();
    expect(screen.queryByTestId('action-accept-invitation')).not.toBeInTheDocument();
  });

  it('shows the weak-password message when register-and-accept answers the nested error (ETP-5385)', async () => {
    const json = (status, body) => ({ ok: status < 400, status, json: async () => body });
    globalThis.fetch = vi.fn(async (url) => {
      const path = String(url);
      if (path.includes('/sws/go/terms')) return json(200, { version: '2026-11', language: 'es_ES', content: 'Terms.', publishedAt: 0 });
      if (path.includes('/sws/go/company-invitations/register-and-accept')) {
        return json(400, { error: { code: 'WEAK_PASSWORD', message: 'Password too weak', userMessage: 'Password too weak', status: 400 } });
      }
      return json(200, {
        status: 'SENT',
        clientName: 'Acme Corp',
        email: 'new.user@example.com',
        maskedEmail: 'n***r@example.com',
        branch: 'registration_required',
        accountExists: false,
      });
    });

    const { container } = renderPage('/invite?token=valid-token-456');
    await waitFor(() => expect(screen.getByTestId('action-register-submit')).toBeInTheDocument());
    fireEvent.change(container.querySelector('#reg-name'), { target: { value: 'New User' } });
    fireEvent.change(container.querySelector('#reg-password'), { target: { value: 'Str0ng!Pass123' } });
    await waitFor(() => {
      expect(globalThis.fetch.mock.calls.some(([url]) => String(url).includes('/sws/go/terms'))).toBe(true);
    });
    await act(async () => {});
    fireEvent.click(screen.getByTestId('action-register-submit'));

    await waitFor(() => expect(screen.getByText(/onboardingWeakPassword/)).toBeInTheDocument());
    expect(screen.queryByText(/invitePageInvalidDescription/)).not.toBeInTheDocument();
    expect(screen.queryByTestId('invite-success-state')).not.toBeInTheDocument();
  });

  it('resolves registration_required branch and creates account then accepts', async () => {
    // Answered by URL, not by call order: the register screen also loads the terms and
    // conditions when it opens (ETP-6081), and that request would take another one's answer.
    const json = (body) => ({ ok: true, status: 200, json: async () => body });
    const fetchMock = vi.fn(async (url) => {
      const path = String(url);
      if (path.includes('/sws/go/terms')) {
        return json({ version: '2026-11', language: 'es_ES', content: 'Terms.', publishedAt: 0 });
      }
      if (path.includes('/sws/go/company-invitations/register-and-accept')) {
        return json({
          status: 'success',
          token: 'new-session-token',
          account: { id: 'acc-1', email: 'new.user@example.com', name: 'New User' },
          clientName: 'Acme Corp',
        });
      }
      return json({
        status: 'SENT',
        clientName: 'Acme Corp',
        email: 'new.user@example.com',
        maskedEmail: 'n***r@example.com',
        branch: 'registration_required',
        accountExists: false,
      });
    });
    globalThis.fetch = fetchMock;

    const { container } = renderPage('/invite?token=valid-token-456');

    await waitFor(() => {
      expect(screen.getByTestId('invite-new-account')).toBeInTheDocument();
      expect(container.querySelector('#reg-email')).toHaveValue('new.user@example.com');
      expect(screen.getByTestId('action-register-submit')).toBeInTheDocument();
    });

    fireEvent.change(container.querySelector('#reg-name'), {
      target: { value: 'New User' },
    });
    fireEvent.change(container.querySelector('#reg-password'), {
      target: { value: 'Str0ng!Pass123' },
    });
    // The version is only sent once the terms have arrived: let their request settle first.
    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/sws/go/terms'))).toBe(true);
    });
    await act(async () => {});
    fireEvent.click(screen.getByTestId('action-register-submit'));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/sws/go/company-invitations/register-and-accept'),
        expect.objectContaining({
          method: 'POST',
          // ETP-6081: the terms version the register screen showed travels with the account.
          body: JSON.stringify({
            token: 'valid-token-456',
            name: 'New User',
            password: 'Str0ng!Pass123',
            termsVersion: '2026-11',
          }),
        })
      );
      expect(screen.getByTestId('invite-success-state')).toBeInTheDocument();
    });
  });

  // ETP-5488 — register-and-accept creates the account but opens no session, so the new invitee
  // used to land on the success screen signed out: "Entrar en <empresa>" returned before sending
  // a single request and showed "No hemos podido abrir esa empresa", roles or not. The page now
  // signs the new account in (POST /sws/go/session, the cookie session) right after registering,
  // so entering the company asks the server for the environments like any signed-in user.
  it('signs the new account in after registering so entering the company reaches the server', async () => {
    const calls = [];
    const fetchMock = vi.fn(async (url, options = {}) => {
      const path = String(url);
      calls.push({ path, method: options.method || 'GET', body: options.body });
      const json = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
      if (path.includes('/sws/go/company-invitations/register-and-accept')) {
        return json({ status: 'success', token: 'legacy-token', clientName: 'Acme Corp',
          account: { id: 'acc-1', email: 'new.user@example.com', name: 'New User' } });
      }
      if (path.includes('/sws/go/company-invitations')) {
        return json({ status: 'SENT', clientName: 'Acme Corp', email: 'new.user@example.com',
          maskedEmail: 'n***r@example.com', branch: 'registration_required', accountExists: false });
      }
      if (path.endsWith('/sws/go/session') && options.method === 'POST') {
        return json({ status: 'success', csrfToken: 'csrf-new-user',
          account: { id: 'acc-1', email: 'new.user@example.com', name: 'New User' } });
      }
      if (path.includes('/sws/go/environments')) return json({ environments: [] });
      return { ok: false, status: 401, json: async () => ({}), text: async () => '' };
    });
    globalThis.fetch = fetchMock;

    const { container } = renderPage('/invite?token=valid-token-789');
    await waitFor(() => expect(screen.getByTestId('action-register-submit')).toBeInTheDocument());
    fireEvent.change(container.querySelector('#reg-name'), { target: { value: 'New User' } });
    fireEvent.change(container.querySelector('#reg-password'), { target: { value: 'Str0ng!Pass123' } });
    fireEvent.click(screen.getByTestId('action-register-submit'));
    await waitFor(() => expect(screen.getByTestId('invite-success-state')).toBeInTheDocument());

    const login = calls.find((c) => c.path.endsWith('/sws/go/session') && c.method === 'POST');
    expect(login).toBeTruthy();
    expect(JSON.parse(login.body)).toEqual({ email: 'new.user@example.com', password: 'Str0ng!Pass123' });

    fireEvent.click(screen.getByTestId('action-go-to-app'));
    await waitFor(() => expect(calls.some((c) => c.path.includes('/sws/go/environments'))).toBe(true));
  });

  it('renders already accepted state idempotently', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: 'ACCEPTED',
        clientName: 'Acme Corp',
        branch: 'accepted',
      }),
    });
    globalThis.fetch = fetchMock;

    renderPage('/invite?token=already-accepted-token');

    await waitFor(() => {
      expect(screen.getByTestId('invite-success-state')).toBeInTheDocument();
      expect(screen.getByText('invitePageAlreadyAcceptedTitle')).toBeInTheDocument();
    });
  });

  it('renders invalid or expired error state when backend rejects token', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({
        error: true,
        code: 'EXPIRED_TOKEN',
        message: 'This invitation link has expired',
      }),
    });
    globalThis.fetch = fetchMock;

    renderPage('/invite?token=expired-token');

    await waitFor(() => {
      expect(screen.getByTestId('invite-error-state')).toBeInTheDocument();
      expect(screen.getByText('invitePageInvalidTitle')).toBeInTheDocument();
    });
  });
});
