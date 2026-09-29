/** Persistent actor binding ownership for one tenant-Sync socket bridge. */

import type {
  SyncTenantDataPlane,
  SyncTenantDataPlaneBinding,
  SyncTenantDataPlaneWakeup,
} from './sync-tenant-data-plane-contract';
import { syncTenantDataPlaneError } from './sync-tenant-data-plane-error';
import {
  SyncTenantSubscriptionSupersededError,
  validateTenantSyncBinding,
} from './sync-tenant-data-plane-validation';
import type { SyncAuthContext } from './types';

interface SyncTenantBindingControllerOptions {
  readonly plane: SyncTenantDataPlane;
  readonly authContext: SyncAuthContext;
  readonly assertCurrentAuthoritySync: () => undefined;
  readonly assertCurrentReadAuthoritySync: () => undefined;
  readonly activeMutationAuthorityFingerprint: () => string | null;
  readonly assertMutationAuthoritySync?: (fingerprint: string) => undefined;
  readonly onWakeup: (wakeup: SyncTenantDataPlaneWakeup) => void;
  readonly onDetached: () => void;
  readonly isDisposed: () => boolean;
}

/**
 * Owns the one published binding, pending bind, wakeup listener, and release
 * revision. Socket subscription, replay, and mutation state remain in the
 * bridge which consumes this controller.
 */
export class SyncTenantBindingController {
  readonly #options: SyncTenantBindingControllerOptions;
  #binding: SyncTenantDataPlaneBinding | null = null;
  #bindingTask: Promise<SyncTenantDataPlaneBinding> | null = null;
  #revision = 0;
  #unsubscribe: (() => void) | null = null;

  constructor(options: SyncTenantBindingControllerOptions) {
    this.#options = options;
  }

  get current(): SyncTenantDataPlaneBinding | null {
    return this.#binding;
  }

  async ensure(): Promise<SyncTenantDataPlaneBinding> {
    if (this.#options.isDisposed()) {
      throw syncTenantDataPlaneError(
        'SYNC_TENANT_SOCKET_CLOSED',
        'Tenant Sync socket is closed.',
      );
    }
    if (this.#binding) return this.#binding;
    if (this.#bindingTask) return await this.#bindingTask;

    const authority = (): undefined => {
      this.#options.assertCurrentAuthoritySync();
      const fingerprint = this.#options.activeMutationAuthorityFingerprint();
      if (fingerprint) {
        this.#options.assertMutationAuthoritySync?.(fingerprint);
      }
      return undefined;
    };
    const readAuthority = (): undefined => {
      this.#options.assertCurrentReadAuthoritySync();
      const fingerprint = this.#options.activeMutationAuthorityFingerprint();
      if (fingerprint) {
        this.#options.assertMutationAuthoritySync?.(fingerprint);
      }
      return undefined;
    };
    const revision = this.#revision;
    const task = this.#options.plane.bind(Object.freeze({
      authContext: this.#options.authContext,
      assertCurrentAuthoritySync: authority,
      assertCurrentReadAuthority: readAuthority,
    })).then((binding) => this.#publish(binding, revision));
    this.#bindingTask = task;
    try {
      return await task;
    } finally {
      if (this.#bindingTask === task) this.#bindingTask = null;
    }
  }

  detach(): void {
    this.#revision += 1;
    const unsubscribe = this.#unsubscribe;
    this.#unsubscribe = null;
    try { unsubscribe?.(); } catch { /* Preserve binding release. */ }

    const binding = this.#binding;
    this.#binding = null;
    if (binding) {
      try { binding.release(); } catch { /* Socket cleanup is best effort. */ }
    }
    // A pending bind observes the revision before it can publish itself and
    // releases the newly created capability in its own failure path.
    this.#bindingTask = null;
    this.#options.onDetached();
  }

  #publish(
    binding: SyncTenantDataPlaneBinding,
    revision: number,
  ): SyncTenantDataPlaneBinding {
    let unsubscribe: (() => void) | null = null;
    try {
      if (this.#options.isDisposed() || revision !== this.#revision) {
        throw new SyncTenantSubscriptionSupersededError();
      }
      validateTenantSyncBinding(binding);
      // Subscribe before publishing the capability. A release before this
      // continuation is detected below; synchronous listener installation
      // cannot interleave another JavaScript invalidation.
      const installed = binding.onWakeup(this.#options.onWakeup);
      if (typeof installed !== 'function') {
        throw syncTenantDataPlaneError(
          'SYNC_TENANT_WAKEUP_INVALID',
          'Tenant Sync wakeup subscription is invalid.',
        );
      }
      unsubscribe = installed;
      if (this.#options.isDisposed()
        || revision !== this.#revision
        || binding.released) {
        throw syncTenantDataPlaneError(
          'SYNC_TENANT_BINDING_UNAVAILABLE',
          'Tenant Sync binding is unavailable.',
        );
      }
      this.#binding = binding;
      this.#unsubscribe = unsubscribe;
      return binding;
    } catch (error) {
      try { unsubscribe?.(); } catch { /* Preserve the binding failure. */ }
      try { binding.release(); } catch { /* Already closed. */ }
      throw error;
    }
  }
}
