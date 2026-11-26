// @covers tools/app-shell/src/runtime-routes.jsx
// Kept apart from runtime-routes.vitest.js: it needs vi.mock of lazy pages, which would break that file's real imports.
// Scope: boundary wiring only. The reload-once policy (a factory rejecting with a chunk error) is
// covered in lib/__tests__/lazyWithReload.vitest.js; Vitest wraps errors thrown by a mocked factory.
// ETP-6400 — a failing lazy chunk ends in the boundary, not in "Loading...", and a later
// navigation to a healthy lazy route recovers.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useNavigate } from 'react-router-dom';
import { buildRuntimeRoutes } from '../runtime-routes.jsx';

// The module resolves, but reading its default export throws a real chunk TypeError while React
// renders the lazy page: that is what the boundary must catch (Vitest would wrap an error thrown
// by the factory itself, losing the chunk message).
vi.mock('../pages/OnboardingPage.jsx', () => ({
  get default() {
    throw new TypeError('Failed to fetch dynamically imported module: /assets/OnboardingPage-abc.js');
  },
}));
vi.mock('../pages/ApiKeysPage.jsx', () => ({ default: () => <p>api keys ok</p> }));
vi.mock('@/lib/observability.js', () => ({ captureException: vi.fn() }));

let navigate;
function Nav() {
  navigate = useNavigate();
  return null;
}

function renderAt(path) {
  const routes = buildRuntimeRoutes({ windowMap: {}, apiBaseUrl: '' });
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Nav />
      <Routes>
        {routes.filter((r) => r.path).map((r) => <Route key={r.path} path={r.path} element={r.element} />)}
      </Routes>
    </MemoryRouter>,
  );
}

describe('runtime routes — chunk load failure', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    window.sessionStorage.clear();
  });

  it.each(['/onboarding', '/login'])('shows the boundary on %s when the page chunk cannot be imported', async (path) => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    renderAt(path);
    expect(await screen.findByTestId('RouteChunkErrorBoundary__reload')).toBeTruthy();
  });

  it('renders a healthy lazy route after navigating away from a failed one', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    renderAt('/onboarding');
    await screen.findByTestId('RouteChunkErrorBoundary__reload');
    await act(async () => { navigate('/api-keys'); });
    expect(await screen.findByText('api keys ok')).toBeTruthy();
  });
});
