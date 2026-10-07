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
  /**
   * Opt into filesystem checks and supply the config origin when config.projectRoot
   * is omitted. Explicit config roots must agree.
   */
  projectRoot?: string;
  /** Source usage audit options. Pass false to disable. */
  usageAudit?: boolean | UsageAuditOptions;
}
