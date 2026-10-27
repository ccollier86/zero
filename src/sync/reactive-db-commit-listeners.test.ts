/** Local wake hints do not invent row changes, weaken commit admission or report rolled-back work. */
import { expect, test } from 'bun:test';
import { createReactiveDB, registerReactiveDBCommitGuard } from './reactive-db';
import { OBS_CODES } from '../observability/codes';

test('private prepared SQL emits one settled root commit hint, no tracked rows, and no rollback hint', () => {
  const db = createReactiveDB({ mode: 'memory' });
  try {
    db.exec('CREATE TABLE private_values (id TEXT PRIMARY KEY,value TEXT NOT NULL)');
    const write = db.prepare('INSERT INTO private_values VALUES (?,?)');
    let commits = 0, rows = 0;
    db.onChange(() => { rows++; }); db.onCommit(() => { commits++; expect(db.prepare('SELECT count(*) AS n FROM private_values').get()).toEqual({ n: 2 }); });
    db.transaction(() => { write.run('one', 'Synthetic one'); db.transaction(() => { write.run('two', 'Synthetic two'); }); expect(commits).toBe(0); });
    expect(commits).toBe(1); expect(rows).toBe(0);
    expect(() => db.transaction(() => { write.run('three', 'Must roll back'); throw new Error('Synthetic rejection'); })).toThrow('Synthetic rejection');
    expect(commits).toBe(1); expect(db.prepare('SELECT count(*) AS n FROM private_values').get()).toEqual({ n: 2 });
  } finally { db.dispose(); }
});

test('commit hints run after the actual commit lease is released and cannot change an accepted outcome', () => {
  const codes: string[] = [], details: string[] = [], db = createReactiveDB({ mode: 'memory', emitCode: (definition, options) => { codes.push(definition.code); details.push(JSON.stringify(options ?? {})); } });
  try {
    db.defineTable('items', { id: 'text primary key' });
    let leased = false, observed = 0, observedLease: boolean | undefined;
    registerReactiveDBCommitGuard(db, { capture() { return undefined; }, beforeCommit() { leased = true; return () => { leased = false; }; } });
    db.onCommit(() => { observedLease = leased; throw new Error('SYNTHETIC_PRIVATE_OBSERVER_FAILURE'); });
    db.onCommit(() => { observed++; });
    expect(db.create('items', { id: 'accepted' }).row).toMatchObject({ id: 'accepted' });
    expect(observedLease).toBe(false);
    expect(observed).toBe(1); expect(db.get('items', 'accepted')).not.toBeNull();
    expect(codes).toContain(OBS_CODES.SYNC_POST_COMMIT_NOTIFICATION_FAILED.code);
    expect(details.join('')).not.toContain('SYNTHETIC_PRIVATE_OBSERVER_FAILURE');
  } finally { db.dispose(); }
});

test('commit listener detach is idempotent and stable batches do not erase replacement observers', () => {
  const db = createReactiveDB({ mode: 'memory' });
  try {
    const seen: string[] = []; let remove!: () => void;
    db.onCommit(() => { seen.push('first'); remove(); });
    remove = db.onCommit(() => { seen.push('second'); });
    db.transaction(() => {}); expect(seen).toEqual(['first', 'second']);
    remove(); remove(); db.onCommit(() => { seen.push('replacement'); });
    seen.length = 0; db.transaction(() => {}); expect(seen).toEqual(['first', 'replacement']);
  } finally { db.dispose(); }
  expect(() => db.onCommit(() => {})).toThrow();
});

test('async/thenable commit observers are diagnosed without dropping later synchronous observers', async () => {
  const codes: string[] = [], db = createReactiveDB({ mode: 'memory', emitCode: definition => { codes.push(definition.code); } });
  try {
    let later = false;
    db.onCommit(() => Promise.reject(new Error('Synthetic asynchronous observer')));
    db.onCommit(() => { later = true; });
    db.transaction(() => {}); await Promise.resolve();
    expect(later).toBe(true); expect(codes).toContain(OBS_CODES.SYNC_POST_COMMIT_NOTIFICATION_FAILED.code);
  } finally { db.dispose(); }
});
