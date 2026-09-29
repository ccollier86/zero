'use client';

import * as React from 'react';
import type {
  AppShellMenuItem,
  AppShellWorkspaceConfig,
} from '../../components/app-shell/app-shell.types';
import { useAuth } from './auth-hooks';
import {
  useTenantSwitcher,
  type UseTenantSwitcherResult,
} from './tenant-administration-hooks';
import type {
  AuthSessionTransitionState,
  AuthTenantSummary,
} from './auth-types';

export interface UseTenantSwitchPresentationOptions {
  onSwitched?(tenantId: string): void;
}

export interface UseTenantSwitchPresentationResult {
  isAvailable: boolean;
  terminology: UseTenantSwitcherResult['terminology'];
  tenants: AuthTenantSummary[];
  activeTenant: AuthTenantSummary | null;
  isLoading: boolean;
  isSwitching: boolean;
  error: string | null;
  announcement: string;
  /** Increments when a switch trigger should regain focus. */
  focusRevision: number;
  reload(): void;
  switchTenant(tenantId: string): Promise<boolean>;
}

export interface UseTenantAppShellWorkspacesOptions
  extends UseTenantSwitchPresentationOptions {
  /** Hide the workspace control after a complete one-membership load. */
  hideWhenSingle?: boolean;
  label?: string;
  createLabel?: string;
  onCreate?(): void;
  activeActions?: AppShellMenuItem[];
  itemSubtitle?(tenant: AuthTenantSummary): string | undefined;
}

/**
 * Shared tenant-switch presentation state used by packaged switch controls.
 *
 * This is deliberately layered over useTenantSwitcher(): the auth controller
 * remains the only credential/session owner, while this hook preserves the
 * committed display and an accessible completion handoff across scope remounts.
 */
