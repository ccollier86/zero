/** Pure query handling for public onboarding routes. */

const WORKSPACE_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const INVITATION_TOKEN = /^zinv_[A-Za-z0-9_-]+$/;
const INVITATION_HANDOFF_KEY = 'guardian-fabric-proof:invitation-handoff:v1';
export const INVITATION_HANDOFF_TTL_MS = 30 * 60 * 1_000;
export const INVITATION_HANDOFF_UPDATED_EVENT = 'guardian-fabric-proof:invitation-handoff';

export interface InvitationRouteInput {
  readonly token: string;
  readonly continuation?: string;
}

export interface InvitationHandoffStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface InvitationRouteResolution {
  readonly input: InvitationRouteInput | null;
  readonly source: 'link' | 'handoff' | 'none';
  readonly malformed: boolean;
}

export function parseInvitationRoute(search: string): InvitationRouteInput | null {
  const params = new URLSearchParams(search.replace(/^[?#]/, ''));
  const token = params.get('token')?.trim() ?? '';
  const continuation = params.get('continuation')?.trim() ?? '';
  if (!isInvitationRouteToken(token) || continuation.length > 512) return null;
  return Object.freeze({ token, ...(continuation ? { continuation } : {}) });
}

/** Distinguish an absent invite from an explicitly malformed invite URL. */
export function hasInvitationRouteMaterial(value: string): boolean {
  const params = new URLSearchParams(value.replace(/^[?#]/, ''));
  return params.has('token') || params.has('continuation');
}

/** Resolve one authoritative entry and prevent an old handoff from shadowing a new link. */
export function resolveInvitationRouteEntry(
  hash: string,
  search: string,
  store: InvitationHandoffStore | null,
  now = Date.now(),
): InvitationRouteResolution {
  const explicitSource = hasInvitationRouteMaterial(hash)
    ? hash
    : hasInvitationRouteMaterial(search) ? search : null;
  if (explicitSource !== null) {
    const linked = parseInvitationRoute(explicitSource);
    if (store) clearInvitationRoute(store);
    return Object.freeze({ input: linked, source: 'link', malformed: linked === null });
  }
  const restored = store ? restoreInvitationRoute(store, now) : null;
  return Object.freeze({
    input: restored,
    source: restored ? 'handoff' : 'none',
    malformed: false,
  });
}

export function rememberInvitationRoute(
  store: InvitationHandoffStore,
  input: InvitationRouteInput,
  now = Date.now(),
): boolean {
  if (!isInvitationRouteToken(input.token)
    || (input.continuation?.length ?? 0) > 512
    || !Number.isSafeInteger(now)
    || now < 0
    || now > Number.MAX_SAFE_INTEGER - INVITATION_HANDOFF_TTL_MS) return false;
  try {
    store.setItem(INVITATION_HANDOFF_KEY, JSON.stringify({ ...input, capturedAt: now }));
    return true;
  } catch {
    return false;
  }
}

export function restoreInvitationRoute(
  store: InvitationHandoffStore,
  now = Date.now(),
): InvitationRouteInput | null {
  return readInvitationHandoff(store, now)?.input ?? null;
}

/** Remaining lifetime for a root-level cleanup timer, without exposing the secret. */
export function invitationHandoffRemainingMs(
  store: InvitationHandoffStore,
  now = Date.now(),
): number | null {
  const handoff = readInvitationHandoff(store, now);
  return handoff ? Math.max(0, handoff.expiresAt - now) : null;
}

export function clearInvitationRoute(store: InvitationHandoffStore): void {
  try {
    store.removeItem(INVITATION_HANDOFF_KEY);
  } catch {
    // Storage may be unavailable; no persistent handoff exists in that case.
  }
}

export function isInvitationRouteToken(value: string): boolean {
  return value.length >= 45 && value.length <= 200 && INVITATION_TOKEN.test(value);
}

function readInvitationHandoff(
  store: InvitationHandoffStore,
  now: number,
): { input: InvitationRouteInput; expiresAt: number } | null {
  try {
    const raw = store.getItem(INVITATION_HANDOFF_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const token = typeof parsed.token === 'string' ? parsed.token : '';
    const continuation = typeof parsed.continuation === 'string'
      ? parsed.continuation
      : undefined;
    const capturedAt = parsed.capturedAt;
    const expiresAt = (capturedAt as number) + INVITATION_HANDOFF_TTL_MS;
    if (!isInvitationRouteToken(token)
      || (continuation?.length ?? 0) > 512
      || !Number.isSafeInteger(capturedAt)
      || (capturedAt as number) < 0
      || !Number.isSafeInteger(expiresAt)
      || !Number.isSafeInteger(now)
      || now < (capturedAt as number)
      || now > expiresAt) {
      clearInvitationRoute(store);
      return null;
    }
    return {
      input: Object.freeze({ token, ...(continuation ? { continuation } : {}) }),
      expiresAt,
    };
  } catch {
    clearInvitationRoute(store);
    return null;
  }
}

export function parseWorkspaceSlug(search: string): string {
  const slug = normalizeWorkspaceSlug(new URLSearchParams(search).get('workspace') ?? '');
  return isWorkspaceSlug(slug) ? slug : '';
}

export function normalizeWorkspaceSlug(value: string): string {
  return value.trim().toLowerCase();
}

export function isWorkspaceSlug(value: string): boolean {
  return value.length <= 63 && WORKSPACE_SLUG.test(value);
}


/** Remove one-time credentials while retaining only the non-sensitive workspace hint. */
export function cleanOnboardingHref(
  pathname: string,
  hash = '',
  workspaceSlug = '',
): string {
  const slug = normalizeWorkspaceSlug(workspaceSlug);
  const search = slug ? `?workspace=${encodeURIComponent(slug)}` : '';
  return `${pathname}${search}${hash}`;
}
