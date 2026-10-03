import { describe, expect, test } from 'bun:test';

import { projectResourceRow } from '../resources/resource-field-access';
import { DATA_STUDIO_CLIENT_TABLES } from './data-studio-client-tables';
import { DATA_STUDIO_RESOURCES } from './data-studio-resources';
import {
  DATA_STUDIO_ROWS_TABLE_NAME,
  DATA_STUDIO_TABLES_TABLE_NAME,
} from './data-studio-tenant-schema';

describe('Data Studio reconciliation resources', () => {
  test('keep canonical schemas and row values off generic HTTP and Sync pages', () => {
    const catalog = DATA_STUDIO_RESOURCES.find(
      (resource) => resource.table === DATA_STUDIO_TABLES_TABLE_NAME,
    )!;
    const rows = DATA_STUDIO_RESOURCES.find(
      (resource) => resource.table === DATA_STUDIO_ROWS_TABLE_NAME,
    )!;

    expect(catalog.exposure).toBe('all');
    expect(rows.exposure).toBe('all');
    expect(catalog.fields?.read).not.toContain('schema_json');
    expect(rows.fields?.read).not.toContain('values_json');
    expect(DATA_STUDIO_CLIENT_TABLES.data_studio_tables).not.toHaveProperty(
      'schema_json',
    );
    expect(DATA_STUDIO_CLIENT_TABLES.data_studio_rows).not.toHaveProperty(
      'values_json',
    );
  });

  test('projects a maximum-size physical row into bounded invalidation metadata', () => {
    const resource = DATA_STUDIO_RESOURCES.find(
      (candidate) => candidate.table === DATA_STUDIO_ROWS_TABLE_NAME,
    )!;
    const projected = projectResourceRow({
      record_id: 'record_1',
      table_id: 'table_1',
      row_id: 'row_1',
      schema_revision: 1,
      values_json: 'x'.repeat(256 * 1024),
      revision: 2,
      created_at: 1,
      updated_at: 2,
    }, resource.fields);

    expect(projected).not.toHaveProperty('values_json');
    expect(projected).toEqual({
      record_id: 'record_1',
      table_id: 'table_1',
      row_id: 'row_1',
      schema_revision: 1,
      revision: 2,
      created_at: 1,
      updated_at: 2,
    });
    expect(JSON.stringify(projected).length).toBeLessThan(512);
  });
});
