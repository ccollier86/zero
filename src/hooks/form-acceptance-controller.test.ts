/** Pure acknowledgment generations, detached snapshots and retirement; no form/transport engine. */
import { describe, expect, test } from 'bun:test';
import { FormAcceptanceController, isFormRevisionConflict } from './form-acceptance-controller';

test('revision classification permits correcting typed availability conflicts but keeps stale revisions locked', () => {
  expect(isFormRevisionConflict({ status: 409, code: 'DUPLICATE_USERNAME' })).toBe(false);
  expect(isFormRevisionConflict({ status: 409, code: 'DUPLICATE_EMAIL' })).toBe(false);
  expect(isFormRevisionConflict({ status: 409, code: 'AUTH_PROFILE_REVISION_CONFLICT' })).toBe(true);
  expect(isFormRevisionConflict({ code: 'REVISION_CONFLICT' })).toBe(true);
  expect(isFormRevisionConflict({ code: 'CONFLICT' })).toBe(true);
  expect(isFormRevisionConflict({ status: 409 })).toBe(true);
  expect(isFormRevisionConflict({ status: 409, code: null })).toBe(true);
});

describe('FormAcceptanceController', () => {
  test('canonical acceptance advances only captured fields, once', () => {
    const controller = new FormAcceptanceController(); controller.reset(1);
    const snapshot = controller.capture({ name: 'Draft', bio: 'Unsaved' }, ['name']);
    expect(snapshot.expectedRevision).toBe(1);
    expect(controller.accept(snapshot, { name: 'Canonical', bio: 'Wrong target' }, 2))
      .toEqual({ baseline: { name: 'Canonical' }, draft: { name: 'Canonical' } });
    expect(controller.revision).toBe(2);
    expect(controller.accept(snapshot, { name: 'Duplicate' }, 3)).toBeNull();
  });
  test('newer edits including A→B→A never disappear under an acknowledgment', () => {
    const controller = new FormAcceptanceController();
    const snapshot = controller.capture({ name: 'A' }, ['name']);
    controller.edited('name'); controller.edited('name');
    expect(controller.accept(snapshot, { name: 'Canonical' }))
      .toEqual({ baseline: { name: 'Canonical' }, draft: {} });
  });
  test('public snapshot mutation cannot alter the private submitted baseline', () => {
    const controller = new FormAcceptanceController();
    const source = { tags: ['one'], date: new Date('2026-10-06T00:00:00Z') };
    const snapshot = controller.capture(source, ['tags', 'date']);
    (snapshot.values.tags as string[]).push('foreign');
    (snapshot.values.date as Date).setUTCFullYear(2000);
    source.tags.push('other');
    expect(controller.read(snapshot)).toEqual({ tags: ['one'], date: new Date('2026-10-06T00:00:00Z') });
  });
  test('out-of-order manual field results cannot overwrite a newer accepted field/revision', () => {
    const controller = new FormAcceptanceController(); controller.reset(1);
    const old = controller.capture({ name: 'Old' }, ['name']);
    const next = controller.capture({ name: 'New' }, ['name']);
    controller.accept(next, { name: 'New accepted' }, 3);
    expect(controller.accept(old, { name: 'Old accepted' }, 2)).toEqual({ baseline: {}, draft: {} });
    expect(controller.revision).toBe(3);
  });
  test('scope retirement rejects old and fabricated snapshots', () => {
    const controller = new FormAcceptanceController();
    const old = controller.capture({ name: 'Private' }, ['name']);
    controller.reset(7);
    expect(controller.read(old)).toBeNull(); expect(controller.accept(old, { name: 'Late' }, 2)).toBeNull();
    expect(controller.accept({ values: { name: 'Fake' }, fields: ['name'] }, { name: 'Fake' })).toBeNull();
    expect(controller.revision).toBe(7);
  });
});
