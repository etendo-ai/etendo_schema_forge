// @covers tools/app-shell/src/components/RouteChunkErrorBoundary.jsx
import { Component } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import RouteChunkErrorBoundary from '../RouteChunkErrorBoundary.jsx';
import { captureException } from '@/lib/observability.js';

vi.mock('@/lib/observability.js', () => ({ captureException: vi.fn() }));

const boom = new TypeError('Failed to fetch dynamically imported module: /assets/x.js');
function Boom() {
  throw boom;
}

describe('RouteChunkErrorBoundary', () => {
  it('lets a non-chunk render error reach the next boundary up', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const crash = new Error('render exploded');
    function Crash() { throw crash; }
    class Outer extends Component {
      state = { error: null };
      static getDerivedStateFromError(error) { return { error }; }
      render() { return this.state.error ? <p data-testid="outer">{this.state.error.message}</p> : this.props.children; }
    }
    render(<Outer><RouteChunkErrorBoundary><Crash /></RouteChunkErrorBoundary></Outer>);
    expect(screen.getByTestId('outer').textContent).toBe('render exploded');
    expect(screen.queryByTestId('RouteChunkErrorBoundary__fallback')).toBeNull();
  });

  const originalLocation = window.location;

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
    window.sessionStorage.clear();
  });

  it('shows the message and a reload button when a child throws', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const reload = vi.fn();
    Object.defineProperty(window, 'location', { configurable: true, value: { ...originalLocation, reload } });
    render(<RouteChunkErrorBoundary><Boom /></RouteChunkErrorBoundary>);
    expect(screen.getByTestId('RouteChunkErrorBoundary__message').textContent).toBeTruthy();
    fireEvent.click(screen.getByTestId('RouteChunkErrorBoundary__reload'));
    expect(reload).toHaveBeenCalled();
  });

  it('reports the error', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<RouteChunkErrorBoundary><Boom /></RouteChunkErrorBoundary>);
    expect(captureException).toHaveBeenCalledWith(boom, { source: 'RouteChunkErrorBoundary' });
  });

  it.each([
    ['throws', () => { throw new Error('report failed'); }],
    ['rejects', () => Promise.reject(new Error('report failed'))],
  ])('still renders the fallback when captureException %s', async (_name, impl) => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    captureException.mockImplementationOnce(impl);
    render(<RouteChunkErrorBoundary><Boom /></RouteChunkErrorBoundary>);
    expect(screen.getByTestId('RouteChunkErrorBoundary__fallback')).toBeTruthy();
  });

  it('resets when resetKey changes', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { rerender } = render(<RouteChunkErrorBoundary resetKey="a"><Boom /></RouteChunkErrorBoundary>);
    expect(screen.getByTestId('RouteChunkErrorBoundary__fallback')).toBeTruthy();
    rerender(<RouteChunkErrorBoundary resetKey="b"><p>healthy</p></RouteChunkErrorBoundary>);
    expect(screen.getByText('healthy')).toBeTruthy();
  });

  it('renders children when nothing throws', () => {
    render(<RouteChunkErrorBoundary><p>fine</p></RouteChunkErrorBoundary>);
    expect(screen.getByText('fine')).toBeTruthy();
  });
});
