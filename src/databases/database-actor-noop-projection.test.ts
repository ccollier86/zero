import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseActorRuntime } from './database-actor-runtime';
import { DATABASE_ACTOR_OPERATIONS } from './database-actor-protocol';
import { createDatabaseRef, prepareDatabaseFile } from './database-file';
import { deriveTenantDatabaseId } from './database-binding-ref';
import { prepareDatabaseBindingIdentity } from './database-binding-identity';
import { probeDatabaseActorLiveness } from './database-actor-liveness';
import { presenceActorRealm as realm } from '../presence/test-fixtures/presence-actor-realm';

test('duplicate presence projections do not save an unchanged hot image', async () => {
  const root = await mkdtemp(join(Bun.env.PROJECT_SCRATCH_DIR ?? tmpdir(), 'zero-duplicate-projection-'));
  const actor = new DatabaseActorRuntime({ role: 'writer', realm });
  const call = (operation: string, payload: any) => actor.handle({ operation, kind: 'write', payload });
  try {
    const file = prepareDatabaseFile(root, deriveTenantDatabaseId('audit-tenant'));
    const databaseRef = createDatabaseRef(file.id);
    const identity = prepareDatabaseBindingIdentity({ filePath: file.path, fileIdentity: file.identity,
      databaseRef, realmName: realm.name, initialize: file.created });
    call(DATABASE_ACTOR_OPERATIONS.bindWriter, {
      databaseRef, filePath: file.path, fileIdentity: file.identity, instanceId: identity.instanceId,
      actorLiveness: probeDatabaseActorLiveness(root), placement: { mode: 'hot', durability: 'on-write', maxBytes: 4 * 1024 * 1024 },
      realmFingerprint: realm.fingerprint, sqlite: {},
    });
    const publication = { installationId: 'audit-installation', targetId: 'tenant:audit-tenant',
      scopeKind: 'tenant', scopeId: 'audit-tenant', ownerEpoch: 1, revision: 1, sourceAuthorityRevision: 0,
      freshUntil: Date.now() + 60_000, mode: 'reset', rows: [], removedIds: [] };
    expect(call(DATABASE_ACTOR_OPERATIONS.presenceProjection, { databaseRef, publication }))
      .toMatchObject({ applied: true, duplicate: false });
    const binding = (actor as any).binding;
    const snapshot = binding.runtime.sqlite.snapshot;
    const original = snapshot.snapshotSyncDetailed.bind(snapshot);
    let snapshots = 0;
    snapshot.snapshotSyncDetailed = () => { snapshots++; return original(); };
    try {
      const before = binding.runtime.db.prepare('SELECT total_changes() AS n').get().n;
      expect(call(DATABASE_ACTOR_OPERATIONS.presenceProjection, { databaseRef, publication }))
        .toMatchObject({ applied: false, duplicate: true });
      const after = binding.runtime.db.prepare('SELECT total_changes() AS n').get().n;
      console.log(JSON.stringify({ audit: 'duplicate-presence', sqliteChanges: after - before, snapshots }));
      expect(after).toBe(before);
      expect(snapshots).toBe(0);
    } finally { snapshot.snapshotSyncDetailed = original; }
  } finally { actor.close(); await rm(root, { recursive: true, force: true }); }
});
