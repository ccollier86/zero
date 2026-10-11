/** Source-only Doctor contracts. No executable application configuration is accepted. */
import type { PlatformDoctorReport } from './platform-doctor-contracts';
import type { UsageAuditAllowEntry, UsageAuditRuleSeverity } from './usage-audit-types';
import type { SourceOnlyThemeSummary } from './source-only-theme-checks';
import type { SourceOnlyUpgradeOption, UpgradeTargetSummary } from './source-only-upgrade-types';

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
  /** Opt-in backing-theme/source checks; no stylesheet or default is activated. */
  readonly themeFoundation?: boolean;
  /** Opt-in installed/explicit-target contract audit; never executes migrations or rewrites app source. */
  readonly upgrade?: SourceOnlyUpgradeOption;
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
  readonly themeFoundation?: SourceOnlyThemeSummary;
  readonly upgrade?: SourceOnlyUpgradeSummary;
}

/** Bounded catalog evidence, not proof that every future upgrade or runtime behavior is covered. */
export interface SourceOnlyUpgradeSummary {
  readonly catalogVersion: number;
  readonly target: UpgradeTargetSummary;
  readonly applicableMigrations: readonly string[];
  readonly checkedImports: number;
  readonly checkedAssets: number;
  readonly reviewAssets: number;
  /** Proven dependency/renderer candidates, informational by default; not a count of missing imports. */
  readonly chartReviews: number;
  readonly usage: {
    readonly inspectedFiles: number;
    readonly publicBindings: number;
    readonly checkedNamedExports: number;
    readonly unresolvedLocalBindings: number;
    readonly behaviorReviews: number;
  };
  readonly reviewCounts: { readonly required: number; readonly recommended: number; readonly manualReview: number };
  readonly coverage: 'bounded-static';
  readonly limitations: readonly string[];
}

export interface SourceOnlyFile {
  readonly path: string;
  /** Optional admitted canonical root-relative identity; path remains the diagnostic label. */
  readonly resolutionPath?: string;
  readonly source: string;
}
