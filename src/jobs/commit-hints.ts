/** Private, content-free revalidation hints from actual committed view changes, not ticks or receipt replay. */
import type { DatabaseWriteCommandContext, DatabaseWriteCommandHandler, DatabaseWriteCommandRegistry } from '../databases/database-realm';
import { jobHash, jobRecord, jobText } from './validation';

export interface JobCommitHint { readonly scheduleId: string; readonly ownerId: string }
export function withJobCommitHints(commands: DatabaseWriteCommandRegistry): DatabaseWriteCommandRegistry {
  return Object.fromEntries(Object.entries(commands).map(([name, handler]) => [name, ((context, input) => {
    if (name === 'jobs.owner.bind') return handler(context, input);
    const before = capture(context, name, input), result = handler(context, input), after = capture(context, name, input);
    if (!after || before?.hash === after.hash) return result;
    return { ...(result as object), hint: { scheduleId: after.id, ownerId: after.ownerId } } as never;
  }) satisfies DatabaseWriteCommandHandler]));
}
export function readJobCommitHint(input: unknown): JobCommitHint {
  const r = jobRecord(input, ['scheduleId', 'ownerId']); return { scheduleId: jobText(r.scheduleId, 96), ownerId: jobText(r.ownerId, 128) };
}
function capture({ db }: DatabaseWriteCommandContext, name: string, input: unknown) {
  const r = input as Record<string, unknown>;
  let id = name === 'jobs.schedule.create' ? (r.admission as Record<string, unknown>)?.id : r.id;
  const occurrence = !['jobs.schedule.create', 'jobs.schedule.change', 'jobs.materialize', 'jobs.cursor.block'].includes(name) && typeof id === 'string' ? db.get('_jobs_occurrences', id) : null;
  if (occurrence) id = occurrence.schedule_id;
  if (typeof id !== 'string') return null;
  const row = db.get('job_schedules', id), cursor = db.get('_jobs_cursors', id);
  // Source-owned private work must not fabricate a human owner or leak an
  // advisory invalidation through a human operator subscription.
  if (!row || typeof row.actor_id !== 'string' || row.source_id != null) return null;
  return { id, ownerId: String(row.actor_id), hash: jobHash([row, cursor,
    occurrence ? [occurrence.id, occurrence.state, occurrence.workflow_id, occurrence.terminal_status, occurrence.error_code] : null]) };
}
