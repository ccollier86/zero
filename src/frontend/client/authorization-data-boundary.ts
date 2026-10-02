/** Observable client cache boundary for live server authorization changes. */

export interface AuthorizationDataBoundarySource {
  /** Monotonic browser-local cache revision. It is never authorization evidence. */
  readonly revision: number;
  subscribe(callback: () => void): () => void;
}

/**
 * Invalidates authorization-scoped client data without changing account or
 * tenant identity. Sync uses this when the server rejects a stale live policy.
 */
export class AuthorizationDataBoundaryController
  implements AuthorizationDataBoundarySource {
  private currentRevision = 0;
  private readonly listeners = new Set<() => void>();

  get revision(): number {
    return this.currentRevision;
  }

  subscribe(callback: () => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  invalidate(): void {
    this.currentRevision += 1;
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        // A consumer cannot prevent the remaining caches from being fenced.
      }
    }
  }
}
