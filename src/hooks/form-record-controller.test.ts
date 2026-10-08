/** Authoritative admission versus optimistic echoes; no DB, network, or React lifecycle. */
import { describe, expect, test } from 'bun:test';
import { FormRecordController } from './form-record-controller';
import type { FormRecordSnapshot } from './form-save-types';

type RecordRow = { id: string; title: string };
const baseline = { id: 'row', title: 'Original' };
const incoming = (revision = 2): FormRecordSnapshot<RecordRow> => ({ identity: 'row', status: 'ready',
  values: { id: 'row', title: 'Remote' }, revision, origin: 'authoritative' });

describe('FormRecordController', () => {
  test('pristine authority adopts atomically while a dirty draft keeps its old baseline revision', () => {
    const clean = new FormRecordController<RecordRow>();
    expect(clean.reconcile(incoming(), baseline, 1, false, false)).toEqual({ kind: 'adopted' });
    expect(clean.state).toEqual({ status: 'ready', changedElsewhere: false });
    const dirty = new FormRecordController<RecordRow>();
    expect(dirty.reconcile(incoming(), baseline, 1, true, false)).toEqual({ kind: 'preserved' });
    expect(dirty.state).toEqual({ status: 'ready', changedElsewhere: true, incomingRevision: 2 });
    expect(dirty.reload(true, false)).toEqual({ kind: 'blocked', reason: 'draft' });
    expect(dirty.reload(true, false, true)).toEqual({ kind: 'adopted' });
  });
  test('local pending echoes do not change readiness, baseline, or incoming revision', () => {
    const c = new FormRecordController<RecordRow>();
    expect(c.reconcile({ identity: 'row', status: 'ready', origin: 'pending-local', values: baseline, revision: 88 },
      baseline, 1, false, false)).toEqual({ kind: 'ignored', reason: 'pending-local' });
    expect(c.state.status).toBe('idle'); expect(c.incomingRecord).toBeNull();
  });
  test('pending writers keep their capture and only their matching authoritative echo is cleared', () => {
    const c = new FormRecordController<RecordRow>();
    expect(c.reconcile(incoming(), baseline, 1, false, true)).toEqual({ kind: 'preserved' });
    expect(c.reload(false, true, true)).toEqual({ kind: 'blocked', reason: 'saving' });
    c.accepted({ id: 'row', title: 'Local accepted' }, 2);
    expect(c.state.changedElsewhere).toBe(true);
    c.accepted({ id: 'row', title: 'Remote' }, 2);
    expect(c.state.changedElsewhere).toBe(false); expect(c.incomingRecord).toBeNull();
  });
  test('repeated equivalent source snapshots keep stable state and comparison copies cannot change reload', () => {
    const c = new FormRecordController<RecordRow>();
    c.reconcile(incoming(), baseline, 1, true, false); const state = c.state;
    const copy = c.incomingRecord!; copy.values.title = 'Foreign';
    c.reconcile(incoming(), baseline, 1, true, false);
    expect(c.state).toBe(state); expect(c.incomingRecord!.values.title).toBe('Remote');
  });
  test('loading is not deletion; forbidden/missing clear admitted incoming data and cannot reload', () => {
    const c = new FormRecordController<RecordRow>();
    c.reconcile(incoming(), baseline, 1, true, false);
    c.reconcile({ identity: 'row', status: 'loading' }, baseline, 1, true, false);
    expect(c.state.status).toBe('loading'); expect(c.incomingRecord).not.toBeNull();
    expect(c.reload(true, false, true)).toEqual({ kind: 'blocked', reason: 'unavailable' });
    c.reconcile({ identity: 'row', status: 'forbidden' }, baseline, 1, true, false);
    expect(c.incomingRecord).toBeNull(); expect(c.state.changedElsewhere).toBe(false);
    c.reset(); expect(c.state).toEqual({ status: 'idle', changedElsewhere: false });
  });
});
