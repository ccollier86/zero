/** Managed upgrade 043→044 and standalone actor-ledger schema parity without touching application databases. */
import { Database } from 'bun:sqlite';
import { expect, test } from 'bun:test';
import { migrations } from './index';
import { Migrator } from './migrator';
import { workflowContractFixture } from '../workflows/workflow-contracts.test-support';

test('044 installs the same private actor receipt ledger and usage accounting as standalone Torrent', async () => {
  const database = new Database(':memory:'), fixture = workflowContractFixture();
  try {
    const prior = new Migrator({ database, dbPath: ':memory:', migrations: migrations.filter(m => m.version <= '043'), createBackups: false, log: () => {} });
    prior.run(); prior.dispose();
    const next = new Migrator({ database, dbPath: ':memory:', migrations: migrations.filter(m => m.version <= '044'), createBackups: false, log: () => {} });
    try { expect(next.run()).toEqual(['044']); } finally { next.dispose(); }
    const schema = (db: Database) => (db.query(`SELECT name, sql FROM sqlite_master WHERE (name LIKE '%workflow_actor_start%' OR tbl_name LIKE '%workflow_actor_start%') AND sql IS NOT NULL ORDER BY name`).all() as Array<{ name: string; sql: string }>).map(row => ({ name: row.name, sql: row.sql.replace(/\s+/g, ' ').trim() }));
    expect(schema(database)).toEqual(schema(fixture.db.getRawDatabase()));
    expect(schema(database).length).toBe(7);
    expect(() => database.exec(`INSERT INTO _workflow_actor_start_usage VALUES ('application','application','actor',100001)`)).toThrow();
    expect(database.query("SELECT COUNT(*) AS n FROM workflow_instances").get()).toEqual({ n: 0 });
  } finally { database.close(); await fixture.close(); }
});
