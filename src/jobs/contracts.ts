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
export interface JobScheduleDetail extends JobScheduleView {
  readonly timing: ScheduleTiming; readonly overlap: JobAdmission['overlap']; readonly nextDueAt: number | null;
  readonly skipped: boolean; readonly blockedCode: string | null;
}
export interface JobPageOptions { readonly limit?: number; readonly offset?: number; readonly control?: 'active' | 'paused' | 'cancelled' }
export interface JobSchedulePage { readonly items: readonly JobScheduleView[]; readonly total: number }
export interface JobWatchOptions { readonly query?: JobPageOptions; readonly signal?: AbortSignal; readonly onError?: (error: unknown) => void }
export interface JobOccurrenceView {
  readonly id: string; readonly generation: number; readonly scheduledAt: number; readonly state: 'pending' | 'claimed' | 'dispatched' | 'terminal' | 'blocked' | 'cancelled';
  readonly workflowId: string | null; readonly terminalStatus: string | null; readonly errorCode: string | null; readonly createdAt: number; readonly updatedAt: number;
}
export interface ScopedJobs {
  enqueue<Definition extends JobDefinition>(definition: Definition, input: JobDefinitionValue<NoInfer<Definition>>, options: JobEnqueueOptions): Promise<JobScheduleView>;
  enqueue(definition: string, input: unknown, options: JobEnqueueOptions): Promise<JobScheduleView>;
  readonly receipts: { get(idempotencyKey: string): Promise<JobScheduleView | null> };
  readonly schedules: {
    create(input: JobScheduleInput, options: JobRequestOptions): Promise<JobScheduleView>;
    get(id: string): Promise<JobScheduleDetail>;
    list(options?: JobPageOptions): Promise<{ readonly items: readonly JobScheduleView[]; readonly total: number }>;
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
