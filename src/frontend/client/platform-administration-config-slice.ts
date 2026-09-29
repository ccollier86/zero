'use client';

import * as React from 'react';
import type { AuthPlatformAdministrationConfig } from './auth-platform-administration-types';
import {
  isCurrentPlatformRequest,
  platformAdministrationErrorMessage,
  type PlatformAdministrationSliceScope,
} from './platform-administration-slice-utils';

export interface PlatformAdministrationConfigSlice {
  config: AuthPlatformAdministrationConfig | null;
  hasCurrentConfig: boolean;
  isLoading: boolean;
  error: string | null;
  reload(): void;
}

/** Owns the protected administration-config request and its scope fence. */
export function usePlatformAdministrationConfigSlice(
  scope: PlatformAdministrationSliceScope,
): PlatformAdministrationConfigSlice {
  const [config, setConfig] = React.useState<AuthPlatformAdministrationConfig | null>(null);
  const [loadedBoundary, setLoadedBoundary] = React.useState(-1);
  const [loading, setLoading] = React.useState(scope.enabled);
  const [error, setError] = React.useState<string | null>(null);
  const [reloadRevision, setReloadRevision] = React.useState(0);
  const requestGeneration = React.useRef(0);
  const hasCurrentConfig = scope.enabled && loadedBoundary === scope.boundaryRevision;

  React.useEffect(() => {
    const generation = ++requestGeneration.current;
    setLoadedBoundary(scope.boundaryRevision);
    setConfig(null);
    setError(null);
    if (!scope.enabled || !scope.platform) {
      setLoading(false);
      return;
    }

    setLoading(true);
    void scope.platform.getConfig().then((nextConfig) => {
      if (isCurrentPlatformRequest(scope, requestGeneration, generation)) {
        setConfig(nextConfig);
      }
    }).catch((cause) => {
      if (isCurrentPlatformRequest(scope, requestGeneration, generation)) {
        setError(platformAdministrationErrorMessage(
          'platformAdministrationConfig',
          cause,
        ));
      }
    }).finally(() => {
      if (isCurrentPlatformRequest(scope, requestGeneration, generation)) {
        setLoading(false);
      }
    });
  }, [
    reloadRevision,
    scope.boundaryRevision,
    scope.enabled,
    scope.fence,
    scope.platform,
  ]);

  const reload = React.useCallback(() => {
    if (scope.fence.isCurrent(scope.boundaryRevision)) {
      setReloadRevision((value) => value + 1);
    }
  }, [scope.boundaryRevision, scope.fence]);

  return {
    config: hasCurrentConfig ? config : null,
    hasCurrentConfig,
    isLoading: scope.enabled && (!hasCurrentConfig || loading),
    error: hasCurrentConfig ? error : null,
    reload,
  };
}
