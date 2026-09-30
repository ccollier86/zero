'use client';

import * as React from 'react';
import type { AuthApiKeyIssueInput } from '../../frontend/client/auth-api-key-types';
import {
  authApiKeyAuthorizationPhase,
  useAuthApiKeys,
} from '../../frontend/client/auth-api-key-hooks';
import { useAuth, useAuthConfig } from '../../frontend/client/auth-hooks';
import { useAuthorization } from '../../frontend/client/authorization-hooks';
import { useAuthorizationScopeBoundary } from '../../frontend/client/authorization-scope-hooks';
import { AlertDialog } from '#zero/components/animate-ui/components/radix/alert-dialog';
import { Button } from '#zero/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#zero/components/ui/card';
import { cn } from '#zero/lib/utils';
import { AuthConfigLoadState } from './auth-config-load-state';
import {
  ApiKeyConfirmationDialog,
  ApiKeyIssueForm,
  ApiKeyList,
  type PendingApiKeyConfirmation,
} from './api-key-management-parts';
import {
  apiKeyManagementBoundaryTarget,
  apiKeyManagementCopy,
  apiKeyManagementHookOptions,
} from './api-key-management-policy';
import {
  apiKeySecretReducer,
  ApiKeySecretReveal,
} from './api-key-secret-reveal';
import type {
  ApiKeyManagementProps,
  ApplicationUserApiKeyManagementProps,
  PlatformApiKeyManagementProps,
  SelfApiKeyManagementProps,
  TenantMemberApiKeyManagementProps,
} from './api-key-management-types';

/** Optional mode-aware Guardian API-key control. It is never mounted automatically. */
export function ApiKeyManagement(props: ApiKeyManagementProps) {
  const auth = useAuth();
  const authorization = useAuthorization();
  const authorizationBoundary = useAuthorizationScopeBoundary();
  const boundary = JSON.stringify([
    authorizationBoundary.key,
    authApiKeyAuthorizationPhase(authorization.status),
    authorization.authorization?.revision ?? null,
    auth.user?.userId ?? null,
    auth.activeTenant?.tenantId ?? null,
    apiKeyManagementBoundaryTarget(props),
  ]);
  return (
    <ApiKeyManagementScope
      key={boundary}
      props={props}
      isAuthenticated={auth.isAuthenticated}
      isAuthLoading={auth.isLoading}
    />
  );
}

