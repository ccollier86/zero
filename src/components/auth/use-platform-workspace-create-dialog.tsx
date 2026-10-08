'use client';

import * as React from 'react';
import type {
  AuthPlatformTenantCreateParams,
  AuthPlatformTenantCreateResult,
} from '../../frontend/client/auth-platform-administration-types';
import { modals } from '../../modals';
import { PlatformWorkspaceCreateForm } from './platform-workspace-create-form';
import { emitFrontendCode } from '../../frontend/client/observability';
import { OBS_CODES } from '../../observability/codes';

/** Open the focused create-workspace dialog used by the directory primary action. */
export function usePlatformWorkspaceCreateDialog(params: {
  singular: string;
  create: (input: AuthPlatformTenantCreateParams) => Promise<AuthPlatformTenantCreateResult>;
  onCreated: (result: AuthPlatformTenantCreateResult) => void | Promise<void>;
  onOpenChange?: (open: boolean) => void;
}) {
  const mounted = React.useRef(true), ownedIds = React.useRef(new Set<string>());
  React.useEffect(() => { mounted.current = true; return () => {
    mounted.current = false; modals.disposeHost([...ownedIds.current]); ownedIds.current.clear();
  }; }, []);
  return React.useCallback(() => {
    if (!mounted.current) return;
    const handle = modals.show<AuthPlatformTenantCreateResult>({
      title: `Create customer ${params.singular}`,
      description: `Create one customer ${params.singular} and assign an existing account as its initial owner.`,
      size: 'lg',
      onClose: () => params.onOpenChange?.(false),
      actions: [{ id: 'cancel', label: 'Cancel', role: 'cancel' },
        { id: 'create', label: `Create ${params.singular}`, variant: 'primary', submit: true }],
      body: context => (
        <PlatformWorkspaceCreateForm
          singular={params.singular}
          modalContext={context} formId={`${context.id}-workspace`} showSubmit={false}
          onSubmit={async (input) => {
            if (context.signal.aborted) throw new Error('Retired workspace create form.');
            const result = await params.create(input);
            return result;
          }}
        />
      ),
    });
    ownedIds.current.add(handle.id);
    const reportOpenFailure = () => emitFrontendCode(OBS_CODES.FRONTEND_MODAL_CALLBACK_FAILED, { metadata: { surface: 'workspace-create', stage: 'open-notification' } });
    try { void Promise.resolve(params.onOpenChange?.(true)).catch(reportOpenFailure); }
    catch { emitFrontendCode(OBS_CODES.FRONTEND_MODAL_CALLBACK_FAILED, { metadata: { surface: 'workspace-create', stage: 'open-notification' } }); }
    void handle.result.then(async result => {
      ownedIds.current.delete(handle.id);
      if (!mounted.current || result.kind !== 'accepted') return;
      try { await params.onCreated(result.value); }
      catch { emitFrontendCode(OBS_CODES.FRONTEND_MODAL_CALLBACK_FAILED, { metadata: { surface: 'workspace-create', stage: 'accepted-notification' } }); }
    });
  }, [params.create, params.onCreated, params.onOpenChange, params.singular]);
}
