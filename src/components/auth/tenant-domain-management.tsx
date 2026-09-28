'use client';

import * as React from 'react';
import type {
  AuthTenantDomainClaim,
  AuthTenantDomainReleaseResult,
  AuthTenantDomainRequestRole,
} from '../../frontend/client/auth-domain-types';
import { useAuth, useAuthConfig } from '../../frontend/client/auth-hooks';
import { useTenantDomainAdministration } from '../../frontend/client/domain-onboarding-hooks';
import { Badge } from '#zero/components/ui/badge';
import { Button } from '#zero/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '#zero/components/ui/card';
import { Checkbox } from '#zero/components/ui/checkbox';
import { Input } from '#zero/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#zero/components/ui/select';
import { cn } from '#zero/lib/utils';
import { writeAuthClipboardText } from './auth-clipboard';

export interface TenantDomainManagementProps {
  className?: string;
  title?: string;
  description?: string;
}

/** Active-tenant exact-domain claim and request-onboarding controls. */
export function TenantDomainManagement(props: TenantDomainManagementProps) {
  const auth = useAuth();
  const config = useAuthConfig().config;
  const enabled = config?.tenancy?.onboarding?.verifiedDomains?.enabled === true;
  if (!enabled) return null;
  const tenantSingular = config?.tenancy?.terminology?.singular ?? 'organization';
  const tenantPlural = config?.tenancy?.terminology?.plural ?? 'organizations';
  const boundary = JSON.stringify([
    auth.user?.userId ?? null,
    auth.activeTenant?.tenantId ?? null,
  ]);
  return (
    <TenantDomainManagementScope
      key={boundary}
      {...props}
      tenantSingular={tenantSingular}
      tenantPlural={tenantPlural}
      title={props.title ?? `Verified ${tenantSingular} domains`}
      description={props.description
        ?? `Verify an exact DNS domain, then let proven coworkers request access to this ${tenantSingular}.`}
    />
  );
}

