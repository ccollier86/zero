/** Native transport over exactly the same current-authority jobs facade used by app handlers. */
import { t } from 'elysia';
import { createServerExtensionApp, defineEndpoint, defineRouter } from '../frontend/server/server-extensions';
import type { ZeroAppRuntime } from '../runtime/zero-app-runtime';
import type { JobControlOptions, JobPageOptions, JobRequestOptions, JobScheduleInput } from './contracts';
import { JobsError } from './error';
import { jobRecord } from './validation';
import { jobScheduleStream } from './stream';

const key = t.String({ minLength: 1, maxLength: 128 }), id = t.String({ minLength: 1, maxLength: 96 });
const page = t.Object({ limit: t.Optional(t.Numeric({ minimum: 1, maximum: 100 })), offset: t.Optional(t.Numeric({ minimum: 0, maximum: 100000 })) }, { additionalProperties: false });
export async function createJobsHttp(runtime: ZeroAppRuntime) {
  return createServerExtensionApp({ runtime, name: 'zero.jobs.http', extensions: [defineRouter({ name: 'zero.jobs', prefix: '/jobs',
    auth: { user: 'required', credentials: ['session'] }, endpoints: [
      // Keep the raw JSON object: Elysia's default object normalization removes
      // undeclared keys before the broker can reject caller scope/authority.
      defineEndpoint({ method: 'POST', path: '/enqueue', body: t.Unknown(),
      async handler({ zero, body }) {
        if (!zero.jobs) throw new JobsError('JOBS_NOT_READY');
        const r = jobRecord(body, ['definition', 'input', 'idempotencyKey', 'ownership', 'maxLatenessMs']);
        return Response.json(await zero.jobs.enqueue(r.definition as string, r.input,
          { idempotencyKey: r.idempotencyKey as string, ...(r.ownership === undefined ? {} : { ownership: r.ownership as 'actor' | 'service' }),
            ...(r.maxLatenessMs === undefined ? {} : { maxLatenessMs: r.maxLatenessMs as number }) }), { status: 202 });
      } }),
      defineEndpoint({ method: 'GET', path: '/receipts/:key', params: t.Object({ key }), async handler({ zero, params }) {
        if (!zero.jobs) throw new JobsError('JOBS_NOT_READY'); return { receipt: await zero.jobs.receipts.get(params.key) };
      } }),
      defineEndpoint({ method: 'POST', path: '/schedules', body: t.Unknown(),
        async handler({ zero, body }) {
          if (!zero.jobs) throw new JobsError('JOBS_NOT_READY'); const r = jobRecord(body, ['schedule', 'options']);
          return Response.json(await zero.jobs.schedules.create(r.schedule as JobScheduleInput, r.options as JobRequestOptions), { status: 202 });
        } }),
      defineEndpoint({ method: 'GET', path: '/schedules', query: t.Composite([page, t.Object({ control: t.Optional(t.Union([t.Literal('active'), t.Literal('paused'), t.Literal('cancelled')])) })]),
        async handler({ zero, query }) { if (!zero.jobs) throw new JobsError('JOBS_NOT_READY'); return zero.jobs.schedules.list(query as JobPageOptions); } }),
      defineEndpoint({ method: 'GET', path: '/schedules/live', query: t.Composite([page, t.Object({ control: t.Optional(t.Union([t.Literal('active'), t.Literal('paused'), t.Literal('cancelled')])) })]),
        async handler({ zero, query, request }) {
          if (!zero.jobs) throw new JobsError('JOBS_NOT_READY'); await zero.jobs.schedules.list(query as JobPageOptions);
          return new Response(jobScheduleStream(zero.jobs, query as JobPageOptions, request.signal), {
            headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'private, no-store', 'X-Accel-Buffering': 'no' },
          });
        } }),
      defineEndpoint({ method: 'GET', path: '/schedules/:id', params: t.Object({ id }), async handler({ zero, params }) {
        if (!zero.jobs) throw new JobsError('JOBS_NOT_READY'); return zero.jobs.schedules.get(params.id);
      } }),
      defineEndpoint({ method: 'GET', path: '/schedules/:id/occurrences', params: t.Object({ id }), query: page, async handler({ zero, params, query }) {
        if (!zero.jobs) throw new JobsError('JOBS_NOT_READY'); return zero.jobs.schedules.occurrences(params.id, query);
      } }),
      defineEndpoint({ method: 'PATCH', path: '/schedules/:id', params: t.Object({ id }), body: t.Unknown(),
        async handler({ zero, params, body }) {
          if (!zero.jobs) throw new JobsError('JOBS_NOT_READY'); const r = jobRecord(body, ['schedule', 'options']);
          return zero.jobs.schedules.update(params.id, r.schedule as Partial<JobScheduleInput>, r.options as JobControlOptions);
        } }),
      ...(['pause', 'resume', 'cancel', 'runNow'] as const).map(action => defineEndpoint({ method: 'POST', path: '/schedules/:id/' + action, params: t.Object({ id }), body: t.Unknown(),
        async handler({ zero, params, body }) { if (!zero.jobs) throw new JobsError('JOBS_NOT_READY'); return zero.jobs.schedules[action](params.id, body as JobControlOptions); } })),
    ],
  })] });
}
