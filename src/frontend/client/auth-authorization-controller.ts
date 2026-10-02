/** Identity- and scope-safe observable cache for browser authorization hints. */

import { AuthClientError } from './auth-errors';
import type {
  AuthAuthorizationSnapshot,
  AuthAuthorizationState,
} from './auth-authorization-types';
import type {
  AuthSessionTransitionState,
  AuthTenantSummary,
  AuthUser,
} from './auth-types';

export interface AuthAuthorizationSessionView {
  readonly user: AuthUser | null;
  readonly activeTenant: AuthTenantSummary | null;
  readonly accessToken: string | null;
  readonly isLoading: boolean;
  readonly transition: AuthSessionTransitionState;
}

export interface AuthAuthorizationControllerOptions {
  load: (signal?: AbortSignal) => Promise<AuthAuthorizationSnapshot>;
  readSession: () => AuthAuthorizationSessionView;
  subscribeSession: (callback: () => void) => () => void;
  expireSession: () => void;
  /** Revalidation while observed. Set to 0 to rely on focus/online/manual refresh. */
  revalidateIntervalMs?: number;
}

const UNAUTHENTICATED_STATE: AuthAuthorizationState = Object.freeze({
  status: 'unauthenticated',
  snapshot: null,
  error: null,
});

/**
 * This cache is only a UI hint. It aggressively rejects results from an old
 * account, bearer, or tenant and never participates in server authorization.
 */
export class AuthAuthorizationController {
  private state: AuthAuthorizationState = UNAUTHENTICATED_STATE;
  private readonly listeners = new Set<() => void>();
  private readonly unsubscribeSession: () => void;
  private requestRevision = 0;
  private request: Promise<AuthAuthorizationSnapshot | null> | null = null;
  private abortController: AbortController | null = null;
  private observedSession: SessionIdentity | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private browserEventsInstalled = false;
  private disposed = false;

  constructor(private readonly options: AuthAuthorizationControllerOptions) {
    this.observedSession = readSessionIdentity(options.readSession());
    this.state = initialState(options.readSession(), this.observedSession);
    this.unsubscribeSession = options.subscribeSession(() => this.handleSessionChange());
  }

  getSnapshot(): AuthAuthorizationState {
    return this.state;
  }

  subscribe(callback: () => void): () => void {
    if (this.disposed) return () => {};
    this.listeners.add(callback);
    if (this.listeners.size === 1) {
      this.installBrowserEvents();
      void this.ensureCurrent();
    }
    return () => {
      this.listeners.delete(callback);
      if (this.listeners.size === 0) {
        this.clearTimer();
        this.removeBrowserEvents();
      }
    };
  }

  /** Return a current server snapshot, deduplicating an equivalent request. */
  ensureCurrent(): Promise<AuthAuthorizationSnapshot | null> {
    const session = readSessionIdentity(this.options.readSession());
    if (!session || !isRequestableTransition(this.options.readSession().transition)) {
      return Promise.resolve(null);
    }
    if (this.state.status === 'ready' && this.state.snapshot
      && snapshotMatchesSession(this.state.snapshot, session)) {
      this.scheduleRevalidation();
      return Promise.resolve(this.state.snapshot);
    }
    return this.request ?? this.startRequest(false);
  }

  /** Force a new server read and supersede every pending response. */
  refresh(): Promise<AuthAuthorizationSnapshot | null> {
    return this.startRequest(true);
  }

  /**
   * Drop a same-session authorization hint after another live transport proves
   * that its policy snapshot is stale. Pending results are fenced before the
   * empty state is published; observed consumers then reload current grants.
   */
  invalidate(): void {
    if (this.disposed) return;
    const view = this.options.readSession();
    const current = readSessionIdentity(view);
    this.requestRevision += 1;
    this.abortController?.abort();
    this.abortController = null;
    this.request = null;
    this.clearTimer();
    this.publish(initialState(view, current));
    if (current && isRequestableTransition(view.transition)
      && this.listeners.size > 0) void this.startRequest(false);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.requestRevision += 1;
    this.abortController?.abort();
    this.abortController = null;
    this.request = null;
    this.clearTimer();
    this.removeBrowserEvents();
    this.unsubscribeSession();
    this.listeners.clear();
  }

