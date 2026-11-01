/** Supported native runtime boundary. Pure compatibility checks only: no app config, environment files, services or persistent state are opened. */
export const MINIMUM_BUN_VERSION = '1.4.4';
export const BUN_ENGINE_RANGE = `>=${MINIMUM_BUN_VERSION}`;

/** Reject affected/prerelease runtimes; ordinary version/build metadata follows Bun's semver rules. */
export function isSupportedBunVersion(version: unknown): version is string {
  if (typeof version !== 'string' || version.length > 128 || typeof Bun === 'undefined') return false;
  try { return Bun.semver.satisfies(version, BUN_ENGINE_RANGE); } catch { return false; }
}

/** A stable, content-free startup error. Never substitutes weaker HTTP/auth/audit behavior on an unsafe runtime. */
export class UnsupportedBunRuntimeError extends Error {
  readonly code = 'ZERO_BUN_RUNTIME_UNSUPPORTED';
  constructor(readonly actualVersion: string | null) {
    super(`[ZERO_BUN_RUNTIME_UNSUPPORTED] Zero requires Bun ${MINIMUM_BUN_VERSION} or newer; current runtime: ${actualVersion ?? 'unavailable'}. `
      + 'Older Bun runtimes can crash during HTTP cancellation or stall native stream/file delivery. '
      + 'Upgrade Bun and your Docker/CI runtime, then rebuild any compiled server before starting Zero.');
    this.name = 'UnsupportedBunRuntimeError';
  }
}

/** Inspect the actual executing binary, including the embedded Bun in a compiled server. */
export function getUnsupportedBunRuntimeError(): UnsupportedBunRuntimeError | null {
  const version = typeof Bun === 'undefined' ? null : Bun.version;
  return isSupportedBunVersion(version) ? null : new UnsupportedBunRuntimeError(version);
}

/** Call before config imports or filesystem mutations in managed server/build/install entrypoints. */
export function assertSupportedBunRuntime(): void {
  const failure = getUnsupportedBunRuntimeError();
  if (failure) throw failure;
}
