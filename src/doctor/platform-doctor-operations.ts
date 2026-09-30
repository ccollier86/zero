/**
 * platform-doctor-operations.ts
 *
 * Pure production-readiness diagnostics for storage key durability and the
 * observability runtime/read endpoint.
 */

import type { ResolvedConfig } from '../frontend/server/types';
import { resolveSQLiteStorageConfig } from '../persistence';
import { isStrongStorageCapabilitySigningSecret } from '../storage/storage-signing-secret';
import {
  addPlatformDoctorFinding as addFinding,
  type PlatformDoctorFindingSink,
} from './platform-doctor-contracts';

/** Validate production key durability and operator-provided HMAC strength. */
export function checkStorage(
  resolved: ResolvedConfig,
  findings: PlatformDoctorFindingSink,
  env: Record<string, string | undefined>,
): void {
  if (resolved.auth === false || !isProduction(env)) return;

  const signingSecret = resolved.storage.signingSecret;
  if (signingSecret && !isStrongStorageCapabilitySigningSecret(signingSecret)) {
    addFinding(findings, {
      severity: 'error',
      code: 'storage.signing_secret.weak',
      path: 'storage.signingSecret',
      message: 'The configured storage capability signing secret is shorter than 32 UTF-8 bytes.',
      hint: 'Inject at least 32 cryptographically random bytes through storage.signingSecret or ZERO_STORAGE_SIGNING_SECRET.',
      docs: './docs/platform-configuration.md#file-storage-capability-signing',
    });
  }

  const databaseMode = resolved.systemDb.sqlite?.mode
    ?? resolveSQLiteStorageConfig(resolved.systemDb).mode;
  if (!signingSecret && databaseMode === 'ephemeral') {
    addFinding(findings, {
      severity: 'error',
      code: 'storage.signing_secret.ephemeral_database',
      path: 'storage.signingSecret',
      message: 'Production storage cannot retain its generated capability signing key in an ephemeral database.',
      hint: 'Configure storage.signingSecret or ZERO_STORAGE_SIGNING_SECRET with at least 32 random bytes, or use a durable system database.',
      docs: './docs/platform-configuration.md#file-storage-capability-signing',
    });
  }
}

/** Validate observability runtime and endpoint access policy against env/auth. */
export function checkObservability(
  resolved: ResolvedConfig,
  findings: PlatformDoctorFindingSink,
  env: Record<string, string | undefined>,
): void {
  const config = resolved.observability;
  if (config === false || config?.enabled === false) {
    if (isProduction(env)) {
      addFinding(findings, {
        severity: 'warning',
        code: 'observability.disabled.production',
        path: 'observability',
        message: 'Observability is disabled in a production environment.',
        hint: 'Leave observability enabled or install a custom sink so production errors and warnings have a routed destination.',
        docs: './docs/observability.md',
      });
    }
    return;
  }

  const endpoint = config?.endpoint;
  if (endpoint === false || endpoint?.enabled === false) return;

  const readMode = endpoint?.read ?? (resolved.auth !== false ? 'admin' : 'development');
  if (resolved.auth === false && (readMode === 'admin' || readMode === 'admin-or-dev')) {
    addFinding(findings, {
      severity: 'warning',
      code: 'observability.endpoint.requires_auth',
      path: 'observability.endpoint.read',
      message: `Observability endpoint read mode "${readMode}" requires auth, but auth is disabled.`,
      hint: 'Enable auth, use read: "development" for local-only reads, or provide a custom read callback.',
      docs: './docs/observability.md#default-http-endpoint',
    });
  }

  if (isProduction(env) && readMode === 'development') {
    addFinding(findings, {
      severity: 'warning',
      code: 'observability.endpoint.development_read_production',
      path: 'observability.endpoint.read',
      message: 'Observability endpoint read access is development-only while NODE_ENV is production.',
      hint: 'Use auth with the default admin read mode, set read: "admin", or provide a custom read callback.',
      docs: './docs/observability.md#default-http-endpoint',
    });
  }

  if (config?.store === false) {
    addFinding(findings, {
      severity: 'warning',
      code: 'observability.endpoint.store_disabled',
      path: 'observability.store',
      message: 'The observability endpoint is enabled, but the readable event store is disabled.',
      hint: 'Enable the default store, provide a custom PlatformEventStore, or disable observability.endpoint.',
      docs: './docs/observability.md#default-http-endpoint',
    });
  }
}

/** Return whether the supplied env map represents production mode. */
function isProduction(env: Record<string, string | undefined>): boolean {
  return env.NODE_ENV === 'production';
}
