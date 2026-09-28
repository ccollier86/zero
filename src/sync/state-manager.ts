import type { Statement } from 'bun:sqlite';
import { Buffer } from 'node:buffer';
import type { ReactiveDB } from './reactive-db';
import type {
  Change,
  JsonValue,
  Row,
  StateChangeMessage,
  StateErrorCode,
} from './types';
import { STATE_LIMITS } from './types';

interface StateRow {
  user_id: string;
  key: string;
  value: string;
  updated_at: number;
}

type DurableStatePayload =
  | (Row & {
    state_event_version: 1;
    state_op: 'set';
    user_id: string;
    key: string;
    value: JsonValue;
  })
  | (Row & {
    state_event_version: 1;
    state_op: 'delete';
    user_id: string;
    key: string;
  })
  | (Row & {
    state_event_version: 1;
    state_op: 'clear';
    user_id: string;
    key: null;
  });

type SetCommitResult =
  | { ok: true; change: Change }
  | { ok: false; error: StateErrorCode };

export interface StateSnapshot {
  entries: Record<string, JsonValue>;
  seq: number;
}

export interface StateCommittedChange {
  principal: string;
  message: StateChangeMessage;
  seq: number;
}

export type StateMutationResult =
  | { ok: true }
  | { ok: false; error: StateErrorCode };

/**
 * Server-side per-authorized-scope user KV state manager.
 *
 * SQLite is authoritative for reads, limit validation, and writes. No
 * per-principal RAM copy is retained. Every raw `_user_state` mutation and its
 * one logical `_changes` event commit in the same ReactiveDB writer transaction.
 */
export class StateManager {
  private disposed = false;

  private readonly stmts: {
    getUserState: Statement;
    upsertState: Statement;
    deleteState: Statement;
    clearUserState: Statement;
  };

