import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuthOptional } from '@etendo-ai/app-shell-core/auth';
import { page } from '../observability.js';
import { resolveFeature as defaultResolveFeature } from '../featureCatalog.js';
import { enterFeature } from './featureUsage.js';

export function ObservabilityRouteTracker({
  trackPage = page,
  resolveFeature = defaultResolveFeature,
  onFeature = enterFeature,
}) {
  const location = useLocation();
  const lastPathRef = useRef(null);
  const auth = useAuthOptional();
  // A direct URL renders before the session resolves: re-evaluate once it does, so the pending open is sent.
  const identity = `${auth?.username ?? ''}|${auth?.clientId ?? ''}`;

  useEffect(() => {
    const currentPath = location.pathname || '/';
    if (lastPathRef.current === currentPath) return;
    lastPathRef.current = currentPath;
    trackPage(currentPath);
  }, [location.pathname, trackPage]);

  useEffect(() => {
    // A query change alone (report id, category) can switch the feature inside one pathname.
    onFeature(resolveFeature(location.pathname || '/', location.search || ''));
  }, [location.pathname, location.search, identity, resolveFeature, onFeature]);

  return null;
}
