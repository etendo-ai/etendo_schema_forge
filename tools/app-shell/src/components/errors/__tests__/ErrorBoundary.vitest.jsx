// @covers tools/app-shell/src/components/errors/ErrorBoundary.jsx
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { captureException as defaultCapture } from '../../../lib/observability.js';
import { ErrorBoundary } from '../ErrorBoundary.jsx';

vi.mock('../../../lib/observability.js', () => ({ captureException: vi.fn() }));

function Boom() {
  throw new Error('boom');
}

function BrokenWidget() {
  throw new RangeError('Maximum call stack size exceeded');
}

describe('ETP-5792 — ErrorBoundary', () => {
  afterEach(() => vi.restoreAllMocks());

  it('renders the fallback instead of a blank page when a child throws', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<ErrorBoundary fallback={<p>fallback</p>}><Boom /></ErrorBoundary>);
    expect(screen.getByText('fallback')).toBeTruthy();
  });

  it('renders children when nothing throws', () => {
    render(<ErrorBoundary fallback={<p>fallback</p>}><p>ok</p></ErrorBoundary>);
    expect(screen.getByText('ok')).toBeTruthy();
  });

  it('recovers when remounted with a new key (what navigating to another page does)', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { rerender } = render(
      <ErrorBoundary key="a" fallback={<p>fallback</p>}><Boom /></ErrorBoundary>,
    );
    expect(screen.getByText('fallback')).toBeTruthy();
    rerender(<ErrorBoundary key="b" fallback={<p>fallback</p>}><p>ok</p></ErrorBoundary>);
    expect(screen.getByText('ok')).toBeTruthy();
  });

  describe('ETP-6442 — render error reporting', () => {
    let originalUrl;
    beforeEach(() => {
      originalUrl = window.location.pathname + window.location.search + window.location.hash;
      window.history.pushState({}, '', '/sales-order/0123456789ABCDEF0123456789ABCDEF?x=1#f');
      vi.spyOn(console, 'error').mockImplementation(() => {});
    });
    afterEach(() => {
      window.history.replaceState({}, '', originalUrl);
    });

    it('reports once with component, normalized route and errorClass', () => {
      const captureException = vi.fn();
      render(
        <ErrorBoundary fallback={<p>fallback</p>} captureException={captureException}>
          <BrokenWidget />
        </ErrorBoundary>,
      );
      expect(captureException).toHaveBeenCalledTimes(1);
      expect(captureException).toHaveBeenCalledWith(expect.any(RangeError), {
        component: 'BrokenWidget',
        route: '/sales-order/:recordId',
        errorClass: 'RangeError',
      });
      expect(screen.getByText('fallback')).toBeTruthy();
    });

    it.each([
      ['throws', () => { throw new Error('x'); }],
      ['rejects', () => Promise.reject(new Error('x'))],
    ])('still shows the fallback when captureException %s', async (_label, impl) => {
      const captureException = vi.fn(impl);
      render(
        <ErrorBoundary fallback={<p>fallback</p>} captureException={captureException}>
          <BrokenWidget />
        </ErrorBoundary>,
      );
      await Promise.resolve();
      expect(captureException).toHaveBeenCalledTimes(1);
      expect(screen.getByText('fallback')).toBeTruthy();
    });

    it('reports through the default observability gateway', () => {
      vi.mocked(defaultCapture).mockClear();
      render(<ErrorBoundary fallback={<p>fallback</p>}><BrokenWidget /></ErrorBoundary>);
      expect(defaultCapture).toHaveBeenCalledTimes(1);
      expect(defaultCapture).toHaveBeenCalledWith(
        expect.any(RangeError),
        expect.objectContaining({ component: 'BrokenWidget', errorClass: 'RangeError' }),
      );
    });

    it('does not report when nothing throws', () => {
      const captureException = vi.fn();
      render(
        <ErrorBoundary fallback={<p>fallback</p>} captureException={captureException}><p>ok</p></ErrorBoundary>,
      );
      expect(captureException).not.toHaveBeenCalled();
    });
  });
});