  private handleSessionChange(): void {
    if (this.disposed) return;
    const view = this.options.readSession();
    const next = readSessionIdentity(view);
    const previous = this.observedSession;
    const boundaryChanged = !sameSessionBoundary(previous, next);
    const bearerChanged = previous?.accessToken !== next?.accessToken;
    const transitionBlocked = !isRequestableTransition(view.transition);

    this.observedSession = next;
    if (boundaryChanged || bearerChanged || transitionBlocked || !next) {
      this.requestRevision += 1;
      this.abortController?.abort();
      this.abortController = null;
      this.request = null;
      this.clearTimer();
    }

    if (!next || transitionBlocked) {
      // Keep an explicit server revocation observable after session expiry.
      // A later authenticated boundary still replaces it with `loading`.
      if (!next && this.state.status === 'revoked') return;
      this.publish(initialState(view, next));
      return;
    }

    if (boundaryChanged) {
      this.publish(Object.freeze({ status: 'loading', snapshot: null, error: null }));
      if (this.listeners.size > 0) void this.startRequest(false);
      return;
    }

    if (bearerChanged) {
      const keep = this.state.snapshot
        && snapshotMatchesSession(this.state.snapshot, next)
        ? this.state.snapshot
        : null;
      this.publish(Object.freeze({
        status: keep ? 'refreshing' : 'loading',
        snapshot: keep,
        error: null,
      }));
      if (this.listeners.size > 0) void this.startRequest(false);
      return;
    }

    if (this.listeners.size > 0) void this.ensureCurrent();
  }

  private startRequest(supersede: boolean): Promise<AuthAuthorizationSnapshot | null> {
    if (this.disposed) return Promise.resolve(null);
    const view = this.options.readSession();
    const expected = readSessionIdentity(view);
    if (!expected || !isRequestableTransition(view.transition)) {
      this.publish(initialState(view, expected));
      return Promise.resolve(null);
    }
    if (!supersede && this.request) return this.request;

    this.requestRevision += 1;
    const revision = this.requestRevision;
    this.abortController?.abort();
    const abortController = new AbortController();
    this.abortController = abortController;
    this.clearTimer();
    const retained = this.state.snapshot
      && snapshotMatchesSession(this.state.snapshot, expected)
      ? this.state.snapshot
      : null;
    this.publish(Object.freeze({
      status: retained ? 'refreshing' : 'loading',
      snapshot: retained,
      error: null,
    }));

    const pending = this.options.load(abortController.signal)
      .then((snapshot) => {
        if (!this.isRequestCurrent(revision, expected)) return null;
        if (!snapshotMatchesSession(snapshot, expected)) {
          throw new Error(
            '[client] Discarded a current-authorization response for another identity or scope.',
          );
        }
        this.publish(Object.freeze({ status: 'ready', snapshot, error: null }));
        return snapshot;
      })
      .catch((cause: unknown) => {
        if (!this.isRequestCurrent(revision, expected) || isAbortError(cause)) return null;
        const revoked = cause instanceof AuthClientError
          && (cause.status === 401 || cause.status === 403);
        this.publish(Object.freeze({
          status: revoked ? 'revoked' : 'error',
          snapshot: null,
          error: errorMessage(cause),
        }));
        // A subscriber may synchronously begin replacing the session. Never
        // expire a credential that changed while the revocation was published.
        if (revoked && this.isRequestCurrent(revision, expected)) {
          this.options.expireSession();
        }
        return null;
      })
      .finally(() => {
        if (revision !== this.requestRevision) return;
        this.request = null;
        this.abortController = null;
        this.scheduleRevalidation();
      });
    this.request = pending;
    return pending;
  }

  private isRequestCurrent(revision: number, expected: SessionIdentity): boolean {
    if (this.disposed || revision !== this.requestRevision) return false;
    const view = this.options.readSession();
    return isRequestableTransition(view.transition)
      && sameExactSession(expected, readSessionIdentity(view));
  }

