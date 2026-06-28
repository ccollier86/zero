import type { Statement } from 'bun:sqlite';
import type { ReactiveDB } from './reactive-db';
import type { JsonValue, StateErrorCode } from './types';
import { STATE_LIMITS } from './types';

// ─── Types ────────────────────────────────────────────────────────────────

interface StateRow {
  user_id: string;
  key: string;
  value: string;
  updated_at: number;
}

type SetResult =
  | { ok: true }
  | { ok: false; error: StateErrorCode };

// ─── StateManager ─────────────────────────────────────────────────────────

/**
 * Server-side per-user KV state manager.
 *
 * Two-tier storage:
 * - RAM: Map<userId, Map<key, JsonValue>> for fast reads
 * - SQLite: _user_state table for durability
 *
 * Write-through: every set/delete/clear writes to both RAM and SQLite.
 * On first subscribe for a user, loads from SQLite if RAM is empty
 * (handles server restart gracefully).
 */
export class StateManager {
  private ram = new Map<string, Map<string, JsonValue>>();

  private stmts: {
    getUserState: Statement;
    upsertState: Statement;
    deleteState: Statement;
    clearUserState: Statement;
  };

  constructor(private db: ReactiveDB) {
    // Create _user_state table (internal — no broadcast)
    db.exec(`
      CREATE TABLE IF NOT EXISTS _user_state (
        user_id    TEXT NOT NULL,
        key        TEXT NOT NULL,
        value      TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, key)
      )
    `);
    db.exec(
      'CREATE INDEX IF NOT EXISTS idx_user_state_user ON _user_state(user_id)'
    );

    this.stmts = {
      getUserState: db.prepare(
        'SELECT key, value FROM _user_state WHERE user_id = ?'
      ),
      upsertState: db.prepare(`
        INSERT INTO _user_state (user_id, key, value, updated_at) VALUES (?, ?, ?, ?)
        ON CONFLICT (user_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
      `),
      deleteState: db.prepare(
        'DELETE FROM _user_state WHERE user_id = ? AND key = ?'
      ),
      clearUserState: db.prepare(
        'DELETE FROM _user_state WHERE user_id = ?'
      ),
    };
  }

  // ─── Read ────────────────────────────────────────────────────────────

  /**
   * Get the full state map for a user.
   * Loads from SQLite on first access if RAM is empty (server restart).
   */
  getUserState(userId: string): Map<string, JsonValue> {
    let userMap = this.ram.get(userId);
    if (!userMap) {
      userMap = this.loadFromSQLite(userId);
      this.ram.set(userId, userMap);
    }
    return userMap;
  }

  /**
   * Get user state as a plain object (for snapshots).
   */
  getUserStateEntries(userId: string): Record<string, JsonValue> {
    const map = this.getUserState(userId);
    const entries: Record<string, JsonValue> = {};
    for (const [key, value] of map) {
      entries[key] = value;
    }
    return entries;
  }

  // ─── Write ───────────────────────────────────────────────────────────

  /**
   * Set a key-value pair for a user.
   * Validates limits before writing. Returns error code on failure.
   */
  set(userId: string, key: string, value: JsonValue): SetResult {
    // Validate key length
    if (key.length > STATE_LIMITS.maxKeyLength) {
      return { ok: false, error: 'KEY_TOO_LONG' };
    }

    // Validate value size
    const serialized = JSON.stringify(value);
    if (serialized.length > STATE_LIMITS.maxValueSize) {
      return { ok: false, error: 'VALUE_TOO_LARGE' };
    }

    const userMap = this.getUserState(userId);

    // Validate key count (only if this is a new key)
    if (!userMap.has(key) && userMap.size >= STATE_LIMITS.maxKeys) {
      return { ok: false, error: 'TOO_MANY_KEYS' };
    }

    // Validate total size
    const currentSize = this.estimateUserSize(userMap);
    const oldValueSize = userMap.has(key)
      ? JSON.stringify(userMap.get(key)).length
      : 0;
    const newTotalSize = currentSize - oldValueSize + serialized.length;
    if (newTotalSize > STATE_LIMITS.maxTotalSize) {
      return { ok: false, error: 'TOTAL_SIZE_EXCEEDED' };
    }

    // Write-through: RAM + SQLite
    userMap.set(key, value);
    this.stmts.upsertState.run(userId, key, serialized, Date.now());

    return { ok: true };
  }

  /**
   * Delete a key for a user. No-op if key doesn't exist.
   */
  delete(userId: string, key: string): void {
    const userMap = this.getUserState(userId);
    userMap.delete(key);
    this.stmts.deleteState.run(userId, key);
  }

  /**
   * Clear all state for a user.
   */
  clear(userId: string): void {
    this.ram.set(userId, new Map());
    this.stmts.clearUserState.run(userId);
  }

  // ─── Internal ────────────────────────────────────────────────────────

  /**
   * Load user state from SQLite into a Map.
   * Called on first access after server restart.
   */
  private loadFromSQLite(userId: string): Map<string, JsonValue> {
    const rows = this.stmts.getUserState.all(userId) as StateRow[];
    const map = new Map<string, JsonValue>();
    for (const row of rows) {
      try {
        map.set(row.key, JSON.parse(row.value));
      } catch {
        // Corrupted value — skip it
      }
    }
    return map;
  }

  /**
   * Estimate total serialized size of a user's state in bytes.
   */
  private estimateUserSize(userMap: Map<string, JsonValue>): number {
    let size = 0;
    for (const [key, value] of userMap) {
      size += key.length + JSON.stringify(value).length;
    }
    return size;
  }
}
