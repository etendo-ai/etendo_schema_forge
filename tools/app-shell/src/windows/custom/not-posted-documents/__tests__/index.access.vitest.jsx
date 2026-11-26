// @covers tools/app-shell/src/windows/custom/not-posted-documents/index.jsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@/i18n', () => ({
  useUI: () => (key) => key,
  useLabel: () => (key) => key,
  useMenuLabel: () => (key) => key,
  useLocale: () => ({}),
  useLocaleSwitch: () => ({ locale: 'es_ES', setLocale: vi.fn() }),
}));
vi.mock('@/components/layout/PageMetaContext', () => ({ useSetPageMeta: () => vi.fn() }));

let currentTier = 'full';
// The page's own table reads the real AuthContext (no provider: it degrades to "nothing loaded");
// only the access hook and the guard are replaced.
vi.mock('@/auth/AuthContext.jsx', async (importOriginal) => ({
  ...(await importOriginal()),
  useWindowAccess: vi.fn(() => currentTier),
  WindowAccessGuard: ({ windowId }) => (
    <div data-testid="window-access-denied" data-window-id={windowId} />
  ),
}));

import { useWindowAccess } from '@/auth/AuthContext.jsx';
import NotPostedDocumentsRoute, { NOT_POSTED_DOCUMENTS_FEATURE_ID } from '../index.jsx';

// ETP-5485 (BUG-2) / ETP-4802 — the route entry registered in `windows/registry.js`
// (`'not-posted-documents'`) gates the page on the GO feature `not-posted-documents`, the same
// decision the backend handler and the sidebar entry use, so a role without it never mounts the
// page and never fires its requests.
describe('not-posted-documents route entry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.fetch = vi.fn(() => Promise.resolve({ ok: true, json: async () => ({ rows: [] }) }));
  });

  it('checks access against the GO feature id, not the OBUIAPP process id', () => {
    expect(NOT_POSTED_DOCUMENTS_FEATURE_ID).toBe('not-posted-documents');
  });

  it('shows the access-denied screen and never mounts the page for a role without the feature', () => {
    currentTier = 'none';
    render(<NotPostedDocumentsRoute token="t" apiBaseUrl="/swebsf/not-posted-documents" />);
    expect(useWindowAccess).toHaveBeenCalledWith('not-posted-documents');
    expect(screen.getByTestId('window-access-denied')).toHaveAttribute('data-window-id', 'not-posted-documents');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it.each(['full', 'read-only'])('mounts the page for a role with the %s tier', async (tier) => {
    currentTier = tier;
    render(
      <MemoryRouter initialEntries={['/not-posted-documents']}>
        <NotPostedDocumentsRoute token="t" apiBaseUrl="/swebsf/not-posted-documents" />
      </MemoryRouter>,
    );
    expect(await screen.findByTestId('npd-empty-none')).toBeInTheDocument();
    expect(screen.queryByTestId('window-access-denied')).not.toBeInTheDocument();
  });
});
