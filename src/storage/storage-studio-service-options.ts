/**
 * storage-studio-service-options.ts
 *
 * Defines the infrastructure dependencies shared by Storage Studio domain
 * services. It intentionally contains no business behavior.
 */

import type { AuthAuditService } from '../auth/auth-audit-service';
import type { ReactiveDB } from '../sync/reactive-db';
import type { ResolvedStorageStudioConfig } from './storage-config';
import type { StorageService } from './storage-service';
import type { StorageStudioLifecycleProvider } from './storage-studio-recovery-coordinator';

export interface StorageStudioServiceOptions {
  readonly db: ReactiveDB;
  readonly storage: StorageService;
  readonly config: ResolvedStorageStudioConfig;
  readonly tenancyMode: 'single' | 'multi';
  readonly audit?: AuthAuditService | null;
  readonly providerKey?: string;
  /** Optional idempotent lifecycle hooks for adapters with external namespaces. */
  readonly lifecycleProvider?: StorageStudioLifecycleProvider;
  /** Bounded provider-call deadline before a durable continuation is requeued. */
  readonly lifecycleProviderTimeoutMs?: number;
}
