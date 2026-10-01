'use client';

import * as React from 'react';
import type {
  AuthPlatformTenantCreateParams,
  AuthPlatformTenantCreateResult,
} from '../../frontend/client/auth-platform-administration-types';
import { modals } from '../../modals';
import { PlatformWorkspaceCreateForm } from './platform-workspace-create-form';

/** Open the focused create-workspace dialog used by the directory primary action. */
export function usePlatformWorkspaceCreateDialog(params: {
  singular: string;
  create: (input: AuthPlatformTenantCreateParams) => Promise<AuthPlatformTenantCreateResult>;
  onCreated: (result: AuthPlatformTenantCreateResult) => void;
  onOpenChange?: (open: boolean) => void;
}) {
  return React.useCallback(() => {
    let modalId = '';
    params.onOpenChange?.(true);
    modalId = modals.open({
      title: `Create customer ${params.singular}`,
      size: 'lg',
      onClose: () => params.onOpenChange?.(false),
      content: (
        <PlatformWorkspaceCreateForm
          singular={params.singular}
          onSubmit={async (input) => {
            const result = await params.create(input);
            params.onCreated(result);
            modals.close(modalId);
          }}
        />
      ),
    });
  }, [params.create, params.onCreated, params.onOpenChange, params.singular]);
}
