/** In-memory bounded transport only; no runtime, database or generated fixture. */
import { expect, test } from 'bun:test';
import type { JobSchedulePage, JobWatchOptions, JobWatchUpdate, ScopedJobs } from './contracts';
import { jobScheduleStream } from './stream';

test('bounded SSE preserves committed invalidation when coalescing equal buffered pages', async () => {
  const fixture = streamFixture(), reader = fixture.stream.getReader();
  try {
    fixture.emit(fixture.page, { invalidated: true });
    fixture.emit(fixture.page, { invalidated: false });
    expect(frame((await reader.read()).value!)).toEqual({ version: 1, value: fixture.page, invalidated: false });
    expect(frame((await reader.read()).value!)).toEqual({ version: 1, value: fixture.page, invalidated: true });
    fixture.owner.abort();
    expect((await reader.read()).done).toBe(true); expect(fixture.removed()).toBe(1);
    fixture.emit(fixture.page, { invalidated: true });
    expect((await reader.read()).done).toBe(true);
  } finally { fixture.owner.abort(); await reader.cancel(); reader.releaseLock(); }
});

test('read denial drops buffered invalidation and closes without a stale follow-up page', async () => {
  const fixture = streamFixture(), reader = fixture.stream.getReader();
  try {
    fixture.emit(fixture.page, { invalidated: true }); fixture.fail();
    expect(frame((await reader.read()).value!)).toEqual({ version: 1, value: fixture.page, invalidated: false });
    expect(frame((await reader.read()).value!)).toEqual({ version: 1, error: true });
    expect((await reader.read()).done).toBe(true); expect(fixture.removed()).toBe(1);
  } finally { fixture.owner.abort(); await reader.cancel(); reader.releaseLock(); }
});

function streamFixture() {
  const owner = new AbortController(), page: JobSchedulePage = { items: [], total: 0 };
  let emit!: (page: JobSchedulePage, update?: JobWatchUpdate) => void, fail!: () => void, removed = 0;
  const jobs = { schedules: { watch(listener: typeof emit, options: JobWatchOptions) {
    emit = listener; fail = () => options.onError?.(new Error('Synthetic denied read.'));
    listener(page); return () => { removed++; };
  } } } as unknown as ScopedJobs;
  const stream = jobScheduleStream(jobs, {}, owner.signal);
  return { owner, page, stream, emit, fail, removed: () => removed };
}
function frame(value: Uint8Array): unknown {
  return JSON.parse(new TextDecoder().decode(value).split('\n').find(line => line.startsWith('data: '))!.slice(6));
}
