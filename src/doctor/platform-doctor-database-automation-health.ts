/**
 * platform-doctor-database-automation-health.ts
 *
 * Converts aggregate ReactiveDB automation worker health into privacy-safe
 * Doctor findings. It does not inspect outbox rows, payloads, leases, or IDs.
 */

import {
  addPlatformDoctorFinding as addFinding,
  type PlatformDoctorFindingSink,
} from './platform-doctor-contracts';

export interface DatabaseAutomationOperationalHealth {
  /** Work eligible for a future claim. */
  readonly pending: number;
  /** Work currently held by a live worker lease. */
  readonly processing: number;
  /** Terminal effects requiring operator intervention. */
  readonly dead: number;
  /** Expired leases not yet reclaimed by the dispatcher. */
  readonly staleLeases: number;
  /** Total non-terminal work, including delayed retry work. */
  readonly backlog: number;
  /** Optional configured hard capacity for non-terminal work. */
  readonly backlogLimit?: number;
  /** Optional warning threshold chosen by the deployment operator. */
  readonly warningBacklog?: number;
}

const DOCS = './docs/framework/reactive-database-automations.md#operations-and-diagnostics';

/** Emit aggregate outbox/dispatcher health without exposing work contents. */
export function checkDatabaseAutomationOperationalHealth(
  health: DatabaseAutomationOperationalHealth,
  findings: PlatformDoctorFindingSink,
  path = 'databaseAutomations.health',
): void {
  const normalized = normalizeHealth(health);
  if (!normalized) {
    addFinding(findings, {
      severity: 'error',
      code: 'database.automations.health.invalid',
      path,
      message: 'Database automation operational health contains invalid aggregate counters.',
      hint: 'Return non-negative safe-integer counts and positive backlog thresholds from the automation health adapter.',
      docs: DOCS,
    });
    return;
  }

  if (normalized.dead > 0) {
    addFinding(findings, {
      severity: 'error',
      code: 'database.automations.outbox.dead',
      path,
      message: `${count(normalized.dead, 'durable effect')} reached terminal dead-letter state.`,
      hint: 'Inspect privacy-safe automation failure codes, repair the underlying handler or service, then deliberately recreate or reconcile the affected business action; dead deliveries are terminal.',
      docs: DOCS,
    });
  }

  if (normalized.staleLeases > 0) {
    addFinding(findings, {
      severity: 'error',
      code: 'database.automations.outbox.stale_leases',
      path,
      message: `${count(normalized.staleLeases, 'automation lease')} expired without being reclaimed.`,
      hint: 'Verify the dispatcher recovery loop is running and can reopen every source database before admitting more durable work.',
      docs: DOCS,
    });
  }

  if (normalized.backlogLimit !== null
    && normalized.backlog > normalized.backlogLimit) {
    addFinding(findings, {
      severity: 'error',
      code: 'database.automations.outbox.capacity_exceeded',
      path,
      message: `The automation backlog (${normalized.backlog}) exceeds its configured capacity (${normalized.backlogLimit}).`,
      hint: 'Stop new durable admissions, verify the aggregate health source, and drain or repair the dispatcher before raising capacity.',
      docs: DOCS,
    });
  } else if (normalized.warningBacklog !== null
    && normalized.backlog >= normalized.warningBacklog) {
    addFinding(findings, {
      severity: 'warning',
      code: 'database.automations.outbox.backlog_high',
      path,
      message: `The automation backlog is ${normalized.backlog}, at or above the configured warning threshold of ${normalized.warningBacklog}.`,
      hint: 'Check worker throughput, retry pressure, downstream availability, and source-database actor capacity before the hard limit is reached.',
      docs: DOCS,
    });
  }

  addFinding(findings, {
    severity: 'info',
    code: normalized.backlog > 0
      ? 'database.automations.outbox.active'
      : 'database.automations.outbox.idle',
    path,
    message: normalized.backlog > 0
      ? `Automation delivery has ${normalized.pending} pending, ${normalized.processing} processing, and ${normalized.backlog} total non-terminal effect${normalized.backlog === 1 ? '' : 's'}.`
      : 'Automation delivery has no pending, processing, or delayed durable effects.',
    ...(normalized.backlog > 0
      ? {
          hint: 'Monitor this aggregate alongside throughput and retry telemetry; do not inspect or log effect payloads through Doctor.',
        }
      : {}),
    docs: DOCS,
  });
}

interface NormalizedHealth {
  readonly pending: number;
  readonly processing: number;
  readonly dead: number;
  readonly staleLeases: number;
  readonly backlog: number;
  readonly backlogLimit: number | null;
  readonly warningBacklog: number | null;
}

function normalizeHealth(
  input: DatabaseAutomationOperationalHealth,
): NormalizedHealth | null {
  if (!isCount(input.pending)
    || !isCount(input.processing)
    || !isCount(input.dead)
    || !isCount(input.staleLeases)
    || !isCount(input.backlog)) {
    return null;
  }
  const backlogLimit = input.backlogLimit === undefined
    ? null
    : positiveCount(input.backlogLimit);
  const warningBacklog = input.warningBacklog === undefined
    ? backlogLimit === null || backlogLimit === false
      ? null
      : Math.max(1, Math.ceil(backlogLimit * 0.8))
    : positiveCount(input.warningBacklog);
  if (backlogLimit === false || warningBacklog === false) return null;
  if (backlogLimit !== null
    && warningBacklog !== null
    && warningBacklog > backlogLimit) {
    return null;
  }
  if (input.backlog < input.pending + input.processing) return null;
  return Object.freeze({
    pending: input.pending,
    processing: input.processing,
    dead: input.dead,
    staleLeases: input.staleLeases,
    backlog: input.backlog,
    backlogLimit,
    warningBacklog,
  });
}

function isCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function positiveCount(value: unknown): number | false {
  return Number.isSafeInteger(value) && (value as number) > 0
    ? value as number
    : false;
}

function count(value: number, noun: string): string {
  return `${value} ${noun}${value === 1 ? ' has' : 's have'}`;
}