export function useTenantSwitchPresentation(
  options: UseTenantSwitchPresentationOptions = {},
): UseTenantSwitchPresentationResult {
  const auth = useAuth();
  const tenant = useTenantSwitcher();
  const [announcement, setAnnouncement] = React.useState('');
  const [localError, setLocalError] = React.useState<string | null>(null);
  const [localSwitching, setLocalSwitching] = React.useState(false);
  const [handoff, setHandoff] = React.useState<TenantSwitcherHandoff | null>(null);
  const handoffRef = React.useRef<TenantSwitcherHandoff | null>(null);
  const [focusRevision, setFocusRevision] = React.useState(0);
  const stableDisplay = React.useRef<TenantSwitcherDisplay | null>(null);
  const switchInFlight = React.useRef(false);
  const transitionSwitching = auth.sessionTransition.operation === 'tenant-switch'
    && auth.sessionTransition.phase !== 'idle'
    && auth.sessionTransition.phase !== 'recovery-required';
  const failHandoff = React.useCallback(() => {
    setLocalSwitching(false);
    setLocalError(`Failed to switch ${tenant.terminology.singular}. Try again.`);
    setAnnouncement(`${capitalize(tenant.terminology.singular)} switch failed`);
    clearTenantSwitcherHandoff();
    handoffRef.current = null;
    setHandoff(null);
    setFocusRevision((value) => value + 1);
  }, [tenant.terminology.singular]);

  const committedUserId = auth.user?.userId ?? null;
  if (tenant.activeTenant && committedUserId) {
    const identityDisplay = stableDisplay.current?.userId === committedUserId
      ? stableDisplay.current
      : null;
    const available = tenant.tenants.length > 0
      ? tenant.tenants
      : identityDisplay?.tenants ?? [tenant.activeTenant];
    stableDisplay.current = {
      userId: committedUserId,
      activeTenant: tenant.activeTenant,
      tenants: includeActiveTenant(available, tenant.activeTenant),
    };
  } else {
    stableDisplay.current = resolveTenantSwitcherStableDisplay({
      display: stableDisplay.current,
      committedUserId,
      transition: auth.sessionTransition,
      handoff: handoffRef.current,
    });
  }

  const display = stableDisplay.current;
  const activeTenant = tenant.activeTenant ?? (transitionSwitching
    ? display?.activeTenant ?? null
    : null);
  const tenants = tenant.tenants.length > 0
    ? tenant.tenants
    : display?.tenants ?? (activeTenant ? [activeTenant] : []);
  const switching = localSwitching || tenant.isSwitching || transitionSwitching
    || Boolean(
      handoff
      && handoff.userId === auth.user?.userId
      && handoff.phase === 'pending',
    );

  React.useEffect(() => {
    const read = () => {
      const next = readTenantSwitcherHandoff();
      handoffRef.current = next;
      setHandoff(next);
    };
    read();
    if (typeof window === 'undefined') return;
    window.addEventListener(TENANT_SWITCHER_HANDOFF_EVENT, read);
    return () => window.removeEventListener(TENANT_SWITCHER_HANDOFF_EVENT, read);
  }, []);

  React.useEffect(() => {
    if (!handoff) return;
    const failureReason = tenantSwitcherHandoffFailureReason(
      handoff,
      auth.sessionTransition,
    );
    if (failureReason === 'expired') {
      failHandoff();
      return;
    }
    const userId = auth.user?.userId;
    // useAuth masks committed identity while a scope replacement is unstable.
    if (!userId) {
      if (failureReason === 'recovery-required'
        && activeTenant?.tenantId !== handoff.targetTenantId) failHandoff();
      return;
    }
    if (handoff.userId !== userId) {
      clearTenantSwitcherHandoff();
      handoffRef.current = null;
      setHandoff(null);
      return;
    }
    if (handoff.phase === 'pending'
      && !transitionSwitching
      && activeTenant?.tenantId === handoff.targetTenantId) {
      completeTenantSwitch(handoff, activeTenant.name);
      return;
    }
    if (handoff.phase === 'succeeded'
      && activeTenant?.tenantId === handoff.targetTenantId) {
      completeTenantSwitch(handoff, activeTenant.name);
      return;
    }
    if (failureReason === 'recovery-required'
      && activeTenant?.tenantId !== handoff.targetTenantId) {
      failHandoff();
      return;
    }
    if (handoff.phase === 'failed'
      && activeTenant?.tenantId === handoff.sourceTenantId) {
      failHandoff();
    }

    function completeTenantSwitch(
      completed: TenantSwitcherHandoff,
      activeName: string,
    ) {
      setLocalError(null);
      setAnnouncement(`Switched to ${activeName}`);
      clearTenantSwitcherHandoff();
      handoffRef.current = null;
      setHandoff(null);
      options.onSwitched?.(completed.targetTenantId);
      setFocusRevision((value) => value + 1);
    }
  }, [
    activeTenant?.name,
    activeTenant?.tenantId,
    auth.user?.userId,
    auth.sessionTransition,
    failHandoff,
    handoff,
    options.onSwitched,
    transitionSwitching,
  ]);

  React.useEffect(() => {
    if (!handoff || typeof window === 'undefined') return;
    const remaining = tenantSwitcherHandoffRemainingMs(handoff);
    if (remaining === 0) {
      failHandoff();
      return;
    }
    const timeout = window.setTimeout(failHandoff, remaining + 1);
    return () => window.clearTimeout(timeout);
  }, [failHandoff, handoff]);

  const switchTenant = React.useCallback(async (tenantId: string) => {
    const currentTenant = activeTenant;
    if (!currentTenant || tenantId === currentTenant.tenantId
      || switching || switchInFlight.current) return false;
    switchInFlight.current = true;
    const pending: TenantSwitcherHandoff = {
      phase: 'pending',
      userId: auth.user?.userId ?? '',
      sourceTenantId: currentTenant.tenantId,
      targetTenantId: tenantId,
      createdAt: Date.now(),
    };
    handoffRef.current = pending;
    setHandoff(pending);
    setLocalSwitching(true);
    setLocalError(null);
    setAnnouncement('');
    writeTenantSwitcherHandoff(pending);
    try {
      return await runTenantSwitch(
        () => tenant.switchTenant(tenantId),
        () => writeTenantSwitcherHandoff({ ...pending, phase: 'succeeded' }),
        (cause) => {
          setLocalError(cause instanceof Error
            ? cause.message
            : `Failed to switch ${tenant.terminology.singular}`);
          writeTenantSwitcherHandoff({ ...pending, phase: 'failed' });
        },
      );
    } finally {
      switchInFlight.current = false;
      setLocalSwitching(false);
    }
  }, [
    activeTenant,
    auth.user?.userId,
    switching,
    tenant.switchTenant,
    tenant.terminology.singular,
  ]);

  return {
    isAvailable: tenant.isAvailable,
    terminology: tenant.terminology,
    tenants,
    activeTenant,
    isLoading: tenant.isLoading,
    isSwitching: switching,
    error: localError ?? tenant.error,
    announcement,
    focusRevision,
    reload: React.useCallback(() => {
      setLocalError(null);
      tenant.reload();
    }, [tenant.reload]),
    switchTenant,
  };
}

