/** Additive acknowledgment/snapshot contracts for existing Zero form state; no transport. */

import type { Row } from '../sync/types';

/** An opaque app/backend revision, never a browser timestamp or authority. */
export type FormRevision = string | number;

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
