import { expect, test } from 'bun:test';
import { checkTableMap } from './table-map';

const table = { table: 'clinical_notes', rows: 5, columns: ['id', 'body'], schemaSha256: 'a'.repeat(64), rowsSha256: 'b'.repeat(64) };
const evidence = { schema: 1, kind: 'practiceiq-offline-sqlite', inventory: 'all', tables: [table] };
const mapping = { table: table.table, rows: table.rows, schemaSha256: table.schemaSha256, rowsSha256: table.rowsSha256,
  owner: 'application', action: 'preserve', targetPlane: 'application', targetTable: 'clinical_notes', rule: 'identity-v1' };
const plan = (tables: unknown[]) => ({ schema: 1, kind: 'practiceiq-table-map', tables });

test('requires a current explicit disposition for every evidenced source table', () => {
  expect(() => checkTableMap(evidence, plan([mapping]))).not.toThrow();
  expect(() => checkTableMap({ ...evidence, inventory: 'selected' }, plan([mapping]))).toThrow('UPGRADE_FULL_INVENTORY_REQUIRED');
  expect(() => checkTableMap(evidence, plan([]))).toThrow('UPGRADE_TABLE_MAP_INCOMPLETE');
  expect(() => checkTableMap(evidence, plan([{ ...mapping, table: 'unknown' }]))).toThrow('UPGRADE_TABLE_MAP_UNKNOWN_SOURCE');
  for (const stale of [{ rows: 6 }, { schemaSha256: 'c'.repeat(64) }, { rowsSha256: 'd'.repeat(64) }]) {
    expect(() => checkTableMap(evidence, plan([{ ...mapping, ...stale }]))).toThrow('UPGRADE_TABLE_MAP_STALE_SOURCE');
  }
});

test('rejects duplicate, guessed, unowned and destructive mapping shortcuts', () => {
  const expanded = { ...evidence, tables: [table, { ...table, table: 'users' }] };
  expect(() => checkTableMap(expanded, plan([mapping, mapping]))).toThrow('UPGRADE_TABLE_MAP_INVALID');
  for (const invalid of [{ owner: 'guess' }, { targetPlane: 'guess' }, { rule: 'SQL goes here' },
    { action: 'drop' }, { action: 'rebuild' }, { targetTable: '../outside' }, { force: true }, { targetTable: undefined }]) {
    expect(() => checkTableMap(evidence, plan([{ ...mapping, ...invalid }]))).toThrow();
  }
  const { targetTable, targetPlane, ...rebuild } = { ...mapping, action: 'rebuild', owner: 'ephemeral' };
  expect(() => checkTableMap(evidence, plan([rebuild]))).not.toThrow();
  expect(() => checkTableMap({ ...evidence, kind: 'forged' }, plan([mapping]))).toThrow('UPGRADE_SQLITE_EVIDENCE_INVALID');
});

test('runtime receipts and sync-mode decisions have explicit non-disposable framework ownership', () => {
  for (const [name, owner, targetPlane] of [['_sync_mutation_receipts', 'application-runtime', 'application'], ['_zero_sync_table_modes', 'system', 'system']]) {
    const source = { ...evidence, tables: [{ ...table, table: name }] };
    const entry = { ...mapping, table: name, targetTable: name, owner, targetPlane };
    expect(() => checkTableMap(source, plan([entry]))).not.toThrow();
    for (const invalid of [{ owner: 'application' }, { owner: 'ephemeral', action: 'rebuild', targetPlane: undefined, targetTable: undefined },
      { targetPlane: targetPlane === 'system' ? 'application' : 'system' }, { targetTable: 'renamed_runtime' }]) {
      expect(() => checkTableMap(source, plan([{ ...entry, ...invalid }]))).toThrow('UPGRADE_TABLE_MAP_INVALID');
    }
  }
});