/** @internal Contain hook-reported failures so UI event handlers never reject. */
export async function runTenantSwitch(
  operation: () => Promise<void>,
  onSuccess: () => void,
  onFailure: (cause: unknown) => void = () => {},
): Promise<boolean> {
  try {
    await operation();
    onSuccess();
    return true;
  } catch (cause) {
    onFailure(cause);
    return false;
  }
}

/**
 * Adapt Zero's committed tenant session to AppShell's workspace presentation.
 * Selecting an item always delegates to the same rotating tenant-session path
 * as TenantSwitcher; this hook never edits auth tokens or scope locally.
 */
export function useTenantAppShellWorkspaces(
  options: UseTenantAppShellWorkspacesOptions = {},
): AppShellWorkspaceConfig | undefined {
  const tenant = useTenantSwitchPresentation(options);
  return projectTenantAppShellWorkspaces(tenant, options);
}

/** @internal Pure projection kept exported for contract tests. */
export function projectTenantAppShellWorkspaces(
  tenant: UseTenantSwitchPresentationResult,
  options: UseTenantAppShellWorkspacesOptions = {},
): AppShellWorkspaceConfig | undefined {
  if (!tenant.isAvailable || !tenant.activeTenant) return undefined;
  if ((options.hideWhenSingle ?? true)
    && !tenant.isLoading
    && !tenant.error
    && !options.onCreate
    && !options.activeActions?.length
    && tenant.tenants.length <= 1) return undefined;
  const singular = tenant.terminology.singular;
  const plural = tenant.terminology.plural;
  return {
    activeId: tenant.activeTenant.tenantId,
    label: options.label ?? capitalize(plural),
    createLabel: options.createLabel ?? `Create ${singular}`,
    items: tenant.tenants.map((item) => ({
      id: item.tenantId,
      name: item.name,
      subtitle: options.itemSubtitle?.(item)
        ?? (item.kind === 'administration'
          ? `Platform administration${item.role ? ` · ${item.role}` : ''}`
          : item.role ?? undefined),
    })),
    activeActions: options.activeActions,
    onCreate: options.onCreate,
    onSelect: (workspace) => { void tenant.switchTenant(workspace.id); },
    requireActiveSelection: true,
    pending: tenant.isLoading || tenant.isSwitching,
    pendingLabel: tenant.isSwitching
      ? `Switching ${singular}…`
      : `Loading ${plural}…`,
    error: tenant.error,
    retryLabel: `Retry ${singular} list`,
    onRetry: tenant.reload,
    announcement: tenant.announcement,
    focusRevision: tenant.focusRevision,
  };
}

export interface TenantSwitcherDisplay {
  userId: string;
  activeTenant: AuthTenantSummary;
  tenants: AuthTenantSummary[];
}

export interface TenantSwitcherHandoff {
  phase: 'pending' | 'succeeded' | 'failed';
  userId: string;
  sourceTenantId: string;
  targetTenantId: string;
  createdAt: number;
}

const TENANT_SWITCHER_HANDOFF_KEY = 'zero.auth.tenant-switcher-handoff.v1';
const TENANT_SWITCHER_HANDOFF_EVENT = 'zero:tenant-switcher-handoff';
const TENANT_SWITCHER_HANDOFF_MAX_AGE_MS = 60_000;
let volatileTenantSwitcherHandoff: TenantSwitcherHandoff | null = null;

export type TenantSwitcherHandoffFailureReason =
  | 'expired'
  | 'recovery-required';

/**
 * @internal Bind cached tenant labels and roles to their committed account.
 *
 * A masked tenant switch may keep the source presentation only while a
 * matching same-user handoff is in progress. Every other masked state drops
 * the cache so account replacement, logout, and recovery cannot reveal a
 * previous account's tenant metadata.
 */
export function resolveTenantSwitcherStableDisplay(input: {
  display: TenantSwitcherDisplay | null;
  committedUserId: string | null;
  transition: Pick<AuthSessionTransitionState, 'operation' | 'phase'>;
  handoff: TenantSwitcherHandoff | null;
}): TenantSwitcherDisplay | null {
  const { display, committedUserId, transition, handoff } = input;
  if (!display) return null;
  if (committedUserId) {
    return committedUserId === display.userId ? display : null;
  }
  const phaseKeepsSwitchPending = transition.phase === 'preparing'
    || transition.phase === 'committed'
    || transition.phase === 'reconciling';
  if (!phaseKeepsSwitchPending
    || transition.operation !== 'tenant-switch'
    || !handoff
    || handoff.phase === 'failed'
    || handoff.userId !== display.userId
    || handoff.sourceTenantId !== display.activeTenant.tenantId
    || handoff.targetTenantId === handoff.sourceTenantId) return null;
  return display;
}

