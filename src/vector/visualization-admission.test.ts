/** Optional schema checks use only isolated in-memory SQLite. */
import { describe, expect, it, spyOn } from 'bun:test';
import { Migrator, migrations } from '../migrations';
import { createReactiveDB, type ReactiveDB } from '../sync/reactive-db';
import { admitVectorVisualizationSchema, vectorVisualizationSchemaReady } from './visualization-admission';
import { VECTOR_VISUALIZATION_MAPS_TABLE, VECTOR_VISUALIZATION_OPERATIONS_TABLE, VECTOR_VISUALIZATION_FEED_TABLE } from './visualization-schema';
import { VECTOR_VISUALIZATION_SCHEMA_OBJECTS } from './visualization-migration';

function schema(db: ReactiveDB) {
  const stmt = db.prepare('SELECT name,type,sql FROM sqlite_master ORDER BY name');
  try { return stmt.all(); } finally { stmt.finalize(); }
}
describe('optional vector visualization schema', () => {
  it('migrate:false rejects absent feature objects without changing any schema', () => {
    const db = createReactiveDB({ mode: 'memory' });
    try {
      const before = schema(db);
      expect(vectorVisualizationSchemaReady(db)).toBe(false);
      expect(() => admitVectorVisualizationSchema(db, false)).toThrow();
      expect(schema(db)).toEqual(before);
      expect(db.hasTable(VECTOR_VISUALIZATION_OPERATIONS_TABLE)).toBe(false);
      expect(db.hasTable(VECTOR_VISUALIZATION_MAPS_TABLE)).toBe(false);
      expect(db.hasTable(VECTOR_VISUALIZATION_FEED_TABLE)).toBe(false);
    } finally { db.dispose(); }
  });
  it('explicit optional admission provisions exact schemas once without creating a foreign migration ledger', () => {
    const db = createReactiveDB({ mode: 'memory' });
    try {
      admitVectorVisualizationSchema(db, true);
      expect(vectorVisualizationSchemaReady(db)).toBe(true);
      expect(db.getPrimaryKey(VECTOR_VISUALIZATION_OPERATIONS_TABLE)).toBe('operation_id');
      expect(db.getPrimaryKey(VECTOR_VISUALIZATION_MAPS_TABLE)).toBe('map_id');
      expect(db.getPrimaryKey(VECTOR_VISUALIZATION_FEED_TABLE)).toBe('feed_id');
      const before = schema(db);
      admitVectorVisualizationSchema(db, true);
      admitVectorVisualizationSchema(db, false);
      expect(schema(db)).toEqual(before);
      const statement = db.prepare("SELECT name FROM sqlite_master WHERE name IN ('_zero_migrations','_migrations')");
      try { expect(statement.all()).toEqual([]); }
      finally { statement.finalize(); }
    } finally { db.dispose(); }
  });
  it('refuses conflicting tables without replacing user data or installing unrelated missing objects', () => {
    const db = createReactiveDB({ mode: 'memory' });
    try {
      db.exec(`CREATE TABLE ${VECTOR_VISUALIZATION_OPERATIONS_TABLE} (operation_id TEXT PRIMARY KEY, user_content TEXT NOT NULL)`);
      const insert = db.prepare(`INSERT INTO ${VECTOR_VISUALIZATION_OPERATIONS_TABLE} VALUES (?,?)`);
      try { insert.run('mine', 'preserve user content'); } finally { insert.finalize(); }
      const before = schema(db);
      for (const allowed of [false, true]) expect(() => admitVectorVisualizationSchema(db, allowed)).toThrow();
      expect(schema(db)).toEqual(before);
      const read = db.prepare(`SELECT * FROM ${VECTOR_VISUALIZATION_OPERATIONS_TABLE}`);
      try { expect(read.all()).toEqual([{ operation_id: 'mine', user_content: 'preserve user content' }]); }
      finally { read.finalize(); }
      expect(db.hasTable(VECTOR_VISUALIZATION_MAPS_TABLE)).toBe(false);
      expect(db.hasTable(VECTOR_VISUALIZATION_FEED_TABLE)).toBe(false);
    } finally { db.dispose(); }
  });
  it('refuses wrong-type/name-colliding index objects before any migration', () => {
    const db = createReactiveDB({ mode: 'memory' });
    try {
      db.exec('CREATE TABLE idx_vector_visualization_owner (id TEXT PRIMARY KEY)');
      const before = schema(db);
      expect(() => admitVectorVisualizationSchema(db, true)).toThrow();
      expect(schema(db)).toEqual(before);
      expect(db.hasTable(VECTOR_VISUALIZATION_OPERATIONS_TABLE)).toBe(false);
    } finally { db.dispose(); }
  });
  it('coexists with all core migration history and preserves its exact checksums on restart', () => {
    const db = createReactiveDB({ mode: 'memory' });
    const migrator = new Migrator({ database: db.getRawDatabase(), migrations, createBackups: false, log: () => {} });
    try {
      expect(migrator.run()).toHaveLength(migrations.length);
      const history = db.prepare('SELECT version,checksum,status,direction FROM _zero_migrations ORDER BY id');
      try {
        const before = history.all();
        admitVectorVisualizationSchema(db, true);
        expect(vectorVisualizationSchemaReady(db)).toBe(true);
        expect(history.all()).toEqual(before);
        expect(migrator.run()).toEqual([]);
        admitVectorVisualizationSchema(db, false);
        expect(history.all()).toEqual(before);
      } finally { history.finalize(); }
    } finally { migrator.dispose(); db.dispose(); }
  });
  it('rolls back every feature object if fixed-schema installation fails after DDL', () => {
    const db = createReactiveDB({ mode: 'memory' });
    const raw = db.getRawDatabase();
    const execute = raw.exec.bind(raw);
    const before = schema(db);
    const fault = spyOn(raw, 'exec').mockImplementation(sql => {
      const result = execute(sql);
      if (sql.includes('CREATE TABLE IF NOT EXISTS vector_visualization_operations')) throw new Error('Injected fixed-schema installation failure');
      return result;
    });
    try {
      expect(() => admitVectorVisualizationSchema(db, true)).toThrow('Injected fixed-schema installation failure');
      expect(schema(db)).toEqual(before);
      expect(db.hasTable(VECTOR_VISUALIZATION_OPERATIONS_TABLE)).toBe(false);
      expect(db.hasTable(VECTOR_VISUALIZATION_MAPS_TABLE)).toBe(false);
      expect(db.hasTable(VECTOR_VISUALIZATION_FEED_TABLE)).toBe(false);
    } finally { fault.mockRestore(); db.dispose(); }
  });
  it('adds only the bounded feed to an older admitted feature and refuses that upgrade with migrate:false', () => {
    const db = createReactiveDB({ mode: 'memory' });
    try {
      for (const object of VECTOR_VISUALIZATION_SCHEMA_OBJECTS) if (object.name !== VECTOR_VISUALIZATION_FEED_TABLE) db.exec(object.sql);
      db.exec(`INSERT INTO vector_visualization_operations VALUES ('kept','application','user:a',NULL,'docs','search','completed',1,'{}','2026-10-09T12:00:00Z','2026-10-09T12:00:00Z')`);
      const before = schema(db);
      expect(vectorVisualizationSchemaReady(db)).toBe(false);
      expect(() => admitVectorVisualizationSchema(db, false)).toThrow();
      expect(schema(db)).toEqual(before);
      admitVectorVisualizationSchema(db, true);
      expect(vectorVisualizationSchemaReady(db)).toBe(true);
      expect(db.getPrimaryKey(VECTOR_VISUALIZATION_FEED_TABLE)).toBe('feed_id');
      expect(db.prepare('SELECT operation_id FROM vector_visualization_operations').all()).toEqual([{ operation_id: 'kept' }]);
      expect(db.prepare('SELECT * FROM vector_visualization_feed').all()).toEqual([]);
      expect(schema(db).filter((row: unknown) => (row as { name: string }).name.startsWith('_zero_migrations'))).toEqual([]);
    } finally { db.dispose(); }
  });
});