  constructor(private readonly db: ReactiveDB) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS main._user_state (
        user_id    TEXT NOT NULL,
        key        TEXT NOT NULL,
        value      TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, key)
      )
    `);
    db.exec(
      'CREATE INDEX IF NOT EXISTS main.idx_user_state_user ON _user_state(user_id)'
    );

    this.stmts = {
      getUserState: db.prepare(
        'SELECT user_id, key, value, updated_at FROM main._user_state WHERE user_id = ?'
      ),
      upsertState: db.prepare(`
        INSERT INTO main._user_state (user_id, key, value, updated_at) VALUES (?, ?, ?, ?)
        ON CONFLICT (user_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
      `),
      deleteState: db.prepare(
        'DELETE FROM main._user_state WHERE user_id = ? AND key = ?'
      ),
      clearUserState: db.prepare(
        'DELETE FROM main._user_state WHERE user_id = ?'
      ),
    };
  }

  /** Read a fresh authoritative state map. */
  getUserState(userId: string): Map<string, JsonValue> {
    this.assertNotDisposed();
    return this.loadFromSQLite(userId);
  }

  /** Read a fresh authoritative state object. */
  getUserStateEntries(userId: string): Record<string, JsonValue> {
    return this.getUserStateSnapshot(userId).entries;
  }

  /**
   * Capture a state snapshot and exactly the durable cursor represented by it.
   * A remote commit is therefore either visible here or remains deliverable as
   * a later external state change.
   */
  getUserStateSnapshot(userId: string): StateSnapshot;
  getUserStateSnapshot(
    userId: string,
    validateCurrentAuthority: () => boolean,
  ): StateSnapshot | null;
  getUserStateSnapshot(
    userId: string,
    validateCurrentAuthority?: () => boolean,
  ): StateSnapshot | null {
    this.assertNotDisposed();
    const snapshot = this.db.readAtCurrentSequence(() => {
      if (validateCurrentAuthority && !hasCurrentAuthority(validateCurrentAuthority)) return null;
      return mapToEntries(this.loadFromSQLite(userId));
    });
    if (snapshot.value === null) return null;
    return { entries: snapshot.value, seq: snapshot.seq };
  }

  /**
   * Set a key after validating the current SQLite rows under BEGIN IMMEDIATE.
   * Concurrent runtimes cannot both validate against stale process-local RAM.
   */
  set(
    userId: string,
    key: string,
    value: JsonValue,
    validateCurrentAuthority: () => boolean = allowCurrentAuthority,
  ): StateMutationResult {
    this.assertNotDisposed();
    const keyError = validateStateKey(key);
    if (keyError) return { ok: false, error: keyError };

    const serialized = serializeJsonValue(value);
    if (serialized === null) return { ok: false, error: 'INVALID_REQUEST' };
    if (utf8Size(serialized) > STATE_LIMITS.maxValueSize) {
      return { ok: false, error: 'VALUE_TOO_LARGE' };
    }

    const committed = this.db.transaction<SetCommitResult>(() => {
      if (!hasCurrentAuthority(validateCurrentAuthority)) {
        return { ok: false, error: 'UNAUTHORIZED' };
      }
      const rows = this.readRows(userId);
      const existing = rows.find((row) => row.key === key);
      const previousValue = existing
        ? parseStoredJsonValue(existing.value)
        : null;
      if (previousValue && !previousValue.ok) {
        // Existing State rows are platform-owned JSON. Never overwrite a
        // corrupt row while manufacturing an incomplete v1 UPDATE event.
        return { ok: false, error: 'INVALID_REQUEST' };
      }
      if (!existing && rows.length >= STATE_LIMITS.maxKeys) {
        return { ok: false, error: 'TOO_MANY_KEYS' };
      }

      const currentSize = estimateRowsSize(rows);
      const oldEntrySize = existing
        ? utf8Size(existing.key) + utf8Size(existing.value)
        : 0;
      const newEntrySize = utf8Size(key) + utf8Size(serialized);
      if (currentSize - oldEntrySize + newEntrySize > STATE_LIMITS.maxTotalSize) {
        return { ok: false, error: 'TOTAL_SIZE_EXCEEDED' };
      }

      this.stmts.upsertState.run(userId, key, serialized, Date.now());
      const payload = statePayload('set', userId, key, value);
      const change = this.db.recordInternalChange({
        table: '_user_state',
        op: existing ? 'UPDATE' : 'INSERT',
        rowId: stateRowId(userId, key),
        row: payload,
        previousRow: existing && previousValue?.ok
          ? statePayload('set', userId, key, previousValue.value)
          : undefined,
      });
      return { ok: true, change };
    });

    if (!committed.ok) return committed;
    return { ok: true };
  }

  /** Delete a key and append one logical state event in the same commit. */
  delete(
    userId: string,
    key: string,
    validateCurrentAuthority: () => boolean = allowCurrentAuthority,
  ): StateMutationResult {
    this.assertNotDisposed();
    const keyError = validateStateKey(key);
    if (keyError) return { ok: false, error: keyError };
    const change = this.db.transaction(() => {
      if (!hasCurrentAuthority(validateCurrentAuthority)) return null;
      this.stmts.deleteState.run(userId, key);
      return this.db.recordInternalChange({
        table: '_user_state',
        op: 'DELETE',
        rowId: stateRowId(userId, key),
        previousRow: statePayload('delete', userId, key),
      });
    });
    if (!change) return { ok: false, error: 'UNAUTHORIZED' };
    return { ok: true };
  }

  /** Clear one principal and append one logical state event in the same commit. */
  clear(
    userId: string,
    validateCurrentAuthority: () => boolean = allowCurrentAuthority,
  ): StateMutationResult {
    this.assertNotDisposed();
    const change = this.db.transaction(() => {
      if (!hasCurrentAuthority(validateCurrentAuthority)) return null;
      this.stmts.clearUserState.run(userId);
      return this.db.recordInternalChange({
        table: '_user_state',
        op: 'DELETE',
        rowId: stateRowId(userId, null),
        previousRow: statePayload('clear', userId, null),
      });
    });
    if (!change) return { ok: false, error: 'UNAUTHORIZED' };
    return { ok: true };
  }

  /** Decode one ordered local/external durable state event for socket delivery. */
  applyCommittedChange(change: Change): StateCommittedChange | null {
    this.assertNotDisposed();
    const payload = decodeStatePayload(change);
    if (!payload) return null;

    return {
      principal: payload.user_id,
      seq: change.seq,
      message: payload.state_op === 'set'
        ? {
          type: 'state.change',
          key: payload.key,
          value: payload.value,
          op: 'set',
        }
        : {
          type: 'state.change',
          key: payload.state_op === 'delete' ? payload.key : null,
          value: undefined,
          op: payload.state_op,
        },
    };
  }

  /** Finalize State Sync statements. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stmts.getUserState.finalize();
    this.stmts.upsertState.finalize();
    this.stmts.deleteState.finalize();
    this.stmts.clearUserState.finalize();
  }

  private readRows(userId: string): StateRow[] {
    return this.stmts.getUserState.all(userId) as StateRow[];
  }

  private loadFromSQLite(userId: string): Map<string, JsonValue> {
    const map = new Map<string, JsonValue>();
    for (const row of this.readRows(userId)) {
      try {
        map.set(row.key, JSON.parse(row.value) as JsonValue);
      } catch {
        // A corrupted stored value is never exposed as client state. Its raw
        // bytes still count during limit validation, preventing undercounting.
      }
    }
    return map;
  }

  private assertNotDisposed(): void {
    if (this.disposed) throw new Error('StateManager has been disposed');
  }
}

function statePayload(
  stateOp: 'set',
  userId: string,
  key: string,
  value: JsonValue,
): DurableStatePayload;
function statePayload(
  stateOp: 'delete',
  userId: string,
  key: string,
): DurableStatePayload;
function statePayload(
  stateOp: 'clear',
  userId: string,
  key: null,
): DurableStatePayload;
function statePayload(
  stateOp: 'set' | 'delete' | 'clear',
  userId: string,
  key: string | null,
  value?: JsonValue,
): DurableStatePayload {
  if (stateOp === 'set') {
    if (typeof key !== 'string' || value === undefined) {
      throw new Error('Invalid durable State Sync set payload');
    }
    return {
      state_event_version: 1,
      state_op: 'set',
      user_id: userId,
      key,
      value,
    };
  }
  if (stateOp === 'delete') {
    if (typeof key !== 'string') {
      throw new Error('Invalid durable State Sync delete payload');
    }
    return {
      state_event_version: 1,
      state_op: 'delete',
      user_id: userId,
      key,
    };
  }
  return {
    state_event_version: 1,
    state_op: 'clear',
    user_id: userId,
    key: null,
  };
}

function decodeStatePayload(change: Change): DurableStatePayload | null {
  if (change.table !== '_user_state') return null;
  const candidate = change.op === 'DELETE' ? change.previousRow : change.row;
  if (!candidate
    || candidate.state_event_version !== 1
    || typeof candidate.user_id !== 'string'
    || candidate.user_id.length === 0
    || (candidate.state_op !== 'set'
      && candidate.state_op !== 'delete'
      && candidate.state_op !== 'clear')) {
    return null;
  }

  if (candidate.state_op === 'set') {
    if ((change.op !== 'INSERT' && change.op !== 'UPDATE')
      || typeof candidate.key !== 'string'
      || !Object.hasOwn(candidate, 'value')) return null;
  } else if (change.op !== 'DELETE') {
    return null;
  } else if (candidate.state_op === 'delete' && typeof candidate.key !== 'string') {
    return null;
  } else if (candidate.state_op === 'clear' && candidate.key !== null) {
    return null;
  }

  return candidate as DurableStatePayload;
}

function stateRowId(userId: string, key: string | null): string {
  return JSON.stringify(key === null ? [userId] : [userId, key]);
}

function mapToEntries(map: Map<string, JsonValue>): Record<string, JsonValue> {
  const entries = Object.create(null) as Record<string, JsonValue>;
  for (const [key, value] of map) entries[key] = value;
  return entries;
}

function estimateRowsSize(rows: readonly StateRow[]): number {
  let size = 0;
  for (const row of rows) size += utf8Size(row.key) + utf8Size(row.value);
  return size;
}

function utf8Size(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

/** Shared defensive key validation for every State Sync mutation path. */
export function validateStateKey(key: unknown): StateErrorCode | null {
  if (typeof key !== 'string') return 'INVALID_REQUEST';
  return key.length > STATE_LIMITS.maxKeyLength ? 'KEY_TOO_LONG' : null;
}

function serializeJsonValue(value: unknown): string | null {
  try {
    if (!isJsonValue(value)) return null;
    const serialized = JSON.stringify(value);
    return typeof serialized === 'string' ? serialized : null;
  } catch {
    return null;
  }
}

function parseStoredJsonValue(serialized: string):
  | { ok: true; value: JsonValue }
  | { ok: false } {
  try {
    const value: unknown = JSON.parse(serialized);
    return isJsonValue(value) ? { ok: true, value } : { ok: false };
  } catch {
    return { ok: false };
  }
}

/** Runtime JSON validation for direct callers as well as untrusted wire input. */
export function isJsonValue(value: unknown): value is JsonValue {
  try {
    return validateJsonValue(value);
  } catch {
    // Proxies and accessors are not wire JSON. Treat any reflective failure as
    // invalid input rather than allowing it to escape the protocol boundary.
    return false;
  }
}

function validateJsonValue(value: unknown): value is JsonValue {
  const pending: Array<{ value: unknown; exit?: boolean }> = [{ value }];
  const active = new WeakSet<object>();

  while (pending.length > 0) {
    const task = pending.pop()!;
    const current = task.value;
    if (task.exit) {
      active.delete(current as object);
      continue;
    }
    if (current === null || typeof current === 'string' || typeof current === 'boolean') {
      continue;
    }
    if (typeof current === 'number') {
      if (!Number.isFinite(current)) return false;
      continue;
    }
    if (typeof current !== 'object') return false;
    if (active.has(current)) return false;
    active.add(current);
    pending.push({ value: current, exit: true });

    if (Object.getOwnPropertySymbols(current).length > 0) return false;
    if (Array.isArray(current)) {
      const keys = Object.keys(current);
      // Sparse arrays and enumerable non-index properties do not match the
      // JsonValue array contract even though JSON.stringify would coerce or
      // ignore them.
      if (keys.length !== current.length) return false;
      for (let index = 0; index < keys.length; index += 1) {
        const key = keys[index]!;
        if (key !== String(index)) return false;
        const descriptor = Object.getOwnPropertyDescriptor(current, key);
        if (!descriptor || !('value' in descriptor)) return false;
        pending.push({ value: descriptor.value });
      }
      continue;
    }

    const prototype = Object.getPrototypeOf(current);
    if (prototype !== Object.prototype && prototype !== null) return false;
    const keys = Object.keys(current);
    if (Object.getOwnPropertyNames(current).length !== keys.length) return false;
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(current, key);
      if (!descriptor || !('value' in descriptor)) return false;
      pending.push({ value: descriptor.value });
    }
  }

  return true;
}

function allowCurrentAuthority(): boolean {
  return true;
}

function hasCurrentAuthority(validate: () => boolean): boolean {
  try {
    return validate() === true;
  } catch {
    return false;
  }
}
