/**
 * usage-audit-types.ts
 *
 * Shared type contracts for Doctor's app source usage audit.
 */

import type { ResolvedConfig } from '../frontend/server/types';
import type {
  PlatformDoctorFinding,
  PlatformDoctorSeverity,
} from './platform-doctor';

export type UsageAuditRuleSeverity = PlatformDoctorSeverity | 'off';

/** Per-rule allow entry for deliberate escape hatches. */
export interface UsageAuditAllowEntry {
  code: string;
  path: string;
}

/** Options for doctor source usage scanning. */
export interface UsageAuditOptions {
  enabled?: boolean;
  include?: string[];
  exclude?: string[];
  maxFileLines?: number;
  rules?: Record<string, UsageAuditRuleSeverity>;
  allow?: UsageAuditAllowEntry[];
}

export interface RunUsageAuditInput {
  projectRoot: string;
  resolvedConfig: ResolvedConfig;
  options?: boolean | UsageAuditOptions;
}

export interface NormalizedUsageAuditOptions {
  enabled: boolean;
  include?: string[];
  exclude: string[];
  maxFileLines: number;
  rules: Record<string, UsageAuditRuleSeverity>;
  allow: UsageAuditAllowEntry[];
}

export interface SourceFile {
  absolutePath: string;
  relativePath: string;
  source: string;
  lines: string[];
  isFrontend: boolean;
  isBackend: boolean;
}

export interface UsageRule {
  code: string;
  docs?: string;
  hint: string;
  message: (file: SourceFile) => string;
  matches: RegExp[];
  appliesTo: (file: SourceFile) => boolean;
}

export type UsageAuditFinding = PlatformDoctorFinding;
