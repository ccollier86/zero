/** Coordinate one-time refresh-token rotation across browser tabs. */

interface BrowserLockManager {
  request<T>(
    name: string,
    options: { mode: 'exclusive' },
    callback: () => Promise<T>,
  ): Promise<T>;
}

const fallbackTails = new Map<string, Promise<void>>();

/**
 * Run a refresh operation exclusively for one Zero server.
 *
 * Web Locks serialize rotations across tabs and workers. The in-module queue
 * provides the same guarantee for concurrent clients in runtimes without the
 * browser API within one JavaScript realm, including SSR-adjacent tests.
 */
export async function withAuthRefreshLock<T>(
  baseUrl: string,
  operation: () => Promise<T>,
): Promise<T> {
  const name = refreshLockName(baseUrl);
  const lockManager = getBrowserLockManager();
  if (lockManager) {
    return lockManager.request(name, { mode: 'exclusive' }, operation);
  }

  const previous = fallbackTails.get(name) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.catch(() => undefined).then(() => current);
  fallbackTails.set(name, tail);

  await previous.catch(() => undefined);
  try {
    return await operation();
  } finally {
    release();
    if (fallbackTails.get(name) === tail) fallbackTails.delete(name);
  }
}

function getBrowserLockManager(): BrowserLockManager | null {
  const lockManager = (
    globalThis as typeof globalThis & {
      navigator?: { locks?: BrowserLockManager };
    }
  ).navigator?.locks;

  return lockManager && typeof lockManager.request === 'function'
    ? lockManager
    : null;
}

function refreshLockName(baseUrl: string): string {
  let scope = baseUrl;
  try {
    const url = new URL(baseUrl);
    scope = `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
  } catch {
    // createClient already requires a URL; retain a deterministic fallback for
    // direct AuthClient construction in non-browser runtimes.
  }
  return `zero:auth-refresh:${scope}`;
}
