import { Component } from 'react';
import { useUI } from '@/i18n';
import { isChunkLoadError } from '@/lib/lazyWithReload.js';
import { captureException } from '@/lib/observability.js';

function ChunkErrorFallback() {
  const ui = useUI();
  return (
    <div className="p-8 text-muted-foreground" role="alert" data-testid="RouteChunkErrorBoundary__fallback">
      <p data-testid="RouteChunkErrorBoundary__message">{ui('routeLoadFailed')}</p>
      <button
        type="button"
        className="mt-4 rounded-md border px-3 py-1.5 text-sm"
        onClick={() => window.location.reload()}
        data-testid="RouteChunkErrorBoundary__reload"
      >
        {ui('routeLoadReload')}
      </button>
    </div>
  );
}

export default class RouteChunkErrorBoundary extends Component {
  state = { failed: false, error: null };

  static getDerivedStateFromError(error) {
    return { failed: true, error };
  }

  componentDidUpdate(prevProps) {
    if (this.state.failed && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ failed: false, error: null });
    }
  }

  componentDidCatch(error) {
    try {
      Promise.resolve(captureException(error, { source: 'RouteChunkErrorBoundary' })).catch(() => {});
    } catch {
      // Reporting must never break the fallback.
    }
  }

  render() {
    // Only chunk failures get this fallback; any other crash goes to the next boundary up.
    if (this.state.failed && !isChunkLoadError(this.state.error)) throw this.state.error;
    if (this.state.failed) return <ChunkErrorFallback />;
    return this.props.children;
  }
}
