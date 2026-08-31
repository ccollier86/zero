'use client';

/**
 * use-storage-auth-config.ts
 *
 * Loads auth admin configuration for storage permission controls. This file
 * owns storage UI config loading only; auth routes and permission writes remain
 * behind the SDK and storage hooks.
 */

import * as React from 'react';
import { useClientMaybe } from '../../frontend/client/hooks';
import type { AuthAdminConfig } from '../../frontend/client/auth-client';

export interface UseStorageAuthConfigResult {
  config: AuthAdminConfig | null;
  loading: boolean;
  error: string | null;
}

/** Load admin auth config when storage needs property-aware controls. */
export function useStorageAuthConfig(enabled = true): UseStorageAuthConfigResult {
  const client = useClientMaybe();
  const [config, setConfig] = React.useState<AuthAdminConfig | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!enabled || !client) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    client.getAuthAdminConfig()
      .then((result) => {
        if (!cancelled) setConfig(result);
      })
      .catch((err) => {
        if (!cancelled) {
          setConfig(null);
          setError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [client, enabled]);

  return { config, loading, error };
}
