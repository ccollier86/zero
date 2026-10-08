/** Source-only Doctor contracts. No executable application configuration is accepted. */
import type { PlatformDoctorReport } from './platform-doctor-contracts';
import type { UsageAuditAllowEntry, UsageAuditRuleSeverity } from './usage-audit-types';

/** Explicit filesystem roots and scoped policy; source inspection never imports app modules. */
export interface SourceOnlyDoctorOptions {
  readonly projectRoot: string;
  /** Replaces convention roots; absolute/external roots must be explicitly listed. */
  readonly include?: readonly string[];
  readonly exclude?: readonly string[];
  readonly rules?: Readonly<Record<string, UsageAuditRuleSeverity>>;
  readonly allow?: readonly UsageAuditAllowEntry[];
  readonly maxFileLines?: number;
  readonly strict?: boolean;
}

/** Inspected package metadata/capabilities, not an assumption from Doctor's own version. */
export interface SourceOnlyFrameworkInspection {
  readonly status: 'installed' | 'workspace' | 'missing' | 'unavailable';
  readonly version: string | null;
  readonly publicExports: readonly string[];
  readonly modalShow: boolean | null;
}

/** A clean source result is not a runtime/layout/accessibility qualification. */
export interface SourceOnlyDoctorReport extends PlatformDoctorReport {
  readonly mode: 'source-only';
  readonly scannedFiles: number;
  readonly installedFramework: SourceOnlyFrameworkInspection;
}

export interface SourceOnlyFile {
  readonly path: string;
  readonly source: string;
}
