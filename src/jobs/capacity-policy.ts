/** Trusted finite operational policy. Importing/resolving it creates no storage or actors. */
import type { DatabaseWriteCommandContext } from '../databases/database-realm';
import type { DatabaseSerializableValue } from '../databases/database-operations';
import { JobsError } from './error';
import { jobInteger, jobRecord } from './validation';

export interface JobsRetainedCapacityPolicy {
  readonly schedules: number; readonly schedulesPerOwner: number; readonly intents: number;
  readonly actorRecoveryIntents: number; readonly sourceRecoveryIntents: number;
  readonly occurrences: number; readonly sources: number; readonly sourcePolicies: number;
}
export interface JobsCapacityPolicy { readonly retained: JobsRetainedCapacityPolicy; readonly transport: { readonly keyLimit: number } }
export interface JobsCapacityConfig { readonly retained?: Partial<JobsRetainedCapacityPolicy>; readonly transport?: { readonly keyLimit?: number } }
export const DEFAULT_JOBS_CAPACITY_POLICY: JobsCapacityPolicy = Object.freeze({
  retained: Object.freeze({ schedules: 10_000, schedulesPerOwner: 1_000, intents: 100_000, actorRecoveryIntents: 20_000,
    sourceRecoveryIntents: 21_024, occurrences: 100_000, sources: 1_024, sourcePolicies: 10_000 }),
  transport: Object.freeze({ keyLimit: 1_000_000 }),
});
export function normalizeJobsCapacityPolicy(input?: unknown): JobsCapacityPolicy {
  try {
    const r = input === undefined ? {} : jobRecord(input, ['retained', 'transport']);
    const retained = r.retained === undefined ? {} : jobRecord(r.retained, Object.keys(DEFAULT_JOBS_CAPACITY_POLICY.retained));
    const transport = r.transport === undefined ? {} : jobRecord(r.transport, ['keyLimit']);
    return Object.freeze({ retained: Object.freeze(Object.fromEntries(Object.entries(DEFAULT_JOBS_CAPACITY_POLICY.retained)
      .map(([key, fallback]) => [key, jobInteger(retained[key] === undefined ? fallback : retained[key], 1)])) as unknown as JobsRetainedCapacityPolicy),
      transport: Object.freeze({ keyLimit: jobInteger(transport.keyLimit === undefined ? 1_000_000 : transport.keyLimit, 1, 1_000_000) }) });
  } catch { throw new JobsError('JOBS_CONFIG_INVALID'); }
}
export function jobCapacityPolicy(context: Pick<DatabaseWriteCommandContext, 'writerPolicy'>): JobsCapacityPolicy {
  return context.writerPolicy === undefined ? DEFAULT_JOBS_CAPACITY_POLICY : context.writerPolicy as unknown as JobsCapacityPolicy;
}
export function jobCapacityPolicyData(policy: JobsCapacityPolicy): DatabaseSerializableValue { return policy as unknown as DatabaseSerializableValue; }
export function jobHistoryLimit(context: DatabaseWriteCommandContext, key: string, fallback: number): number {
  const p = jobCapacityPolicy(context).retained;
  if (key.startsWith('owner:')) return p.schedulesPerOwner;
  const fields: Readonly<Record<string, keyof JobsRetainedCapacityPolicy>> = { schedules: 'schedules', intents: 'intents', actorRecoveryIntents: 'actorRecoveryIntents', sourceRecoveryIntents: 'sourceRecoveryIntents',
    occurrences: 'occurrences', sources: 'sources', 'source-policies': 'sourcePolicies' };
  const field = fields[key];
  return field === undefined ? fallback : p[field];
}
