import { captureException as defaultCaptureException } from '../observability.js';
import { normalizeRoute } from './payload.js';

const MAX_COMPONENT_LENGTH = 100;

function ignoreReportingFailure() {
  // Reporting failures are swallowed on purpose: they must never break the error fallback.
}

const isIdentifierPart = (c) => /[\w$.]/.test(c);

// Name at the start of one stack frame ("Name (...)"), or null when it is not a bare identifier
// (e.g. a script URL).
function readFrameName(text) {
  let end = 0;
  while (end < text.length && isIdentifierPart(text[end])) end += 1;
  const next = text[end];
  const endsName = next === undefined || /\s/.test(next);
  return endsName && /^[A-Za-z_$]/.test(text) ? text.slice(0, end) : null;
}

// First frame of React's component stack: "    at Name (...)" (V8) or "    in Name" (older React).
function extractComponentName(componentStack) {
  for (const line of String(componentStack || '').split('\n')) {
    const frame = line.trim();
    if (frame.startsWith('at ') || frame.startsWith('in ')) {
      const name = readFrameName(frame.slice(3).trimStart());
      if (name) return name.slice(0, MAX_COMPONENT_LENGTH);
    }
  }
  return null;
}

// ETP-6442 — reports a render error with the failing component and the normalized route (no ids,
// query or fragment). The full component stack is deliberately not sent: it is not in the
// property allowlist. Never throws.
export function reportRenderError(error, info, captureException = defaultCaptureException) {
  try {
    const details = {
      route: normalizeRoute(window.location.pathname),
      errorClass: error?.name,
    };
    const component = extractComponentName(info?.componentStack);
    if (component) details.component = component;
    Promise.resolve(captureException(error, details)).catch(ignoreReportingFailure);
  } catch {
    // Reporting must never break the fallback.
  }
}
