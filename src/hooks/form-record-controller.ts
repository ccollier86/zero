/**
 * Owns authoritative record/draft admission beside useForm. It does not subscribe,
 * mutate form values, infer deletion from caches, merge drafts, or perform conditional writes.
 */
import type { Row } from '../sync/types';
import { copyFormValue } from './form-acceptance-controller';
import { areFormValuesEqual } from './form-value-utils';
import type { FormRecordSnapshot, FormRecordState, FormRecordReconcileResult, FormRevision } from './form-save-types';

type ReadyRecord<T extends Row> = Extract<FormRecordSnapshot<T>, { readonly status: 'ready' }>;
const IDLE: FormRecordState = Object.freeze({ status: 'idle', changedElsewhere: false });

/** Keeps only an explicitly admitted latest record; revisions remain opaque and are never ordered locally. */
export class FormRecordController<T extends Row = Row> {
  private current: FormRecordState = IDLE;
  private incoming: ReadyRecord<T> | null = null;
  private readonly supersededRevisions = new Set<FormRevision>();
  get state(): FormRecordState { return this.current; }
  /** Return a detached comparison snapshot, not mutable ownership of a future reload. */
  get incomingRecord(): ReadyRecord<T> | null { return copyFormValue(this.incoming); }

  reset(): void { this.current = IDLE; this.incoming = null; this.supersededRevisions.clear(); }

  /** Caller has already checked record/scope identity and decoded permitted canonical fields. */
  reconcile(record: FormRecordSnapshot<T>, baseline: Partial<T>, revision: FormRevision | undefined,
    dirty: boolean, saving: boolean, discardDraft = false): FormRecordReconcileResult {
    if (record.status === 'ready' && record.origin === 'pending-local') return { kind: 'ignored', reason: 'pending-local' };
    if (record.status === 'ready' && record.revision !== undefined && this.supersededRevisions.has(record.revision))
      return { kind: 'ignored', reason: 'superseded' };
    if (record.status !== 'ready') {
      if (record.status !== 'loading') this.incoming = null;
      if (this.current.status !== record.status) this.current = Object.freeze({ ...this.current, status: record.status,
        ...(record.status === 'loading' ? {} : { changedElsewhere: false, incomingRevision: undefined }) });
      return { kind: 'unavailable' };
    }
    const same = Object.is(record.revision, revision) && areFormValuesEqual(record.values, baseline);
    if (same) {
      this.incoming = null;
      if (this.current.status !== 'ready' || this.current.changedElsewhere) this.current = Object.freeze({ status: 'ready', changedElsewhere: false });
      return { kind: 'unchanged' };
    }
    const unchangedIncoming = this.incoming !== null && Object.is(this.incoming.revision, record.revision)
      && areFormValuesEqual(this.incoming.values, record.values);
    this.incoming = unchangedIncoming ? this.incoming : copyFormValue(record);
    if (saving || dirty && !discardDraft) {
      if (this.current.status !== 'ready' || !this.current.changedElsewhere || !unchangedIncoming)
        this.current = Object.freeze({ status: 'ready', changedElsewhere: true, incomingRevision: record.revision });
      return { kind: 'preserved' };
    }
    this.adopted();
    return { kind: 'adopted' };
  }

  /** A known acknowledgment clears only its matching live echo, not a distinct newer authoritative record. */
  accepted(baseline: Partial<T>, revision: FormRevision | undefined, expectedRevision?: FormRevision): void {
    // Remember only receipt-proven supersession; opaque revisions are not
    // numerically ordered and unknown snapshots still belong to the source's
    // current-read contract. Reconnect cannot revive this known old baseline.
    if (expectedRevision !== undefined && !Object.is(expectedRevision, revision)) this.supersededRevisions.add(expectedRevision);
    if (revision !== undefined) this.supersededRevisions.delete(revision);
    if (this.incoming && (!Object.is(this.incoming.revision, revision) || !areFormValuesEqual(this.incoming.values, baseline))) return;
    this.incoming = null;
    this.current = Object.freeze({ status: this.current.status, changedElsewhere: false });
  }

  /** Exact reload admission; never replace an in-flight writer's captured baseline. */
  reload(dirty: boolean, saving: boolean, discardDraft = false): FormRecordReconcileResult {
    if (saving) return { kind: 'blocked', reason: 'saving' };
    if (!this.incoming || this.current.status !== 'ready') return { kind: 'blocked', reason: 'unavailable' };
    if (dirty && !discardDraft) return { kind: 'blocked', reason: 'draft' };
    this.adopted(); return { kind: 'adopted' };
  }

  private adopted(): void {
    this.incoming = null; this.current = Object.freeze({ status: 'ready', changedElsewhere: false });
  }
}
