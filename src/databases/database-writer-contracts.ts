/** Public result contracts shared by writer execution responsibilities. */

import type { ChangeOp } from '../sync/types';
import type {
  DatabaseCommitResult,
  DatabaseMutation,
  DatabaseOperationRow,
  DatabaseReadResult,
  DatabaseSerializableValue,
} from './database-operations';

/** Hard actor-local ceiling for one durable change replay page. */
export const DATABASE_WRITER_MAX_REPLAY_CHANGES = 500 as const;

/** Precise result for one safe ReactiveDB CRUD mutation. */
export type DatabaseMutationEffect = Readonly<{
  readonly type: DatabaseMutation['type'];
  readonly table: string;
  readonly rowId: string;
  readonly changed: boolean;
  readonly op: ChangeOp | null;
  readonly sequence: Readonly<{ seq: number }> | null;
  /**
   * Exact post-commit row for inserts/updates, or null for deletion/no-op.
   * Absent only when replaying an exact receipt created by the v1 contract.
   */
  readonly row?: DatabaseOperationRow | null;
  /**
   * Exact row replaced/deleted by this change, or null for inserts/no-op.
   * Absent only when replaying an exact receipt created by the v1 contract.
   */
  readonly previousRow?: DatabaseOperationRow | null;
}>;

export type DatabaseMutationCommitValue = Readonly<{
  readonly kind: 'mutation';
  readonly mutation: DatabaseMutationEffect;
}>;

export type DatabaseBatchCommitValue = Readonly<{
  readonly kind: 'batch';
  readonly mutations: readonly DatabaseMutationEffect[];
}>;

export type DatabaseCommandCommitValue = Readonly<{
  readonly kind: 'command';
  readonly name: string;
  readonly output: DatabaseSerializableValue;
}>;

export type DatabaseWriterCommitValue =
  | DatabaseMutationCommitValue
  | DatabaseBatchCommitValue
  | DatabaseCommandCommitValue;

/** Canonical change shape returned for actor/coordinator replay. */
export type DatabaseReplayChange = Readonly<{
  readonly seq: number;
  readonly table: string;
  readonly op: ChangeOp;
  readonly rowId: string;
  readonly row: DatabaseOperationRow | null;
  readonly previousRow: DatabaseOperationRow | null;
  readonly ts: number;
}>;

export type DatabaseChangeReplayPage = Readonly<{
  /** Cursor supplied by the caller for this page. */
  readonly afterSeq: number;
  /** Last sequence consumed by this page, or `afterSeq` when it is empty. */
  readonly throughSeq: number;
  /** Cursor for the next page, or null once the represented head is reached. */
  readonly nextAfterSeq: number | null;
  readonly changes: readonly DatabaseReplayChange[];
}>;

export type DatabaseChangeReplayResult = DatabaseReadResult<DatabaseChangeReplayPage>;

export type DatabaseWriterOperationResult =
  | DatabaseReadResult
  | DatabaseCommitResult<DatabaseWriterCommitValue>;
