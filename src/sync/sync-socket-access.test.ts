import { describe, expect, test } from 'bun:test';

import { createReactiveDB } from './reactive-db';
import { resolveSyncSocketAccess } from './sync-socket-access';
import { allowAllSyncPolicy } from './sync-policy';
import type { SyncResourcePolicyAdapter } from './types';

describe('Sync socket access projection fingerprints', () => {
  test('fails comparability closed when a projector has no policy fingerprint', async () => {
    const db = createReactiveDB({ mode: 'memory' });
    db.defineTable('documents', {
      id: 'text primary key',
      title: 'text not null',
      secret: 'text not null',
    });
    const resourcePolicy: SyncResourcePolicyAdapter = {
      async resolveTableAccess() {
        return {
          readableTables: new Set(['documents']),
          rowFilters: new Map(),
          rowProjectors: new Map([['documents', {
            project: (row) => ({ id: row.id, title: row.title }),
          }]]),
        };
      },
      async authorizeMutation() {
        return { ok: true };
      },
    };

    try {
      const access = await resolveSyncSocketAccess({
        db,
        policy: allowAllSyncPolicy,
        resourcePolicy,
      }, null);

      expect(access.fingerprint).toBeNull();
      expect(access.rowProjectors.get('documents')?.project({
        id: 'doc-1',
        title: 'Visible',
        secret: 'hidden',
      })).toEqual({ id: 'doc-1', title: 'Visible' });
    } finally {
      db.dispose();
    }
  });
});
