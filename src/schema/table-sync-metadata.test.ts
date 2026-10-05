/** Synthetic config admission only; no server, app configuration or live files. */

import { describe, expect, test } from 'bun:test';
import { defineTable, field, schema } from './index';
import { resolveConfig } from '../frontend/server/types';
import { createReactiveDB } from '../sync/reactive-db';
import type { DeclaredSyncMode } from '../sync/types';

describe('schema server projection loading intent', () => {
  for (const mode of ['full', 'lazy', 'auto'] satisfies DeclaredSyncMode[]) {
    test(`preserves ${mode} through schema().serverTables and defineTable server shapes`, () => {
      const bundle = schema({ tasks: { fields: { title: field.text() }, sync: mode } });
      const defined = defineTable('tasks', { title: field.text() }, { sync: mode });
      for (const input of [bundle.serverTables.tasks, defined, defined.serverTable, { ...defined.serverTable }]) {
        const resolved = resolveConfig({ db: { mode: 'memory' }, tables: { tasks: input } });
        expect(resolved.declaredSyncModes.get('tasks')).toBe(mode);
        expect(resolved.tableColumns.get('tasks')).toEqual(['id', 'title']);
      }
      expect(Object.keys(bundle.serverTables.tasks)).toEqual(['id', 'title']);
      expect(JSON.parse(JSON.stringify(bundle.serverTables.tasks))).toEqual({ id: 'text primary key', title: 'text' });
      expect(bundle.clientTables.tasks._sync).toBe(mode);
    });
  }

  test('explicit app syncDefaults still override schema intent', () => {
    const bundle = schema({ tasks: { fields: { title: field.text() }, sync: 'lazy' } });
    const resolved = resolveConfig({
      db: { mode: 'memory' }, tables: bundle.serverTables,
      syncDefaults: { defaultMode: 'full', tables: { tasks: 'auto' } },
    });
    expect(resolved.declaredSyncModes.get('tasks')).toBe('auto');
  });

  test('omitted modes inherit the app default without fabricating metadata', () => {
    const bundle = schema({ tasks: { fields: { title: field.text() } } });
    const defined = defineTable('tasks', { title: field.text() });
    for (const input of [bundle.serverTables.tasks, defined, defined.serverTable]) {
      expect(resolveConfig({ db: { mode: 'memory' }, tables: { tasks: input } }).declaredSyncModes.get('tasks')).toBe('auto');
      expect(resolveConfig({ db: { mode: 'memory' }, tables: { tasks: input }, syncDefaults: { defaultMode: 'full' } }).declaredSyncModes.get('tasks')).toBe('full');
    }
    expect(bundle.clientTables.tasks._sync).toBeUndefined();
  });

  test('metadata never becomes a SQLite column', () => {
    const bundle = schema({ tasks: { fields: { title: field.text() }, sync: 'lazy' } });
    const db = createReactiveDB({ mode: 'memory' });
    try {
      db.defineTable('tasks', bundle.serverTables.tasks);
      db.insert('tasks', { id: 'synthetic-task', title: 'Task' });
      expect(db.get('tasks', 'synthetic-task')).toEqual({ id: 'synthetic-task', title: 'Task' });
    } finally { db.dispose(); }
  });
});
