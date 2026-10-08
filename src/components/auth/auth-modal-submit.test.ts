/** Native dialog submission admission and safe failure/retirement, without live auth or DOM. */
import { afterEach, describe, expect, test } from 'bun:test';
import type { FormEvent } from 'react';
import { submitOwnedAuthModal } from './auth-modal-submit';
import { configureFrontendObservability, type FrontendObservabilityEvent } from '../../frontend/client/observability';
function deferred() { let resolve!: () => void; const promise = new Promise<void>(yes => { resolve = yes; }); return { promise, resolve }; }
function fixture() {
  const abort = new AbortController(), pending = { current: false }, busy: boolean[] = [], errors: string[] = [];
  let prevented = 0, stopped = 0;
  const event = { preventDefault() { prevented++; }, stopPropagation() { stopped++; } } as unknown as FormEvent;
  const context = { signal: abort.signal, setBusy(value: boolean) { busy.push(value); }, setError(value: string | null) { if (value) errors.push(value); } };
  return { abort, pending, busy, errors, event, context, counts: () => [prevented, stopped] };
}
afterEach(() => configureFrontendObservability({ http: false, console: false }));
describe('owned native auth submit', () => {
  test('reserves synchronously, awaits the existing writer and stops portal submit bubbling', async () => {
    const f = fixture(), work = deferred(); let calls = 0;
    const first = submitOwnedAuthModal(f.context, f.event, f.pending, async () => { calls++; await work.promise; });
    await submitOwnedAuthModal(f.context, f.event, f.pending, async () => { calls++; });
    expect(calls).toBe(1); expect(f.pending.current).toBe(true); expect(f.busy).toEqual([true]);
    work.resolve(); await first;
    expect(f.pending.current).toBe(false); expect(f.busy).toEqual([true, false]); expect(f.counts()).toEqual([2, 2]);
  });
  test('contains a failed writer with safe static UI and diagnostic metadata', async () => {
    const f = fixture(), events: FrontendObservabilityEvent[] = [];
    configureFrontendObservability({ sink: { emit(value) { events.push(value); } } });
    await submitOwnedAuthModal(f.context, f.event, f.pending, async () => { throw new Error('PRIVATE_REQUEST_DATA'); });
    expect(f.errors).toEqual(['The operation could not be confirmed. Please try again.']);
    expect(events).toHaveLength(1); expect(JSON.stringify(events)).not.toContain('PRIVATE_REQUEST_DATA');
    expect(f.pending.current).toBe(false);
  });
  test('retired submit cannot start a writer; retirement suppresses pending completion presentation', async () => {
    const f = fixture(), work = deferred(); let calls = 0;
    const first = submitOwnedAuthModal(f.context, f.event, f.pending, async () => { calls++; await work.promise; });
    f.abort.abort(); work.resolve(); await first;
    await submitOwnedAuthModal(f.context, f.event, f.pending, async () => { calls++; });
    expect(calls).toBe(1); expect(f.busy).toEqual([true]); expect(f.errors).toEqual([]);
  });
});
