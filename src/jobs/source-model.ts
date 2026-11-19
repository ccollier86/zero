/** Private source-owned scheduling contracts. No browser input can mint source authority. */
import type { JobWorkflowPin } from './model';
import type { WorkflowDeferredStartInspection } from '../workflows/workflow-deferred-start-contract';
import { JobsError } from './error';
import { jobDigest as digest, jobHash, jobInteger, jobRecord, jobScope, jobText } from './validation';

/** Stable physical ownership, not a session, user ID, path or display name. */
export interface JobSourceIdentity {
  readonly domain: string; readonly databaseId: string; readonly ownerId: string;
  readonly rootHash: string; readonly scopeId: string;
}
export interface JobSourceContract {
  readonly identity: JobSourceIdentity;
  readonly realmFingerprint: string;
  readonly policyVersion: string; readonly semanticsVersion: string;
  readonly definition: Readonly<{ name: string; version: string; fingerprint: string }>;
  readonly workflow: JobWorkflowPin;
}
export interface JobSourceOrigin { readonly id: string; readonly generation: number; readonly policyHash: string }
export interface JobSourceRegistration {
  readonly id: string; readonly generation: number; readonly revision: number;
  readonly state: 'active' | 'retired'; readonly policyHash: string;
}
export interface JobSourceScheduleReceipt {
  readonly id: string; readonly sourceId: string; readonly policyGeneration: number;
  readonly control: 'active' | 'paused' | 'cancelled'; readonly revision: number; readonly generation: number;
  readonly createdAt: number; readonly updatedAt: number;
}
/** Private owner-authorized retained accounting, never a scheduling reservation. */
export interface JobRetainedCapacity { readonly used: number; readonly limit: number; readonly remaining: number }
export interface JobSourceCapacity {
  readonly version: 2;
  readonly source: { readonly id: string; readonly registered: boolean };
  readonly working: {
    readonly sourceSchedules: JobRetainedCapacity; readonly fileSchedules: JobRetainedCapacity; readonly fileOccurrences: JobRetainedCapacity;
  };
  readonly retained: {
    /** Factual lifetime count. There is no longer a per-source retained schedule ceiling. */
    readonly sourceSchedules: { readonly used: number };
    readonly file: {
      readonly schedules: JobRetainedCapacity; readonly intents: JobRetainedCapacity;
      readonly sourceRecoveryIntents: JobRetainedCapacity; readonly occurrences: JobRetainedCapacity;
      readonly sources: JobRetainedCapacity; readonly sourcePolicies: JobRetainedCapacity;
    };
  };
}
/** Read-only proof of the original permanent Torrent start, never permission for a new effect. */
export interface JobSourceExecutionEvidence {
  readonly scheduleId: string; readonly generation: number; readonly scheduledAt: number; readonly occurrenceId: string;
  readonly sourceId: string; readonly policyGeneration: number; readonly policyHash: string;
  readonly workflow: JobWorkflowPin; readonly inputHash: string;
  readonly instanceId: string; readonly status: WorkflowDeferredStartInspection['status'];
}
export function normalizeJobSourceIdentity(input: unknown): JobSourceIdentity {
  const r = jobRecord(input, ['domain', 'databaseId', 'ownerId', 'rootHash', 'scopeId']);
  const domain = jobText(r.domain, 64);
  if (!/^[a-z][a-z0-9.-]*$/.test(domain)) throw new JobsError('JOBS_INPUT_INVALID');
  return Object.freeze({ domain, databaseId: jobText(r.databaseId, 128), ownerId: jobText(r.ownerId, 128), rootHash: digest(r.rootHash), scopeId: jobScope(r.scopeId) });
}
export function jobSourceId(identity: JobSourceIdentity): string { return 'src_' + jobHash(normalizeJobSourceIdentity(identity)); }
export function normalizeJobSourceContract(input: unknown): JobSourceContract {
  const r = jobRecord(input, ['identity', 'realmFingerprint', 'policyVersion', 'semanticsVersion', 'definition', 'workflow']);
  const definition = jobRecord(r.definition, ['name', 'version', 'fingerprint']), workflow = jobRecord(r.workflow, ['name', 'version', 'definitionId', 'versionId', 'fingerprint']);
  const realmFingerprint = jobText(r.realmFingerprint, 71);
  if (!/^sha256:[a-f0-9]{64}$/.test(realmFingerprint)) throw new JobsError('JOBS_INPUT_INVALID');
  return Object.freeze({ identity: normalizeJobSourceIdentity(r.identity), realmFingerprint,
    policyVersion: jobText(r.policyVersion, 64), semanticsVersion: jobText(r.semanticsVersion, 64),
    definition: Object.freeze({ name: jobText(definition.name, 96), version: jobText(definition.version, 64), fingerprint: digest(definition.fingerprint) }),
    workflow: Object.freeze({ name: jobText(workflow.name, 200), version: jobInteger(workflow.version, 1), definitionId: jobText(workflow.definitionId, 128),
      versionId: jobText(workflow.versionId, 128), fingerprint: digest(workflow.fingerprint) }) });
}
export function normalizeJobSourceOrigin(input: unknown): JobSourceOrigin {
  const r = jobRecord(input, ['id', 'generation', 'policyHash']), id = jobText(r.id, 68);
  if (!/^src_[a-f0-9]{64}$/.test(id)) throw new JobsError('JOBS_INPUT_INVALID');
  return Object.freeze({ id, generation: jobInteger(r.generation, 1), policyHash: digest(r.policyHash) });
}
/** Human provenance is factual only. It never becomes ownership or execution authority. */
export function normalizeJobSourceInitiator(input: unknown): string | undefined {
  return input === undefined ? undefined : jobText(input, 128);
}
export function jobSourceScheduleId(identity: JobSourceIdentity, key: string): string { return 'job_' + jobHash(['source', jobSourceId(identity), key]); }
export function jobSourcePrincipal(id: string): string {
  return 'jobs:source:' + normalizeJobSourceOrigin({ id, generation: 1, policyHash: '0'.repeat(64) }).id;
}
