/** Payload-safe public jobs facade. Private inputs/seals/actor handles and caller-selected scope never appear in views. */
import type { JobDefinition, JobDefinitionValue } from './definition';
import type { JobScheduleView } from './realm-model';
import type { ScheduleTiming } from './schedule-time';
import type { JobAdmission } from './model';
export type { JobScheduleView } from './realm-model';
export interface JobRequestOptions { readonly idempotencyKey: string; readonly signal?: AbortSignal }
export interface JobControlOptions extends JobRequestOptions { readonly expectedRevision: number }
export interface JobScheduleInput {
  readonly definition: string | JobDefinition; readonly input?: unknown; readonly timing: unknown;
  readonly overlap?: JobAdmission['overlap']; readonly ownership?: JobAdmission['runAs'];
}
export interface JobEnqueueOptions extends JobRequestOptions {
  readonly ownership?: JobAdmission['runAs']; readonly maxLatenessMs?: number;
}
/** Code registration and current access only; service eligibility/input/workflow admission still run on mutations. */
export interface JobDefinitionView {
  readonly name: string; readonly version: string; readonly default: boolean;
  readonly ownership: { readonly actor: true; readonly service: boolean };
}
export interface JobDefinitionPage { readonly items: readonly JobDefinitionView[] }
export type JobBlockedCode = 'JOBS_CAPACITY' | 'JOBS_AUTHORITY_RETIRED' | 'JOBS_DEFINITION_UNAVAILABLE';
export type JobActionUnavailableReason = 'cancelled' | 'owner-required' | 'definition-unavailable' | 'access-denied' | 'ownership-unavailable';
/** Advisory current prerequisites, not proof that input, timing, service eligibility or an effect will succeed. */
export type JobActionAvailability = { readonly allowed: true; readonly reason: null }
  | { readonly allowed: false; readonly reason: JobActionUnavailableReason };
export interface JobScheduleActions {
  readonly pause: JobActionAvailability; readonly cancel: JobActionAvailability; readonly resume: JobActionAvailability;
  readonly update: JobActionAvailability; readonly runNow: JobActionAvailability;
}
/** Read projection only. Accepted mutation/receipt acknowledgments remain the original JobScheduleView. */
export interface JobScheduleSummary extends JobScheduleView {
  readonly nextDueAt: number | null; readonly skipped: boolean; readonly blockedCode: JobBlockedCode | null;
  readonly latestOccurrence: JobOccurrenceView | null;
  /** One claimed/dispatched representative, preferring the oldest active generation. Not an active-work count. */
  readonly activeOccurrence: JobOccurrenceView | null;
  readonly actions: JobScheduleActions;
}
export interface JobScheduleDetail extends JobScheduleSummary {
  readonly timing: ScheduleTiming; readonly overlap: JobAdmission['overlap'];
}
export interface JobPageOptions { readonly limit?: number; readonly offset?: number; readonly control?: 'active' | 'paused' | 'cancelled' }
export interface JobSchedulePage { readonly items: readonly JobScheduleSummary[]; readonly total: number }
export interface JobWatchOptions { readonly query?: JobPageOptions; readonly signal?: AbortSignal; readonly onError?: (error: unknown) => void }
export interface JobOccurrenceView {
  readonly id: string; readonly generation: number; readonly scheduledAt: number; readonly state: 'pending' | 'claimed' | 'dispatched' | 'terminal' | 'blocked' | 'cancelled';
  readonly workflowId: string | null; readonly terminalStatus: string | null; readonly errorCode: string | null; readonly createdAt: number; readonly updatedAt: number;
}
export interface ScopedJobs {
  enqueue<Definition extends JobDefinition>(definition: Definition, input: JobDefinitionValue<NoInfer<Definition>>, options: JobEnqueueOptions): Promise<JobScheduleView>;
  enqueue(definition: string, input: unknown, options: JobEnqueueOptions): Promise<JobScheduleView>;
  readonly definitions: { list(): Promise<JobDefinitionPage> };
  readonly receipts: { get(idempotencyKey: string): Promise<JobScheduleView | null> };
  readonly schedules: {
    create(input: JobScheduleInput, options: JobRequestOptions): Promise<JobScheduleView>;
    get(id: string): Promise<JobScheduleDetail>;
    list(options?: JobPageOptions): Promise<JobSchedulePage>;
    /** Actual committed changes coalesce into a fresh current-authority page. Denial ends the subscription. */
    watch(listener: (page: JobSchedulePage) => void, options?: JobWatchOptions): () => void;
    occurrences(id: string, options?: Pick<JobPageOptions, 'limit' | 'offset'>): Promise<{ readonly items: readonly JobOccurrenceView[]; readonly total: number }>;
    update(id: string, input: Partial<JobScheduleInput>, options: JobControlOptions): Promise<JobScheduleView>;
    resume(id: string, options: JobControlOptions): Promise<JobScheduleView>;
    pause(id: string, options: JobControlOptions): Promise<JobScheduleView>;
    cancel(id: string, options: JobControlOptions): Promise<JobScheduleView>;
    runNow(id: string, options: JobControlOptions): Promise<JobScheduleView>;
  };
}