/** @internal Decide when an interrupted switch must stop blocking its trigger. */
export function tenantSwitcherHandoffFailureReason(
  handoff: TenantSwitcherHandoff,
  transition: Pick<AuthSessionTransitionState, 'operation' | 'phase'>,
  now = Date.now(),
): TenantSwitcherHandoffFailureReason | null {
  if (tenantSwitcherHandoffRemainingMs(handoff, now) === 0) return 'expired';
  if (transition.operation === 'tenant-switch'
    && transition.phase === 'recovery-required') return 'recovery-required';
  return null;
}

/** @internal Remaining lifetime for the tab-local UI handoff marker. */
export function tenantSwitcherHandoffRemainingMs(
  handoff: TenantSwitcherHandoff,
  now = Date.now(),
): number {
  return Math.max(
    0,
    handoff.createdAt + TENANT_SWITCHER_HANDOFF_MAX_AGE_MS - now,
  );
}

/**
 * @internal Parse and bound the tab-local switch UI handoff.
 *
 * Only opaque correlation identifiers cross the protected-tree remount. Tenant
 * names, server errors, credentials, and authorization data are never stored.
 */
export function parseTenantSwitcherHandoff(
  value: string | null,
  now = Date.now(),
): TenantSwitcherHandoff | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<TenantSwitcherHandoff>;
    if ((parsed.phase !== 'pending' && parsed.phase !== 'succeeded'
        && parsed.phase !== 'failed')
      || typeof parsed.userId !== 'string'
      || typeof parsed.sourceTenantId !== 'string'
      || typeof parsed.targetTenantId !== 'string'
      || !isBoundedHandoffIdentifier(parsed.userId)
      || !isBoundedHandoffIdentifier(parsed.sourceTenantId)
      || !isBoundedHandoffIdentifier(parsed.targetTenantId)
      || typeof parsed.createdAt !== 'number'
      || !Number.isFinite(parsed.createdAt)
      || parsed.createdAt > now + 5_000
      || now - parsed.createdAt > TENANT_SWITCHER_HANDOFF_MAX_AGE_MS) return null;
    return {
      phase: parsed.phase,
      userId: parsed.userId,
      sourceTenantId: parsed.sourceTenantId,
      targetTenantId: parsed.targetTenantId,
      createdAt: parsed.createdAt,
    };
  } catch {
    return null;
  }
}

function isBoundedHandoffIdentifier(value: string): boolean {
  return value.length > 0 && value.length <= 512;
}

function readTenantSwitcherHandoff(): TenantSwitcherHandoff | null {
  if (typeof window === 'undefined') return null;
  try {
    const parsed = parseTenantSwitcherHandoff(
      window.sessionStorage.getItem(TENANT_SWITCHER_HANDOFF_KEY),
    );
    if (parsed) {
      volatileTenantSwitcherHandoff = parsed;
      return parsed;
    }
    const fallback = parseTenantSwitcherHandoff(
      volatileTenantSwitcherHandoff
        ? JSON.stringify(volatileTenantSwitcherHandoff)
        : null,
    );
    if (!fallback) clearTenantSwitcherHandoff();
    return fallback;
  } catch {
    return parseTenantSwitcherHandoff(
      volatileTenantSwitcherHandoff
        ? JSON.stringify(volatileTenantSwitcherHandoff)
        : null,
    );
  }
}

function writeTenantSwitcherHandoff(handoff: TenantSwitcherHandoff): void {
  if (typeof window === 'undefined') return;
  volatileTenantSwitcherHandoff = handoff;
  try {
    window.sessionStorage.setItem(TENANT_SWITCHER_HANDOFF_KEY, JSON.stringify(handoff));
  } catch {
    // In-memory handoff still preserves same-document remount behavior.
  }
  window.dispatchEvent(new window.Event(TENANT_SWITCHER_HANDOFF_EVENT));
}

function clearTenantSwitcherHandoff(): void {
  if (typeof window === 'undefined') return;
  volatileTenantSwitcherHandoff = null;
  try {
    window.sessionStorage.removeItem(TENANT_SWITCHER_HANDOFF_KEY);
  } catch {
    // The same privacy modes that block reads can also reject removal.
  }
}

function includeActiveTenant(
  tenants: AuthTenantSummary[],
  active: AuthTenantSummary,
): AuthTenantSummary[] {
  return tenants.some((tenant) => tenant.tenantId === active.tenantId)
    ? tenants
    : [active, ...tenants];
}

function capitalize(value: string): string {
  return value.length === 0 ? value : value[0]!.toUpperCase() + value.slice(1);
}
