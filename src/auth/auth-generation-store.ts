/**
 * auth-generation-store.ts
 *
 * Persists the per-user generation used to invalidate stateless access and
 * auth-transition tokens. It owns only the internal generation table.
 */

import type { Statement } from 'bun:sqlite';
import type { ReactiveDB } from '../sync/reactive-db';

export class AuthGenerationStore {
  private readonly bumpStatement: Statement;
  private readonly getStatement: Statement;

  constructor(db: ReactiveDB) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS _auth_user_generations (
        user_id TEXT PRIMARY KEY,
        generation INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
      )
    `);
    this.bumpStatement = db.prepare(
      `INSERT INTO _auth_user_generations (user_id, generation) VALUES (?, 1)
       ON CONFLICT(user_id) DO UPDATE SET generation = generation + 1`
    );
    this.getStatement = db.prepare(
      'SELECT generation FROM _auth_user_generations WHERE user_id = ?'
    );
  }

  /** Increment the generation after any security boundary invalidation. */
  bump(userId: string): void {
    this.bumpStatement.run(userId);
  }

  /** Return zero for users that have never required invalidation. */
  get(userId: string): number {
    const row = this.getStatement.get(userId) as { generation: number } | null;
    return row?.generation ?? 0;
  }
}
