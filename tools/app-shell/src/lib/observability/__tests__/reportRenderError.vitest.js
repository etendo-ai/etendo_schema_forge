// @covers tools/app-shell/src/lib/observability/reportRenderError.js
import { reportRenderError } from '../reportRenderError.js';

vi.mock('../../observability.js', () => ({ captureException: vi.fn() }));

const STACK = '\n    at BrokenWidget (http://x/app.js:1:1)\n    at App (http://x/app.js:2:2)';

describe('reportRenderError', () => {
  let originalUrl;
  beforeEach(() => {
    originalUrl = window.location.pathname + window.location.search + window.location.hash;
    window.history.pushState({}, '', '/sales-order/0123456789ABCDEF0123456789ABCDEF?x=1#f');
  });
  afterEach(() => window.history.replaceState({}, '', originalUrl));

  it('sends component, normalized route and errorClass', () => {
    const capture = vi.fn();
    const error = new RangeError('boom');
    reportRenderError(error, { componentStack: STACK }, capture);
    expect(capture).toHaveBeenCalledWith(error, {
      component: 'BrokenWidget',
      route: '/sales-order/:recordId',
      errorClass: 'RangeError',
    });
  });

  it('reads the older "in Name" stack format and omits component when none is found', () => {
    const capture = vi.fn();
    reportRenderError(new Error('x'), { componentStack: '\n    in Legacy (at App.js:1)' }, capture);
    expect(capture.mock.calls[0][1].component).toBe('Legacy');
    reportRenderError(new Error('x'), { componentStack: '\n    at http://x/app.js:1:1' }, capture);
    expect(capture.mock.calls[1][1]).not.toHaveProperty('component');
    reportRenderError(new Error('x'), undefined, capture);
    expect(capture.mock.calls[2][1]).not.toHaveProperty('component');
  });

  it('caps the component name at 100 characters', () => {
    const capture = vi.fn();
    reportRenderError(new Error('x'), { componentStack: `\n    at ${'A'.repeat(300)} (x)` }, capture);
    expect(capture.mock.calls[0][1].component).toHaveLength(100);
  });

  it('never throws when the capture function throws or rejects', async () => {
    expect(() => reportRenderError(new Error('x'), {}, () => { throw new Error('no'); })).not.toThrow();
    expect(() => reportRenderError(new Error('x'), {}, () => Promise.reject(new Error('no')))).not.toThrow();
    await Promise.resolve();
  });
});