  private publish(next: AuthAuthorizationState): void {
    if (sameState(this.state, next)) return;
    this.state = next;
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        // Consumer notification failures cannot alter cache or expiry state.
      }
    }
  }

  private scheduleRevalidation(): void {
    this.clearTimer();
    const interval = this.options.revalidateIntervalMs ?? 30_000;
    if (this.disposed || this.listeners.size === 0 || interval <= 0
      || typeof window === 'undefined') return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.refresh();
    }, Math.max(1_000, interval));
  }

  private clearTimer(): void {
    if (this.timer === null) return;
    clearTimeout(this.timer);
    this.timer = null;
  }

  private readonly handleBrowserRevalidation = () => {
    if (typeof document !== 'undefined'
      && document.visibilityState === 'hidden') return;
    void this.refresh();
  };

  private installBrowserEvents(): void {
    if (this.browserEventsInstalled || typeof window === 'undefined') return;
    this.browserEventsInstalled = true;
    window.addEventListener('focus', this.handleBrowserRevalidation);
    window.addEventListener('online', this.handleBrowserRevalidation);
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.handleBrowserRevalidation);
    }
  }

  private removeBrowserEvents(): void {
    if (!this.browserEventsInstalled || typeof window === 'undefined') return;
    this.browserEventsInstalled = false;
    window.removeEventListener('focus', this.handleBrowserRevalidation);
    window.removeEventListener('online', this.handleBrowserRevalidation);
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.handleBrowserRevalidation);
    }
  }
}

interface SessionIdentity {
  readonly boundary: string;
  readonly userId: string;
  readonly platformRole: string;
  readonly tenantId: string | null;
  readonly accessToken: string;
}

function readSessionIdentity(view: AuthAuthorizationSessionView): SessionIdentity | null {
  if (!view.user || !view.accessToken) return null;
  const tenantId = view.activeTenant?.tenantId ?? null;
  return {
    boundary: JSON.stringify([view.user.userId, view.user.role, tenantId]),
    userId: view.user.userId,
    platformRole: view.user.role,
    tenantId,
    accessToken: view.accessToken,
  };
}

function initialState(
  view: AuthAuthorizationSessionView,
  identity: SessionIdentity | null,
): AuthAuthorizationState {
  if (view.isLoading || identity || !isRequestableTransition(view.transition)) {
    return Object.freeze({ status: 'loading', snapshot: null, error: null });
  }
  return UNAUTHENTICATED_STATE;
}

function isRequestableTransition(transition: AuthSessionTransitionState): boolean {
  return transition.phase === 'idle' || transition.phase === 'recovery-required';
}

function sameSessionBoundary(
  left: SessionIdentity | null,
  right: SessionIdentity | null,
): boolean {
  return left?.boundary === right?.boundary;
}

function sameExactSession(
  left: SessionIdentity | null,
  right: SessionIdentity | null,
): boolean {
  return sameSessionBoundary(left, right)
    && left?.accessToken === right?.accessToken;
}

function snapshotMatchesSession(
  snapshot: AuthAuthorizationSnapshot,
  session: SessionIdentity,
): boolean {
  if (snapshot.identity.userId !== session.userId
    || snapshot.identity.platformRole !== session.platformRole) return false;
  if (session.tenantId) {
    if (snapshot.profile.tenancy !== 'multi') return false;
    // A valid membership can deliberately project no authorization scope
    // (for example, no retained advanced-role assignment). Null grants
    // nothing and is safe to accept; any non-null scope must bind exactly.
    return snapshot.scope === null
      || (snapshot.scope.kind === 'tenant'
        && snapshot.scope.scopeId === session.tenantId
        && snapshot.scope.tenantId === session.tenantId);
  }
  return snapshot.profile.tenancy === 'single'
    && (snapshot.scope === null || snapshot.scope.kind === 'application');
}

function sameState(left: AuthAuthorizationState, right: AuthAuthorizationState): boolean {
  return left.status === right.status
    && left.snapshot === right.snapshot
    && left.error === right.error;
}

function isAbortError(cause: unknown): boolean {
  return (typeof DOMException !== 'undefined' && cause instanceof DOMException
    && cause.name === 'AbortError')
    || (typeof cause === 'object' && cause !== null
      && 'name' in cause && cause.name === 'AbortError');
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error
    ? cause.message
    : 'Unable to load current authorization';
}
