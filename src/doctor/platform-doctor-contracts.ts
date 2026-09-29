/**
 * platform-doctor-contracts.ts
 *
 * Public Doctor result contracts and the append-only sink shared by focused
 * configuration checkers. Checker modules depend on this file instead of the
 * platform-doctor orchestrator, which keeps their dependency graph acyclic.
 */

export type PlatformDoctorSeverity = 'info' | 'warning' | 'error';

/** Structured finding emitted by the platform doctor. */
export interface PlatformDoctorFinding {
  severity: PlatformDoctorSeverity;
  code: string;
  message: string;
  path?: string;
  hint?: string;
  docs?: string;
}

/** Platform doctor result. */
export interface PlatformDoctorReport {
  findings: PlatformDoctorFinding[];
  ok: boolean;
}

/**
 * Narrow append-only capability supplied to each checker.
 *
 * The frozen facade prevents a domain checker from replacing the collection
 * or depending on orchestration state while retaining Array#push ergonomics
 * for mechanically extracted checks.
 */
export interface PlatformDoctorFindingSink {
  readonly push: (...findings: PlatformDoctorFinding[]) => number;
}

/** Create an immutable append-only facade over an orchestrator-owned array. */
export function createPlatformDoctorFindingSink(
  findings: PlatformDoctorFinding[],
): PlatformDoctorFindingSink {
  return Object.freeze({
    push: (...next: PlatformDoctorFinding[]) => findings.push(...next),
  });
}

/** Append one structured finding through the narrow checker capability. */
export function addPlatformDoctorFinding(
  sink: PlatformDoctorFindingSink,
  finding: PlatformDoctorFinding,
): void {
  sink.push(finding);
}
