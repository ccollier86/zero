'use client';

/** Client-scoped observable cache for Zero's public auth configuration. */

import { reportAuthClientActionFailure } from './auth-action-observability';
import { AuthClientError } from './auth-errors';
import type { AuthPublicConfig } from './auth-types';
import { isAuthPublicConfig } from './auth-public-config-parser';

export type AuthConfigStatus = 'unknown' | 'loading' | 'ready' | 'error';

export interface AuthConfigSnapshot {
  readonly status: AuthConfigStatus;
  readonly config: AuthPublicConfig | null;
  readonly error: string | null;
}

export interface AuthConfigClient {
  getConfig(signal?: AbortSignal): Promise<AuthPublicConfig>;
}

export interface AuthConfigControllerOptions {
  reportFailure?: (cause: unknown) => void;
}

const UNKNOWN_SNAPSHOT: AuthConfigSnapshot = Object.freeze({
  status: 'unknown',
  config: null,
  error: null,
});

const controllers = new WeakMap<AuthConfigClient, AuthConfigController>();

/** Return the single public-config controller owned by a concrete auth client. */
export function getAuthConfigController(client: AuthConfigClient): AuthConfigController {
  const existing = controllers.get(client);
  if (existing) return existing;

  const controller = new AuthConfigController(client);
  controllers.set(client, controller);
  return controller;
}

/**
 * Shares public auth configuration between consumers of one AuthClient.
 * Config is a UI capability hint only; server auth policy remains authoritative.
 */
export class AuthConfigController {
  private state = UNKNOWN_SNAPSHOT;
  private readonly listeners = new Set<() => void>();
  private generation = 0;
  private request: PendingRequest | null = null;

  constructor(
    private readonly client: AuthConfigClient,
    private readonly options: AuthConfigControllerOptions = {},
  ) {}

  getSnapshot(): AuthConfigSnapshot {
    return this.state;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  /** Return cached config or coalesce an ordinary load with the active request. */
  ensureCurrent(): Promise<AuthPublicConfig | null> {
    if (this.state.status === 'ready' && this.state.config) {
      return Promise.resolve(this.state.config);
    }
    return this.request?.promise ?? this.startRequest().promise;
  }

  /** Supersede every pending request and force a live server read. */
  refresh(): Promise<AuthPublicConfig | null> {
    return this.startRequest().promise;
  }

  /**
   * Force a live read while preserving the imperative Auth action contract:
   * current failures reject even though the same request publishes safe state
   * for nonthrowing hook consumers.
   */
  refreshOrThrow(): Promise<AuthPublicConfig> {
    return strictConfigResult(this.startRequest().outcome);
  }

  /**
   * Discard a policy snapshot that a successful auth mutation made stale.
   * The next ensure/refresh starts from a fail-closed empty snapshot.
   */
  invalidate(): void {
    this.generation += 1;
    this.request?.abortController.abort();
    this.request = null;
    this.publish(UNKNOWN_SNAPSHOT);
  }

  private startRequest(): PendingRequest {
    this.generation += 1;
    const generation = this.generation;
    this.request?.abortController.abort();

    const abortController = new AbortController();
    const retained = this.state.config;
    const outcome = this.executeRequest(generation, abortController);

    const promise = outcome.then((result) => (
      result.kind === 'ready' ? result.config : null
    ));
    const request = { abortController, outcome, promise };
    this.request = request;
    this.publish(Object.freeze({
      status: 'loading',
      config: retained,
      error: null,
    }));
    return request;
  }

  private async executeRequest(
    generation: number,
    abortController: AbortController,
  ): Promise<AuthConfigRequestOutcome> {
    // Let startRequest publish the PendingRequest before even a synchronously
    // throwing client implementation can settle it.
    await Promise.resolve();
    try {
      if (!this.isCurrent(generation)) return SUPERSEDED_OUTCOME;
      const config = await this.client.getConfig(abortController.signal);
      if (!this.isCurrent(generation)) return SUPERSEDED_OUTCOME;
      if (!isAuthPublicConfig(config)) {
        throw new TypeError('Invalid public auth config response');
      }
      const immutableConfig = immutableCopy(config);
      this.publish(Object.freeze({
        status: 'ready',
        config: immutableConfig,
        error: null,
      }));
      return Object.freeze({ kind: 'ready', config: immutableConfig });
    } catch (cause: unknown) {
      if (!this.isCurrent(generation)) {
        return Object.freeze({ kind: 'superseded', cause });
      }
      this.publish(Object.freeze({
        status: 'error',
        config: null,
        error: safeErrorMessage(cause),
      }));
      this.reportFailure(cause);
      return Object.freeze({ kind: 'error', cause });
    } finally {
      if (this.isCurrent(generation)) this.request = null;
    }
  }

  private isCurrent(generation: number): boolean {
    return generation === this.generation;
  }

  private publish(snapshot: AuthConfigSnapshot): void {
    if (sameSnapshot(this.state, snapshot)) return;
    this.state = snapshot;
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        // A consumer cannot prevent cache publication or other notifications.
      }
    }
  }

  private reportFailure(cause: unknown): void {
    try {
      if (this.options.reportFailure) {
        this.options.reportFailure(cause);
        return;
      }
      reportAuthClientActionFailure('authConfig', cause);
    } catch {
      // Frontend observability is best-effort and must not alter config state.
    }
  }
}

interface PendingRequest {
  readonly abortController: AbortController;
  readonly outcome: Promise<AuthConfigRequestOutcome>;
  readonly promise: Promise<AuthPublicConfig | null>;
}

type AuthConfigRequestOutcome =
  | { readonly kind: 'ready'; readonly config: AuthPublicConfig }
  | { readonly kind: 'error'; readonly cause: unknown }
  | { readonly kind: 'superseded'; readonly cause?: unknown };

const SUPERSEDED_OUTCOME: AuthConfigRequestOutcome = Object.freeze({
  kind: 'superseded',
});

async function strictConfigResult(
  outcome: Promise<AuthConfigRequestOutcome>,
): Promise<AuthPublicConfig> {
  const result = await outcome;
  if (result.kind === 'ready') return result.config;
  if (result.kind === 'error') throw result.cause;
  if (result.cause instanceof Error) throw result.cause;
  throw new DOMException(
    'Auth config request was superseded by a newer request',
    'AbortError',
  );
}

function immutableCopy<T>(value: T): T {
  if (Array.isArray(value)) {
    return Object.freeze(value.map((item) => immutableCopy(item))) as T;
  }
  if (!value || typeof value !== 'object') return value;

  const entries = Object.entries(value).map(([key, item]) => [key, immutableCopy(item)]);
  return Object.freeze(Object.fromEntries(entries)) as T;
}

function sameSnapshot(left: AuthConfigSnapshot, right: AuthConfigSnapshot): boolean {
  return left.status === right.status
    && left.config === right.config
    && left.error === right.error;
}

function safeErrorMessage(cause: unknown): string {
  return cause instanceof AuthClientError
    ? cause.message
    : 'Failed to load auth config';
}
