/**
 * platform-doctor-options.ts
 *
 * Run-policy options kept separate from finding contracts so usage-audit
 * contracts can depend on Doctor findings without creating a type cycle.
 */

import type { UsageAuditOptions } from './usage-audit-types';

/** Options that affect doctor pass/fail policy. */
export interface PlatformDoctorOptions {
  /** Treat warnings as failures. Useful in CI. */
  strict?: boolean;
  /** Environment values used for provider checks. Defaults to process.env. */
  env?: Record<string, string | undefined>;
  /** Project root used for app-owned source usage scanning. */
  projectRoot?: string;
  /** Source usage audit options. Pass false to disable. */
  usageAudit?: boolean | UsageAuditOptions;
}
