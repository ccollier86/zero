/** Headless Save/Discard/Stay acknowledgment decisions; no router, account, or transport. */
import { describe, expect, test } from 'bun:test';
import { FormSaveController } from './form-save-controller';
import type { FormSubmitResult } from './form-save-types';

function deferred() {
  let resolve!: (result: FormSubmitResult) => void;
  const promise = new Promise<FormSubmitResult>(yes => { resolve = yes; }); return { promise, resolve };
}
function fixture() {
  let key = 'a', ready = true, dirty = true, submitting = false, writes = 0, warnings = 0;
  const receipt = deferred();
  const form = { get isDirty() { return dirty; }, get isSubmitting() { return submitting; },
    submit() { writes++; return receipt.promise; }, reset() { dirty = false; } };
  const controller = new FormSaveController({ readBoundary: () => ({ key, ready }), readForm: () => form,
    onNotificationFailure() { warnings++; } }); controller.activate();
  return { controller, receipt, form, setDirty(value: boolean) { dirty = value; },
    setSubmitting(value: boolean) { submitting = value; }, replace(next: string, readable = true) { key = next; ready = readable; },
    writes: () => writes, warnings: () => warnings };
}
describe('FormSaveController', () => {
  test('Save single-flights and does not treat void/errors as acknowledged success', async () => {
    const f = fixture(); const first = f.controller.save();
    expect(await f.controller.save()).toEqual({ kind: 'blocked' }); expect(f.writes()).toBe(1);
    f.receipt.resolve({ kind: 'failed', error: 'Safe failure', conflict: true });
    expect((await first).kind).toBe('failed'); expect(f.controller.getSnapshot().error).toBe('Safe failure');
  });
  test('Stay retains the draft; Discard continues only after reset', async () => {
    const f = fixture(); let continued = 0;
    const first = f.controller.requestLeave(() => { continued++; });
    expect(f.controller.getSnapshot().confirmationOpen).toBe(true);
    await f.controller.chooseLeave('stay'); expect(await first).toBe(false); expect(f.form.isDirty).toBe(true);
    const next = f.controller.requestLeave(() => { continued++; expect(f.form.isDirty).toBe(false); });
    await f.controller.chooseLeave('discard'); expect(await next).toBe(true); expect(continued).toBe(1);
  });
  test('Save and leave requires acknowledgment and no newer remaining draft', async () => {
    const f = fixture(); let continued = 0;
    const leaving = f.controller.requestLeave(() => { continued++; });
    const choosing = f.controller.chooseLeave('save');
    f.receipt.resolve({ kind: 'accepted', values: {} }); await choosing;
    expect(continued).toBe(0); expect(f.controller.getSnapshot().confirmationOpen).toBe(true);
    expect(f.controller.getSnapshot().error).toContain('newer edits');
    await f.controller.chooseLeave('stay'); expect(await leaving).toBe(false);
  });
  test('an accepted clean save continues exactly once', async () => {
    const f = fixture(); let continued = 0;
    const leaving = f.controller.requestLeave(() => { continued++; });
    const choosing = f.controller.chooseLeave('save'); f.setDirty(false);
    f.receipt.resolve({ kind: 'accepted', values: {} }); await choosing;
    expect(await leaving).toBe(true); expect(continued).toBe(1);
    await f.controller.chooseLeave('discard'); expect(continued).toBe(1);
  });
  test('scope retirement resolves the prompt and masks old pending results/errors', async () => {
    const f = fixture(); let continued = 0;
    const leaving = f.controller.requestLeave(() => { continued++; });
    const saving = f.controller.chooseLeave('save');
    f.replace('b'); f.controller.reconcile();
    expect(await leaving).toBe(false); expect(f.controller.getSnapshot().saving).toBe(false);
    f.receipt.resolve({ kind: 'failed', error: 'Retired error', conflict: false }); await saving;
    expect(continued).toBe(0); expect(f.controller.getSnapshot().error).toBeNull();
  });
  test('security retirement/unready scope never gets a native unload veto', () => {
    const f = fixture(); expect(f.controller.needsLeavePrompt()).toBe(true);
    f.replace('a', false); expect(f.controller.needsLeavePrompt()).toBe(false);
    f.controller.retire(); expect(f.controller.needsLeavePrompt()).toBe(false);
  });
});
