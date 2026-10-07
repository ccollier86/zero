'use client';

/** React lifetime wiring and code-only error presentation for one local action session. */
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { emitFrontendCode, FRONTEND_OBS_CODES } from '../../frontend/client/observability';
import { IntegrationSettingsActionSession } from './integration-settings-action-session';
import type { IntegrationSettingsErrorContext, IntegrationSettingsListProps } from './integration-settings-list.types';

export function useIntegrationSettingsAction() {
  const ref = useRef<IntegrationSettingsActionSession | null>(null);
  if (!ref.current) ref.current = new IntegrationSettingsActionSession();
  const session = ref.current;
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  useEffect(() => { session.activate(); return () => session.retire(); }, [session]);
  return { session, ...snapshot };
}

/** Do not send provider identifiers, contact data or arbitrary rejected error bodies to logs. */
export function reportIntegrationSettingsActionError(
  cause: unknown, context: IntegrationSettingsErrorContext,
  onError: IntegrationSettingsListProps['onActionError'],
): void {
  emitFrontendCode(FRONTEND_OBS_CODES.FRONTEND_MUTATION_FAILED, {
    metadata: { surface: 'integration-settings-list', stage: 'action' },
  });
  try { onError?.(cause, context); }
  catch {
    emitFrontendCode(FRONTEND_OBS_CODES.FRONTEND_MUTATION_FAILED, {
      metadata: { surface: 'integration-settings-list', stage: 'error-callback' },
    });
  }
}
