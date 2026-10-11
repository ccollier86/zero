/** Static upgrade evidence. No application modules, configuration or runtime data are evaluated. */
import type { PlatformDoctorFinding, PlatformDoctorSeverity } from './platform-doctor-contracts';

export type SourceOnlyUpgradeOption = boolean | { readonly targetRoot?: string };
export type UpgradeEvidenceStatus = 'available' | 'missing' | 'unknown';
export type UpgradeCapability = 'modalShow' | 'dropdownInnerViewport' | 'popoverViewport' | 'contentCard' | 'selectRichSlots';
export type UpgradeExportKind = 'value' | 'any';

/** Missing requires a complete static proof; an unreadable or dynamic source remains unknown. */
export interface UpgradeExportEvidence {
  readonly status: UpgradeEvidenceStatus;
  readonly reason?: 'not-public' | 'not-exported' | 'unresolved-source' | 'ambiguous-star' | 'private-target' | 'parse-error' | 'inspection-limit';
}

/** The fingerprint covers bounded public source inspection, not every file in the package. */
export interface UpgradeTargetSummary {
  readonly status: 'installed' | 'workspace' | 'explicit' | 'missing' | 'unavailable';
  readonly version: string | null;
  readonly fingerprint: {
    readonly algorithm: 'sha256';
    readonly scope: 'bounded-public-source';
    readonly value: string | null;
    readonly complete: boolean;
    readonly files: number;
  };
  readonly capabilities: Readonly<Record<UpgradeCapability, UpgradeEvidenceStatus>>;
}

export interface SourceOnlyUpgradeTargetInspection {
  readonly summary: UpgradeTargetSummary;
  readonly findings: readonly PlatformDoctorFinding[];
  inspectNamedExport(specifier: string, name: string, kind?: UpgradeExportKind): Promise<UpgradeExportEvidence>;
}

/** Pure catalog metadata; each detector must establish applicability using the inspected target. */
export interface UpgradeCatalogEntry {
  readonly id: string;
  readonly detector: 'named-export' | 'dropdown-scroll-owner' | 'popover-scroll-body' | 'relative-asset' | 'chart-dependency' | 'chart-usage';
  readonly code: string;
  readonly capability?: UpgradeCapability;
  readonly category: 'required' | 'recommended' | 'manual-review';
  readonly severity: PlatformDoctorSeverity;
  readonly docs: string;
  readonly hint: string;
}
