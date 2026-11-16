/** Synthetic in-memory native SYSTEM only; no calendar files, actors or generated disk fixtures. */
import { expect, test } from 'bun:test';
import { createReactiveDB } from '../sync/reactive-db';
import { CALENDAR_OWNER_SCHEMA, inspectCalendarOwnerSchema, installCalendarOwnerSchema, type CalendarOwnerRecord } from './owner-schema';

function fixture() {
  const database = createReactiveDB({ mode: 'memory' });
  return { database, close: () => database.dispose() };
}

test('calendar owner inspection and withheld installation are read-only on populated SYSTEM', () => {
  const f = fixture();
  try {
    f.database.exec('CREATE TABLE application_evidence (id TEXT PRIMARY KEY,value TEXT NOT NULL)');
    f.database.prepare('INSERT INTO application_evidence VALUES(?,?)').run('retained', 'preserve');
    const before = f.database.prepare('SELECT type,name,sql FROM sqlite_master ORDER BY name').all();
    expect(inspectCalendarOwnerSchema(f.database)).toBe('missing');
    expect(installCalendarOwnerSchema(f.database, false)).toBe(false);
    expect(f.database.prepare('SELECT type,name,sql FROM sqlite_master ORDER BY name').all()).toEqual(before);
    expect(f.database.prepare('SELECT * FROM application_evidence').all()).toEqual([{ id: 'retained', value: 'preserve' }]);
  } finally { f.close(); }
});

test('explicit owner installation is additive and replay preserves established and pending ownership', () => {
  const f = fixture();
  try {
    expect(installCalendarOwnerSchema(f.database, true)).toBe(true);
    expect(inspectCalendarOwnerSchema(f.database)).toBe('ready');
    const established: CalendarOwnerRecord = {
      id: 'calendar:synthetic-application', scope_id: 'application', owner_id: 'cal_synthetic-owner',
      root_hash: 'synthetic-root', realm_fingerprint: 'sha256:synthetic-realm', established: 1,
    };
    const pending: CalendarOwnerRecord = { ...established, id: 'calendar:synthetic-tenant', scope_id: 'tenant:synthetic', owner_id: 'cal_pending-owner', established: 0 };
    for (const record of [established, pending]) f.database.prepare('INSERT INTO _calendar_owners(id,scope_id,owner_id,root_hash,realm_fingerprint,established) VALUES(?,?,?,?,?,?)')
      .run(record.id, record.scope_id, record.owner_id, record.root_hash, record.realm_fingerprint, record.established);
    const schema = f.database.prepare('SELECT type,name,sql FROM sqlite_master ORDER BY name').all();
    expect(installCalendarOwnerSchema(f.database, false)).toBe(true);
    expect(installCalendarOwnerSchema(f.database, true)).toBe(true);
    expect(f.database.prepare('SELECT * FROM _calendar_owners ORDER BY id').all()).toEqual([established, pending]);
    expect(f.database.prepare('SELECT type,name,sql FROM sqlite_master ORDER BY name').all()).toEqual(schema);
  } finally { f.close(); }
});

test('owner catalog pins one scope identity and restricts established markers', () => {
  const f = fixture();
  try {
    installCalendarOwnerSchema(f.database, true);
    const insert = f.database.prepare('INSERT INTO _calendar_owners VALUES(?,?,?,?,?,?)');
    insert.run('calendar:first', 'application', 'owner:first', 'root', 'fingerprint', 0);
    expect(() => insert.run('calendar:second', 'application', 'owner:second', 'root', 'fingerprint', 0)).toThrow();
    expect(() => insert.run('calendar:third', 'tenant:third', 'owner:third', 'root', 'fingerprint', 2)).toThrow();
    expect(f.database.prepare('SELECT count(*) AS count FROM _calendar_owners').get()).toEqual({ count: 1 });
  } finally { f.close(); }
});

test('incompatible owner tables and object collisions fail closed without altering retained evidence', () => {
  for (const sql of [
    'CREATE TABLE _calendar_owners (id TEXT PRIMARY KEY,retained TEXT NOT NULL)',
    'CREATE VIEW _calendar_owners AS SELECT \'retained\' AS value',
    'CREATE TABLE _CALENDAR_OWNERS (id TEXT PRIMARY KEY,retained TEXT NOT NULL)',
  ]) {
    const f = fixture();
    try {
      f.database.exec(sql);
      const before = f.database.prepare('SELECT type,name,sql FROM sqlite_master ORDER BY name').all();
      expect(inspectCalendarOwnerSchema(f.database)).toBe('invalid');
      for (const allowed of [false, true]) expect(() => installCalendarOwnerSchema(f.database, allowed)).toThrow(expect.objectContaining({ code: 'CALENDAR_STATE_INVALID' }));
      expect(f.database.prepare('SELECT type,name,sql FROM sqlite_master ORDER BY name').all()).toEqual(before);
    } finally { f.close(); }
  }
});

test('canonical owner schema accepts SQLite-normalized whitespace and omitted IF NOT EXISTS', () => {
  const f = fixture();
  try {
    f.database.exec(CALENDAR_OWNER_SCHEMA.replace(' IF NOT EXISTS', '').replaceAll(' ', '\n  '));
    expect(inspectCalendarOwnerSchema(f.database)).toBe('ready');
    expect(installCalendarOwnerSchema(f.database, false)).toBe(true);
  } finally { f.close(); }
});
