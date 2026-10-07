/** Tracks accepted-save generations beside useForm; owns no form values, validation, or persistence. */

import type { FormRevision, FormSubmissionSnapshot } from './form-save-types';

/** Distinguish stale revisions from typed availability conflicts; untyped 409 remains fail-closed. */
export function isFormRevisionConflict(cause: unknown): boolean {
  if (!cause || typeof cause !== 'object') return false;
  const value = cause as { code?: unknown; status?: unknown };
  // A typed 409 can mean an unavailable username/email, not a stale revision.
  // Such a draft must remain correctable without fabricating a rebase ceremony.
  return value.code === 'CONFLICT' || typeof value.code === 'string' && /(?:^|_)REVISION_CONFLICT$/u.test(value.code)
    || value.status === 409 && (value.code === null || value.code === undefined);
}

interface CapturedValues {
  readonly epoch: number;
  readonly sequence: number;
  readonly values: Record<string, unknown>;
  readonly fields: readonly string[];
  readonly generations: ReadonlyMap<string, number>;
}

/** Detached JSON-like form snapshots; unknown native field objects remain identity values. */
export function copyFormValue<T>(value: T): T {
  if (value instanceof Date) return new Date(value.getTime()) as T;
  if (Array.isArray(value)) return value.map(copyFormValue) as T;
  if (value && typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value);
    if (prototype === Object.prototype || prototype === null) {
      return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, copyFormValue(entry)])) as T;
    }
  }
  return value;
}

/** Generation-fenced, once-only acknowledgment, including A→B→A edits during a request. */
export class FormAcceptanceController {
  private epoch = 0;
  private sequence = 0;
  private revisionSequence = 0;
  private currentRevision: FormRevision | undefined;
  private readonly generations = new Map<string, number>();
  private readonly accepted = new Map<string, number>();
  private readonly captures = new WeakMap<object, CapturedValues>();

  get revision(): FormRevision | undefined { return this.currentRevision; }

  /** Retire every old capture and adopt only an explicitly supplied new baseline revision. */
  reset(revision?: FormRevision): void {
    this.epoch += 1;
    this.generations.clear();
    this.accepted.clear();
    this.revisionSequence = 0;
    this.currentRevision = revision;
  }

  /** Record user edits even when their eventual value equals the old submitted value. */
  edited(field: string): void {
    this.generations.set(field, (this.generations.get(field) ?? 0) + 1);
  }

  /** Values exposed to callbacks are detached from the private acknowledgment snapshot. */
  capture(values: Record<string, unknown>, fields: readonly string[]): FormSubmissionSnapshot {
    const names = Object.freeze([...fields]);
    const captured = Object.fromEntries(names.map(name => [name, copyFormValue(values[name])]));
    const snapshot = Object.freeze({ values: Object.freeze(copyFormValue(captured)), fields: names,
      expectedRevision: this.currentRevision });
    this.captures.set(snapshot, { epoch: this.epoch, sequence: ++this.sequence, values: captured,
      fields: names, generations: new Map(names.map(name => [name, this.generations.get(name) ?? 0])) });
    return snapshot;
  }

  /** Read an originating snapshot without trusting a fabricated/mutated public object. */
  read(snapshot: FormSubmissionSnapshot): Record<string, unknown> | null {
    const capture = this.captures.get(snapshot);
    return capture?.epoch === this.epoch ? copyFormValue(capture.values) : null;
  }

  /** Produce patches only; useForm remains the single owner of baseline/current state. */
  accept(snapshot: FormSubmissionSnapshot, values: Record<string, unknown>, revision?: FormRevision): {
    readonly baseline: Record<string, unknown>;
    readonly draft: Record<string, unknown>;
  } | null {
    const capture = this.captures.get(snapshot);
    if (!capture || capture.epoch !== this.epoch) return null;
    this.captures.delete(snapshot);
    const baseline: Record<string, unknown> = {}, draft: Record<string, unknown> = {};
    for (const field of capture.fields) {
      if ((this.accepted.get(field) ?? 0) > capture.sequence) continue;
      this.accepted.set(field, capture.sequence);
      Object.defineProperty(baseline, field, { value: copyFormValue(values[field]), enumerable: true });
      if ((this.generations.get(field) ?? 0) === capture.generations.get(field)) {
        Object.defineProperty(draft, field, { value: copyFormValue(values[field]), enumerable: true });
      }
    }
    if (revision !== undefined && capture.sequence >= this.revisionSequence) {
      this.currentRevision = revision;
      this.revisionSequence = capture.sequence;
    }
    return { baseline, draft };
  }
}
