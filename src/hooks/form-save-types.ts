/** Additive acknowledgment/snapshot contracts for existing Zero form state; no transport. */

import type { Row } from '../sync/types';

/** An opaque app/backend revision, never a browser timestamp or authority. */
export type FormRevision = string | number;

/** An explicitly admitted domain source; a missing local cache row must remain loading, not missing. */
export type FormRecordSnapshot<T extends Row = Row> = {
  readonly identity: string | number;
} & (
  | { readonly status: 'loading' | 'missing' | 'forbidden' }
  | { readonly status: 'ready'; readonly values: Partial<T>; readonly revision?: FormRevision;
      /** Pending optimistic state is not a server receipt or competing authoritative revision. */
      readonly origin: 'authoritative' | 'pending-local' }
);

/** Read/draft awareness only; conditional writes still belong to the domain's backend adapter. */
export interface FormRecordState {
  readonly status: 'idle' | FormRecordSnapshot['status'];
  readonly changedElsewhere: boolean;
  readonly incomingRevision?: FormRevision;
}

/** Reloading a dirty draft requires an explicit caller decision; saves in flight cannot be rebased. */
export interface FormRecordReconcileOptions {
  readonly discardDraft?: boolean;
}

/** Admission never fabricates a merge or acknowledges an optimistic local echo. */
export type FormRecordReconcileResult =
  | { readonly kind: 'adopted' | 'preserved' | 'unchanged' | 'unavailable' }
  | { readonly kind: 'ignored'; readonly reason: 'retired' | 'identity' | 'pending-local' | 'superseded' }
  | { readonly kind: 'blocked'; readonly reason: 'saving' | 'draft' | 'unavailable' };

/** Cancellation is advisory; backend adapters still enforce revisions and live authority. */
export interface FormSubmitContext {
  readonly signal: AbortSignal;
  readonly expectedRevision?: FormRevision;
}

/** Canonical accepted stored values; omitted values acknowledge the submitted snapshot. */
export interface FormSubmissionAcceptance<T extends Row = Row> {
  readonly values?: Partial<T>;
  readonly revision?: FormRevision;
}

/** Capture before awaited field work; only the originating mounted form can consume it. */
export interface FormSubmissionSnapshot<T extends Row = Row> {
  readonly values: Readonly<Partial<T>>;
  readonly fields: readonly string[];
  readonly expectedRevision?: FormRevision;
}

/** Submit resolution is explicit; legacy handleSubmit intentionally still resolves void. */
export type FormSubmitResult<T extends Row = Row> =
  | { readonly kind: 'accepted'; readonly values: T; readonly revision?: FormRevision }
  | { readonly kind: 'invalid'; readonly errors: Readonly<Record<string, string>> }
  | { readonly kind: 'failed'; readonly error: string; readonly conflict: boolean }
  | { readonly kind: 'retired' }
  | { readonly kind: 'blocked' };