function TenantDomainManagementScope({
  className,
  title,
  description,
  tenantSingular,
  tenantPlural,
}: TenantDomainManagementProps & { tenantSingular: string; tenantPlural: string }) {
  const domains = useTenantDomainAdministration();
  const [domain, setDomain] = React.useState('');
  const [localError, setLocalError] = React.useState<string | null>(null);
  const [releaseNotice, setReleaseNotice] = React.useState<string | null>(null);
  const [copiedChallengeField, setCopiedChallengeField] = React.useState<
    'name' | 'value' | null
  >(null);
  const challengeHeadingId = `${React.useId()}-dns-challenge`;
  const capabilities = domains.administration?.actor.capabilities;

  React.useEffect(() => {
    setCopiedChallengeField(null);
  }, [domains.challenge?.name, domains.challenge?.value]);

  async function createClaim(event: React.FormEvent) {
    event.preventDefault();
    const value = domain.trim();
    if (!value) return;
    setLocalError(null);
    try {
      await domains.createClaim(value);
      setDomain('');
    } catch (cause) {
      setLocalError(errorMessage(cause));
    }
  }

  async function mutate(operation: () => Promise<unknown>) {
    setLocalError(null);
    try {
      await operation();
    } catch (cause) {
      setLocalError(errorMessage(cause));
    }
  }

  async function releaseClaim(
    claimId: string,
    confirmDomain: string,
  ): Promise<AuthTenantDomainReleaseResult['release']> {
    setLocalError(null);
    setReleaseNotice(null);
    try {
      const release = await domains.releaseClaim(claimId, confirmDomain);
      setReleaseNotice(
        `${release.domain} was released. Other ${tenantPlural} cannot claim it for seven days.`,
      );
      return release;
    } catch (cause) {
      setLocalError(errorMessage(cause));
      throw cause;
    }
  }

  async function copy(value: string, field: 'name' | 'value') {
    setLocalError(null);
    setCopiedChallengeField(null);
    try {
      await writeAuthClipboardText(value);
      setCopiedChallengeField(field);
    } catch (cause) {
      setLocalError(errorMessage(cause));
    }
  }

  return (
    <Card
      className={cn('overflow-hidden', className)}
      aria-busy={domains.isLoading || domains.isMutating}
    >
      <CardHeader className="gap-3 border-b border-border/70">
        <div>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </div>
        {capabilities?.canCreateDomains && (
          <form className="flex flex-col gap-2 sm:flex-row" onSubmit={createClaim}>
            <Input
              value={domain}
              onChange={(event) => setDomain(event.target.value)}
              aria-label="Exact company domain"
              placeholder="your-company.com"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              disabled={domains.isMutating}
              required
            />
            <Button type="submit" disabled={domains.isMutating || !domain.trim()}>
              Add domain
            </Button>
          </form>
        )}
      </CardHeader>
      <CardContent className="space-y-5 pt-5">
        {(domains.error || localError) && (
          <div role="alert" className="flex flex-col gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive sm:flex-row sm:items-center sm:justify-between">
            <span className="min-w-0">{localError ?? domains.error}</span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={domains.isLoading || domains.isMutating}
              onClick={() => {
                setLocalError(null);
                domains.reload();
              }}
            >
              Retry
            </Button>
          </div>
        )}

        {releaseNotice && (
          <div role="status" aria-live="polite" className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
            {releaseNotice}
          </div>
        )}

        {domains.challenge && (
          <section aria-labelledby={challengeHeadingId} className="rounded-md border border-warning/40 bg-warning/10 p-4 text-warning-foreground dark:border-warning/50 dark:bg-warning/15 dark:text-warning">
            <h3 id={challengeHeadingId} className="font-semibold">
              Copy this DNS TXT challenge now
            </h3>
            <p className="mt-1 text-sm">
              This plaintext value is shown only once and is cleared when you leave this {tenantSingular}.
            </p>
            <DnsCopyRow
              label="TXT record name"
              value={domains.challenge.name}
              copied={copiedChallengeField === 'name'}
              onCopy={() => void copy(domains.challenge!.name, 'name')}
            />
            <DnsCopyRow
              label="TXT record value"
              value={domains.challenge.value}
              copied={copiedChallengeField === 'value'}
              onCopy={() => void copy(domains.challenge!.value, 'value')}
            />
            <div className="mt-3 flex flex-wrap gap-2">
              {domains.challengeClaimId && capabilities?.canVerifyDomains && (
                <Button
                  type="button"
                  size="sm"
                  onClick={() => void mutate(() => domains.verifyClaim(
                    domains.challengeClaimId!,
                  ))}
                  disabled={domains.isMutating}
                >
                  Check DNS
                </Button>
              )}
              <Button type="button" size="sm" variant="ghost" onClick={domains.dismissChallenge}>
                Dismiss
              </Button>
            </div>
          </section>
        )}

        {domains.isLoading ? (
          <div role="status" aria-live="polite" className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
            Loading verified domains…
          </div>
        ) : !domains.administration ? (
          <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
            Verified-domain controls require active {tenantSingular} access and domain permissions.
          </div>
        ) : !capabilities?.canReadDomains ? (
          <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
            You do not have permission to view verified domains.
          </div>
        ) : domains.claims.length === 0 ? (
          <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
            No domains have been claimed for this {tenantSingular}.
          </div>
        ) : (
          <div className="space-y-3">
            {domains.claims.map((claim) => (
              <DomainClaimCard
                key={claim.claimId}
                claim={claim}
                roles={domains.administration!.requestRoles}
                canVerify={capabilities.canVerifyDomains}
                canManagePolicy={capabilities.canManagePolicy}
                canRelease={capabilities.canReleaseDomains}
                tenantSingular={tenantSingular}
                busy={domains.isMutating}
                onRotate={() => void mutate(() => domains.issueChallenge(claim.claimId))}
                onVerify={() => void mutate(() => domains.verifyClaim(claim.claimId))}
                onPolicy={(update) => void mutate(() => domains.updatePolicy(
                  claim.claimId,
                  update,
                ))}
                onRelease={(confirmDomain) => releaseClaim(claim.claimId, confirmDomain)}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function DnsCopyRow({
  label,
  value,
  copied,
  onCopy,
}: { label: string; value: string; copied: boolean; onCopy(): void }) {
  return (
    <div className="mt-3 grid gap-1.5 sm:grid-cols-[1fr_auto]">
      <Input readOnly value={value} aria-label={label} />
      <Button type="button" size="sm" variant="outline" onClick={onCopy}>
        {copied ? 'Copied' : `Copy ${label.toLowerCase()}`}
      </Button>
      {copied && (
        <span role="status" aria-live="polite" className="sr-only">
          {label} copied
        </span>
      )}
    </div>
  );
}

function DomainClaimCard({
  claim,
  roles,
  canVerify,
  canManagePolicy,
  canRelease,
  tenantSingular,
  busy,
  onRotate,
  onVerify,
  onPolicy,
  onRelease,
}: {
  claim: AuthTenantDomainClaim;
  roles: readonly AuthTenantDomainRequestRole[];
  canVerify: boolean;
  canManagePolicy: boolean;
  canRelease: boolean;
  tenantSingular: string;
  busy: boolean;
  onRotate(): void;
  onVerify(): void;
  onPolicy(update: { enabled: boolean; requestRoleKey: string | null }): void;
  onRelease(confirmDomain: string): Promise<AuthTenantDomainReleaseResult['release']>;
}) {
  const [enabled, setEnabled] = React.useState(claim.policy.enabled);
  const [roleKey, setRoleKey] = React.useState(claim.policy.requestRoleKey ?? '');
  const [releaseOpen, setReleaseOpen] = React.useState(false);
  const [releaseConfirmation, setReleaseConfirmation] = React.useState('');
  const cardId = React.useId();
  const headingId = `${cardId}-heading`;
  const releasePanelId = `${cardId}-release-panel`;
  const releaseDescriptionId = `${cardId}-release-warning`;
  const releaseInputId = `${cardId}-release-input`;
  const releaseTriggerRef = React.useRef<HTMLButtonElement | null>(null);
  const releaseInputRef = React.useRef<HTMLInputElement | null>(null);
  const restoreReleaseFocus = React.useRef(false);

  React.useEffect(() => {
    setEnabled(claim.policy.enabled);
    setRoleKey(claim.policy.requestRoleKey ?? '');
  }, [claim.policy.enabled, claim.policy.requestRoleKey, claim.policy.revision]);

  React.useEffect(() => {
    if (releaseOpen) {
      releaseInputRef.current?.focus();
      return;
    }
    if (restoreReleaseFocus.current && releaseTriggerRef.current?.isConnected) {
      restoreReleaseFocus.current = false;
      releaseTriggerRef.current.focus();
    }
  }, [releaseOpen]);

  const policyChanged = enabled !== claim.policy.enabled
    || (roleKey || null) !== claim.policy.requestRoleKey;

  function closeRelease() {
    restoreReleaseFocus.current = true;
    setReleaseConfirmation('');
    setReleaseOpen(false);
  }

  async function release() {
    if (!isExactDomainReleaseConfirmation(claim.domain, releaseConfirmation)) return;
    await onRelease(releaseConfirmation);
  }

  return (
    <section className="rounded-md border p-4" aria-labelledby={headingId} aria-busy={busy}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 id={headingId} className="font-medium">{claim.domain}</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Exact-domain DNS TXT verification
          </p>
        </div>
        <Badge variant="outline">{statusLabel(claim.status)}</Badge>
      </div>

      {canVerify && claim.status !== 'verified' && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button type="button" size="sm" onClick={onVerify} disabled={busy}>
            Check DNS
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={onRotate} disabled={busy}>
            New challenge
          </Button>
        </div>
      )}

      {canManagePolicy && (claim.status === 'verified' || claim.status === 'grace') && (
        <div className="mt-4 grid gap-3 rounded-md bg-muted/30 p-3">
          <label className="flex items-start gap-2 text-sm">
            <Checkbox
              checked={enabled}
              onCheckedChange={(value) => setEnabled(value === true)}
              disabled={busy}
            />
            <span>
              <span className="block font-medium">Allow proven coworkers to request access</span>
              <span className="block text-xs text-muted-foreground">
                Requests still require review. This never joins a user automatically.
              </span>
            </span>
          </label>
          <Select value={roleKey} onValueChange={setRoleKey} disabled={busy || !enabled}>
            <SelectTrigger aria-label={`Requested role for ${claim.domain}`}>
              <SelectValue placeholder="Choose request role" />
            </SelectTrigger>
            <SelectContent>
              {roles.map((role) => (
                <SelectItem key={role.key} value={role.key}>{role.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            size="sm"
            className="justify-self-start"
            disabled={busy || !policyChanged || (enabled && !roleKey)}
            onClick={() => onPolicy({ enabled, requestRoleKey: roleKey || null })}
          >
            Save request policy
          </Button>
        </div>
      )}

      {canRelease && (
        <div className="mt-4 border-t border-border/70 pt-4">
          {!releaseOpen ? (
            <Button
              ref={releaseTriggerRef}
              type="button"
              size="sm"
              variant="destructive"
              disabled={busy}
              aria-expanded={false}
              aria-controls={releasePanelId}
              onClick={() => {
                setReleaseConfirmation('');
                setReleaseOpen(true);
              }}
            >
              Release domain
            </Button>
          ) : (
            <div
              id={releasePanelId}
              role="region"
              aria-labelledby={`${releasePanelId}-heading`}
              className="grid gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-3"
              onKeyDown={(event) => {
                if (event.key === 'Escape' && !busy) {
                  event.preventDefault();
                  event.stopPropagation();
                  closeRelease();
                }
              }}
            >
              <div>
                <h4 id={`${releasePanelId}-heading`} className="font-medium text-destructive">Release {claim.domain}?</h4>
                <p id={releaseDescriptionId} className="mt-1 text-sm text-muted-foreground">
                  This disables domain onboarding, invalidates outstanding admission attempts,
                  and cancels pending domain-derived requests. Audit and admission history is retained.
                  Another {tenantSingular} cannot claim the domain for seven days. Re-adding it
                  always requires a fresh DNS challenge.
                </p>
              </div>
              <label className="grid gap-1.5 text-sm" htmlFor={releaseInputId}>
                <span>
                  Type <strong>{claim.domain}</strong> to confirm
                </span>
                <Input
                  ref={releaseInputRef}
                  id={releaseInputId}
                  value={releaseConfirmation}
                  onChange={(event) => setReleaseConfirmation(event.target.value)}
                  aria-describedby={releaseDescriptionId}
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  disabled={busy}
                />
              </label>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  disabled={busy || !isExactDomainReleaseConfirmation(
                    claim.domain,
                    releaseConfirmation,
                  )}
                  onClick={() => void release().catch(() => undefined)}
                >
                  Confirm domain release
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={closeRelease}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/** Release confirmation deliberately performs no trim/case/IDN normalization. */
export function isExactDomainReleaseConfirmation(
  normalizedDomain: string,
  confirmation: string,
): boolean {
  return confirmation === normalizedDomain;
}

function statusLabel(status: AuthTenantDomainClaim['status']): string {
  if (status === 'pending') return 'Pending DNS proof';
  if (status === 'verified') return 'Verified';
  if (status === 'grace') return 'Verification grace period';
  return 'Verification lost';
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : 'Verified-domain request failed';
}
