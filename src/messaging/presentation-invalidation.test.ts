/** In-memory only: projection hints own no filesystem, listeners or fixture state after teardown. */
import { expect, test } from 'bun:test';
import { createReactiveDB } from '../sync/reactive-db';
import { defineAuthTables } from '../auth/auth-schema';
import { installAuthAuthorityRevision } from '../auth/auth-authority-revision';
import { observeMessagingPresentationCommits, observeMessagingSystemPresentation } from './presentation-invalidation';
import { MessagingRuntime } from './runtime';

test('private committed writes wake admitted projections without a read-triggered feedback loop', () => {
  const db = createReactiveDB({ mode: 'memory' }); let remove: (() => void) | undefined;
  try {
    db.exec('CREATE TABLE private_photos (id TEXT PRIMARY KEY, revision INTEGER NOT NULL)');
    let wakes = 0;
    remove = observeMessagingPresentationCommits(db, () => {
      wakes++;
      db.transaction(() => { db.prepare('SELECT * FROM private_photos').all(); });
    });
    db.transaction(() => {});
    db.transaction(() => { db.prepare('SELECT * FROM private_photos').all(); });
    expect(wakes).toBe(0);
    db.transaction(() => { db.prepare('INSERT INTO private_photos VALUES (?,?)').run('synthetic', 1); });
    expect(wakes).toBe(1);
    db.transaction(() => { db.prepare('UPDATE private_photos SET revision=2 WHERE id=?').run('synthetic'); });
    expect(wakes).toBe(2);
    db.transaction(() => {}); expect(wakes).toBe(2);
    remove();
    db.transaction(() => { db.prepare('DELETE FROM private_photos').run(); }); expect(wakes).toBe(2);
  } finally { remove?.(); db.dispose(); }
});

function guardian() {
  const db = createReactiveDB({ mode: 'memory' });
  try {
    defineAuthTables(db); installAuthAuthorityRevision(db);
    db.insert('users', { user_id: 'synthetic', username: 'synthetic', email: 'synthetic@example.test', role: 'user', status: 'active', created_at: 1 });
    db.defineTable('synthetic_notices', { id: 'text primary key', value: 'text' });
    db.exec('CREATE TABLE _synthetic_private_outbox (id TEXT PRIMARY KEY, state TEXT NOT NULL)');
    return db;
  } catch (error) { db.dispose(); throw error; }
}

test('SYSTEM hints ignore unrelated tracked/private writes while photo CAS and Guardian authority remain immediate', () => {
  const db = guardian(); let remove: (() => void) | undefined;
  try {
    let authority = 0, presentation = 0;
    remove = observeMessagingSystemPresentation(db, {
      authority: () => { authority++; },
      presentation: () => { presentation++; db.transaction(() => { db.prepare('SELECT user_id FROM users').all(); }); },
    });
    db.transaction(() => {});
    db.insert('synthetic_notices', { id: 'notice', value: 'synthetic' });
    db.transaction(() => { db.prepare('INSERT INTO _synthetic_private_outbox VALUES (?,?)').run('outbox', 'queued'); });
    db.transaction(() => { db.prepare('UPDATE _synthetic_private_outbox SET state=? WHERE id=?').run('acknowledged', 'outbox'); });
    expect({ authority, presentation }).toEqual({ authority: 0, presentation: 0 });
    // Tracked user UPDATEs SET every column and therefore cross Guardian's
    // existing authority trigger, even for a cosmetic or timestamp-only edit.
    db.update('users', 'synthetic', { updated_at: 2 });
    expect({ authority, presentation }).toEqual({ authority: 1, presentation: 0 });
    db.update('users', 'synthetic', { profile_revision: 2, updated_at: 3 }); // Accepted replacement.
    db.update('users', 'synthetic', { profile_revision: 3, updated_at: 4 }); // Accepted removal.
    expect({ authority, presentation }).toEqual({ authority: 3, presentation: 2 });
    db.update('users', 'synthetic', { first_name: 'Updated synthetic name' }); // Canonical trigger advances the CAS.
    expect({ authority, presentation }).toEqual({ authority: 4, presentation: 3 });
    db.transaction(() => { db.prepare('UPDATE users SET status=? WHERE user_id=?').run('suspended', 'synthetic'); });
    expect({ authority, presentation }).toEqual({ authority: 5, presentation: 3 });
    db.transaction(() => {
      db.update('users', 'synthetic', { profile_revision: 5 });
      db.prepare('UPDATE users SET status=? WHERE user_id=?').run('active', 'synthetic');
    });
    expect({ authority, presentation }).toEqual({ authority: 6, presentation: 4 });
    remove(); remove();
    db.update('users', 'synthetic', { profile_revision: 6 });
    db.transaction(() => { db.prepare('UPDATE users SET status=? WHERE user_id=?').run('suspended', 'synthetic'); });
    expect({ authority, presentation }).toEqual({ authority: 6, presentation: 4 });
  } finally { remove?.(); db.dispose(); }
});

test('rolled-back profile/authority writes cannot wake a later unrelated or read-only commit', () => {
  const db = guardian(); let remove: (() => void) | undefined;
  try {
    let authority = 0, presentation = 0;
    remove = observeMessagingSystemPresentation(db, { authority: () => { authority++; }, presentation: () => { presentation++; } });
    expect(() => db.transaction(() => {
      db.update('users', 'synthetic', { profile_revision: 2, status: 'suspended' }); throw new Error('synthetic rollback');
    })).toThrow('synthetic rollback');
    db.transaction(() => {}); db.insert('synthetic_notices', { id: 'later', value: 'unrelated' });
    expect({ authority, presentation }).toEqual({ authority: 0, presentation: 0 });
    expect(db.get('users', 'synthetic')).toMatchObject({ status: 'active', profile_revision: 1 });
  } finally { remove?.(); db.dispose(); }
});

test('presentation-only runtime hints never invoke membership/typing revalidation and stop after retirement', () => {
  let membership = 0, projections = 0;
  const runtime = Object.assign(Object.create(MessagingRuntime.prototype), {
    state: 'ready', options: { onMembershipChanged: () => { membership++; } },
    listeners: new Map([['synthetic', new Set([{ listener: () => { projections++; } }])]]),
  }) as MessagingRuntime;
  runtime.presentationChanged(); expect({ membership, projections }).toEqual({ membership: 0, projections: 1 });
  runtime.relationshipsChanged(); expect({ membership, projections }).toEqual({ membership: 1, projections: 2 });
  Object.assign(runtime, { state: 'closed' }); runtime.presentationChanged(); runtime.relationshipsChanged();
  expect({ membership, projections }).toEqual({ membership: 1, projections: 2 });
});