function ApiKeyManagementScope({
  props,
  isAuthenticated,
  isAuthLoading,
}: {
  props: ApiKeyManagementProps;
  isAuthenticated: boolean;
  isAuthLoading: boolean;
}) {
  const config = useAuthConfig();
  const terminology = {
    singular: config.config?.tenancy?.terminology?.singular.trim() || 'organization',
    plural: config.config?.tenancy?.terminology?.plural.trim() || 'organizations',
  };
  const copy = apiKeyManagementCopy(props, terminology);
  const management = useAuthApiKeys(apiKeyManagementHookOptions(props));
  const [confirmation, setConfirmation] = React.useState<PendingApiKeyConfirmation | null>(null);
  const [issued, dispatchSecret] = React.useReducer(apiKeySecretReducer, null);
  const [localError, setLocalError] = React.useState<string | null>(null);
  const [announcement, setAnnouncement] = React.useState('');
  const confirmationTrigger = React.useRef<HTMLButtonElement | null>(null);
  const headingRef = React.useRef<HTMLHeadingElement | null>(null);
  const completedAction = React.useRef<'rotate' | 'revoke' | null>(null);
  const mounted = React.useRef(true);

  React.useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const focusHeading = React.useCallback(() => {
    if (typeof window === 'undefined'
      || typeof window.requestAnimationFrame !== 'function') {
      headingRef.current?.focus();
      return;
    }
    window.requestAnimationFrame(() => headingRef.current?.focus());
  }, []);

  React.useEffect(() => {
    if (issued !== null && (!management.isAvailable || management.isDenied)) {
      dispatchSecret({ type: 'dismiss' });
      focusHeading();
    }
  }, [focusHeading, issued, management.isAvailable, management.isDenied]);

  async function issue(input: AuthApiKeyIssueInput): Promise<boolean> {
    setLocalError(null);
    setAnnouncement('');
    try {
      const result = await management.issue(input);
      if (!mounted.current) return false;
      dispatchSecret({ type: 'show', issued: result });
      setAnnouncement(`Issued API key ${result.apiKey.label}. Copy its secret now.`);
      return true;
    } catch (cause) {
      if (mounted.current) setLocalError(errorMessage(cause));
      return false;
    }
  }

  async function confirmAction() {
    if (!confirmation) return;
    const pending = confirmation;
    setLocalError(null);
    setAnnouncement('');
    try {
      if (pending.action === 'rotate') {
        const result = await management.rotate(pending.apiKey.keyId, {
          label: pending.apiKey.label,
        });
        if (!mounted.current) return;
        dispatchSecret({ type: 'show', issued: result });
        setAnnouncement(`Rotated API key ${pending.apiKey.label}. Copy its new secret now.`);
      } else {
        await management.revoke(pending.apiKey.keyId);
        if (!mounted.current) return;
        setAnnouncement(`Revoked API key ${pending.apiKey.label}.`);
      }
      completedAction.current = pending.action;
      setConfirmation(null);
    } catch (cause) {
      if (mounted.current) setLocalError(errorMessage(cause));
    }
  }

  const error = localError ?? management.error;
  const actionsDisabled = issued !== null || error !== null;
  const apiKeysEnabled = config.config?.apiKeys?.enabled === true;
  const initialListError = apiKeysEnabled
    && isAuthenticated
    && management.isAvailable
    && !management.isLoading
    && !management.isDenied
    && management.page === null
    && management.error !== null;
  const initialListLoading = management.isLoading && management.page === null;

  return (
    <Card
      className={cn('overflow-hidden', props.className)}
      aria-busy={management.isLoading || management.isLoadingMore || management.isMutating}
    >
      <CardHeader className="border-b border-border/70">
        <CardTitle>
          <h2 ref={headingRef} tabIndex={-1}>{copy.title}</h2>
        </CardTitle>
        <CardDescription>{copy.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 pt-5">
        {issued && management.isAvailable && !management.isDenied && (
          <ApiKeySecretReveal
            issued={issued}
            onDismiss={() => {
              dispatchSecret({ type: 'dismiss' });
              setAnnouncement('The one-time API key secret was dismissed and cleared from this page.');
              focusHeading();
            }}
          />
        )}

        {management.canIssue && !management.isDenied && (
          <ApiKeyIssueForm
            busy={management.isMutating}
            disabled={actionsDisabled
              || management.isLoading
              || management.isLoadingMore}
            defaultTTL={config.config?.apiKeys?.defaultTTL ?? 'the configured lifetime'}
            maxTTL={config.config?.apiKeys?.maxTTL ?? 'the configured limit'}
            onIssue={issue}
          />
        )}
        {issued !== null && (
          <p role="status" className="text-xs text-muted-foreground">
            Dismiss the one-time secret before managing another API key.
          </p>
        )}

        {!confirmation && error && !initialListError
          && !management.isDenied && management.isAvailable && (
          <div role="alert" className="flex flex-col gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive sm:flex-row sm:items-center sm:justify-between">
            <span className="min-w-0">{error}</span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={management.isLoading || management.isMutating}
              onClick={() => {
                if (localError !== null) {
                  setLocalError(null);
                  return;
                }
                setLocalError(null);
                management.reload();
              }}
            >
              {localError !== null ? 'Dismiss' : 'Retry'}
            </Button>
          </div>
        )}

        <AlertDialog
          open={confirmation !== null}
          onOpenChange={(open) => {
            if (!open && !management.isMutating) {
              setConfirmation(null);
              setLocalError(null);
            }
          }}
        >
          {confirmation && (
            <ApiKeyConfirmationDialog
              confirmation={confirmation}
              busy={management.isMutating}
              error={localError}
              onConfirm={() => void confirmAction()}
              onCloseAutoFocus={(event) => {
                event.preventDefault();
                const action = completedAction.current;
                completedAction.current = null;
                if (action === 'rotate') return;
                if (action === 'revoke') {
                  headingRef.current?.focus();
                } else if (confirmationTrigger.current?.isConnected) {
                  confirmationTrigger.current.focus();
                } else {
                  headingRef.current?.focus();
                }
                confirmationTrigger.current = null;
              }}
            />
          )}
        </AlertDialog>

        {config.config === null ? (
          <AuthConfigLoadState
            state={config}
            loadingMessage="Loading API key configuration…"
            unavailableMessage="API key configuration could not be loaded."
            showUnknown
            className="m-0"
          />
        ) : !apiKeysEnabled ? (
          <ApiKeyState message="API key management is not enabled for this application." />
        ) : isAuthLoading ? (
          <ApiKeyState message="Restoring your authenticated session…" role="status" />
        ) : initialListLoading ? (
          <ApiKeyState message="Loading API keys…" role="status" />
        ) : !isAuthenticated ? (
          <ApiKeyState message="Sign in to manage API keys." />
        ) : !management.isAvailable ? (
          <ApiKeyState message="API key management is not available for this view." />
        ) : management.isDenied ? (
          <ApiKeyState
            message="You do not have permission to manage API keys in this view."
            role="alert"
          />
        ) : initialListError ? (
          <div
            role="alert"
            className="space-y-3 rounded-md border border-destructive/30 bg-destructive/5 p-8 text-center text-sm text-destructive"
          >
            <p>{management.error}</p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={management.isLoading || management.isMutating}
              onClick={management.reload}
            >
              Retry
            </Button>
          </div>
        ) : management.apiKeys.length === 0 ? (
          <ApiKeyState message={copy.empty} />
        ) : (
          <ApiKeyList
            apiKeys={management.apiKeys}
            busy={management.isLoading
              || management.isLoadingMore
              || management.isMutating}
            canRotate={management.canRotate}
            canRevoke={management.canRevoke}
            actionsDisabled={actionsDisabled}
            tenantSingular={terminology.singular}
            onConfirm={(action, apiKey, trigger) => {
              confirmationTrigger.current = trigger;
              completedAction.current = null;
              setLocalError(null);
              setConfirmation({ action, apiKey });
            }}
          />
        )}

        {apiKeysEnabled
          && isAuthenticated
          && management.isAvailable
          && !management.isDenied
          && !initialListError
          && management.page?.hasMore && (
          <div className="flex justify-center">
            <Button
              type="button"
              variant="outline"
              disabled={management.isLoading
                || management.isLoadingMore
                || management.isMutating
                || actionsDisabled}
              onClick={() => void management.loadMore()}
            >
              {management.isLoadingMore ? 'Loading…' : 'Load more'}
            </Button>
          </div>
        )}
        <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {announcement}
        </p>
      </CardContent>
    </Card>
  );
}

export function SelfApiKeyManagement(props: SelfApiKeyManagementProps) {
  return <ApiKeyManagement {...props} mode="self" />;
}

export function ApplicationUserApiKeyManagement(
  props: ApplicationUserApiKeyManagementProps,
) {
  return <ApiKeyManagement {...props} mode="application-admin" />;
}

export function TenantMemberApiKeyManagement(props: TenantMemberApiKeyManagementProps) {
  return <ApiKeyManagement {...props} mode="tenant-admin" />;
}

export function PlatformApiKeyManagement(props: PlatformApiKeyManagementProps) {
  return <ApiKeyManagement {...props} mode="platform-admin" />;
}

function ApiKeyState({
  message,
  role,
}: {
  message: string;
  role?: 'status' | 'alert';
}) {
  return (
    <div
      className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground"
      role={role}
      aria-live={role === 'status' ? 'polite' : undefined}
    >
      {message}
    </div>
  );
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : 'API key management request failed.';
}
