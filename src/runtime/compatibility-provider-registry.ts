/**
 * Safe compatibility adapter for legacy process-wide `get*()` APIs.
 *
 * Managed Zero applications receive app-bound services directly. Older
 * integrations may still call a no-argument getter, so those getters delegate
 * through this registry instead of selecting whichever app started last.
 */

export const ZERO_RUNTIME_AMBIGUOUS = 'ZERO_RUNTIME_AMBIGUOUS' as const;

export class ZeroRuntimeAmbiguousError extends Error {
  readonly code = ZERO_RUNTIME_AMBIGUOUS;

  constructor(readonly capability: string, readonly providerCount: number) {
    super(
      `[runtime] ${capability} is ambiguous because ${providerCount} Zero app runtimes are registered. `
      + 'Use the app-bound context.zero service or inject the service explicitly.',
    );
    this.name = 'ZeroRuntimeAmbiguousError';
  }
}

export interface CompatibilityProviderRegistration {
  /** Remove this exact provider. Safe to call more than once. */
  unregister(): void;
}

/**
 * Registry backing one legacy no-argument service getter.
 *
 * Providers are counted even while their current value is null. This prevents
 * startup timing from temporarily routing one app to another app's service.
 */
export class CompatibilityProviderRegistry<T> {
  private readonly providers = new Map<object, () => T | null>();

  constructor(readonly capability: string) {}

  /** Register or replace the provider owned by one app/plugin instance. */
  register(owner: object, provider: () => T | null): CompatibilityProviderRegistration {
    this.providers.set(owner, provider);
    let registered = true;

    return {
      unregister: () => {
        if (!registered) return;
        registered = false;
        if (this.providers.get(owner) === provider) {
          this.providers.delete(owner);
        }
      },
    };
  }

  /**
   * Resolve the only unambiguous provider.
   *
   * This intentionally throws before invoking any provider when multiple app
   * instances are registered, even if all but one currently return null.
   */
  get(): T | null {
    if (this.providers.size === 0) return null;
    if (this.providers.size > 1) {
      throw new ZeroRuntimeAmbiguousError(this.capability, this.providers.size);
    }

    return this.providers.values().next().value?.() ?? null;
  }

  /** Number of configured providers, primarily for diagnostics and tests. */
  get size(): number {
    return this.providers.size;
  }
}
