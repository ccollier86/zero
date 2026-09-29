import type { Statement } from 'bun:sqlite';
import type { ReactiveDB } from '../sync/reactive-db';

interface PropertyRow {
  key: string;
  value: string | null;
}

interface ConfigRow {
  value: string;
}

export interface UserPropertyConfigStoreOptions {
  mutation<T>(operation: () => T): T;
  assertCurrentProfile(): void;
}

/**
 * Internal persistence owner for composite-key user properties and auth config.
 *
 * These tables are intentionally outside ReactiveDB's single-primary-key CRUD
 * surface. The public UserStore facade supplies the transaction and committed
 * runtime-profile boundaries used by every externally reachable operation.
 */
export class UserPropertyConfigStore {
  private readonly stmts: {
    insertProperty: Statement;
    getProperty: Statement;
    getProperties: Statement;
    deleteProperty: Statement;
    getConfig: Statement;
    setConfig: Statement;
  };

  constructor(
    db: ReactiveDB,
    private readonly options: UserPropertyConfigStoreOptions,
  ) {
    this.stmts = {
      insertProperty: db.prepare(
        'INSERT OR REPLACE INTO user_properties (user_id, key, value) VALUES (?, ?, ?)',
      ),
      getProperty: db.prepare(
        'SELECT value FROM user_properties WHERE user_id = ? AND key = ?',
      ),
      getProperties: db.prepare(
        'SELECT key, value FROM user_properties WHERE user_id = ?',
      ),
      deleteProperty: db.prepare(
        'DELETE FROM user_properties WHERE user_id = ? AND key = ?',
      ),
      getConfig: db.prepare('SELECT value FROM _auth_config WHERE key = ?'),
      setConfig: db.prepare(
        'INSERT OR REPLACE INTO _auth_config (key, value) VALUES (?, ?)',
      ),
    };
  }

  /** Insert properties while the facade already owns the writer transaction. */
  insertPropertiesInCurrentTransaction(
    userId: string,
    properties: Record<string, string>,
  ): void {
    for (const [key, value] of Object.entries(properties)) {
      this.stmts.insertProperty.run(userId, key, value);
    }
  }

  setProperty(userId: string, key: string, value: string): void {
    this.options.mutation(() => this.stmts.insertProperty.run(userId, key, value));
  }

  setProperties(userId: string, properties: Record<string, string>): void {
    this.options.mutation(() => {
      this.insertPropertiesInCurrentTransaction(userId, properties);
    });
  }

  getProperty(userId: string, key: string): string | null {
    this.options.assertCurrentProfile();
    const row = this.stmts.getProperty.get(userId, key) as {
      value: string | null;
    } | null;
    return row?.value ?? null;
  }

  getProperties(userId: string): Record<string, string> {
    this.options.assertCurrentProfile();
    return this.loadPropertiesInCurrentProfile(userId);
  }

  /** Read properties after the caller has already checked the runtime profile. */
  loadPropertiesInCurrentProfile(userId: string): Record<string, string> {
    const rows = this.stmts.getProperties.all(userId) as PropertyRow[];
    const result: Record<string, string> = {};
    for (const row of rows) {
      if (row.value !== null) result[row.key] = row.value;
    }
    return result;
  }

  deleteProperty(userId: string, key: string): void {
    this.options.mutation(() => this.stmts.deleteProperty.run(userId, key));
  }

  getConfig(key: string): string | null {
    this.options.assertCurrentProfile();
    const row = this.stmts.getConfig.get(key) as ConfigRow | null;
    return row?.value ?? null;
  }

  setConfig(key: string, value: string): void {
    this.options.mutation(() => this.stmts.setConfig.run(key, value));
  }
}
