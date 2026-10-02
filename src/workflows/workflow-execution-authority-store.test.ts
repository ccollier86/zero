import { createHmac } from 'node:crypto';
import { describe, expect, test } from 'bun:test';

import { applicationServiceDataScope } from '../auth/service-data-scope';
import { createReactiveDB } from '../sync/reactive-db';
import { createSystemAuthority } from './workflow-execution-authority-factory';
import { WorkflowExecutionAuthorityStore } from './workflow-execution-authority-store';
import type { WorkflowSystemExecutionAuthority } from './workflow-execution-authority-types';

describe('workflow execution authority store', () => {
  test('preserves v1 instance MAC bytes and domain-binds adjacent seals', () => {
    const db = createReactiveDB({ mode: 'memory' });
    try {
      const store = new WorkflowExecutionAuthorityStore(db, () => 123);
      const authority = createSystemAuthority({
        principal: 'workflow-test',
        reason: 'authority seal verification',
        scope: applicationServiceDataScope(),
      });

      store.insert('instance-1', authority);
      const row = db.prepare(`SELECT authority_json, authority_mac
        FROM _workflow_execution_authorities WHERE instance_id = ?`)
        .get('instance-1') as { authority_json: string; authority_mac: string };
      const config = db.prepare('SELECT value FROM _auth_config WHERE key = ?')
        .get('workflow.execution_authority.mac_key.v1') as { value: string };
      const expectedMac = createHmac(
        'sha256',
        Buffer.from(config.value, 'base64url'),
      ).update(row.authority_json).digest('hex');

      expect(row.authority_mac).toBe(expectedMac);
      expect(store.lockAndRead('instance-1')).toMatchObject({
        ok: true,
        authority: { kind: 'system' },
      });

      const seal = store.sealAuthority('event:event-1', authority, 'actor-json');
      expect(store.openAuthority(
        'event:event-1',
        'actor-json',
        seal.authorityJson,
        seal.authorityMac,
      )).toMatchObject({ kind: 'system' });
      expect(store.openAuthority(
        'event:event-2',
        'actor-json',
        seal.authorityJson,
        seal.authorityMac,
      )).toBeNull();
      expect(store.openAuthority(
        'event:event-1',
        'changed-actor',
        seal.authorityJson,
        seal.authorityMac,
      )).toBeNull();
    } finally {
      db.dispose();
    }
  });

  test('raises a stable startup error for an invalid persisted MAC key', () => {
    const db = createReactiveDB({ mode: 'memory' });
    try {
      db.exec(`CREATE TABLE _auth_config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )`);
      db.prepare('INSERT INTO _auth_config (key, value) VALUES (?, ?)').run(
        'workflow.execution_authority.mac_key.v1',
        'invalid-key',
      );

      expect(() => new WorkflowExecutionAuthorityStore(db)).toThrow(
        expect.objectContaining({
          name: 'WorkflowError',
          code: 'WORKFLOW_STARTUP_FAILED',
          status: 503,
        }),
      );
    } finally {
      db.dispose();
    }
  });

  test('raises a stable runtime-limit error for an oversized seal', () => {
    const db = createReactiveDB({ mode: 'memory' });
    try {
      const store = new WorkflowExecutionAuthorityStore(db);
      const oversized: WorkflowSystemExecutionAuthority = {
        version: 1,
        kind: 'system',
        identity: {
          kind: 'system',
          principal: 'workflow-test',
          reason: 'x'.repeat(33 * 1024),
          scopeKind: 'application',
          scopeId: 'application',
          tenantId: null,
          roles: [],
          permissions: [],
          allPermissions: true,
          legacyCompatibility: false,
        },
      };

      expect(() => store.insert('oversized', oversized)).toThrow(
        expect.objectContaining({
          code: 'WORKFLOW_RUNTIME_LIMIT_EXCEEDED',
          status: 500,
        }),
      );
    } finally {
      db.dispose();
    }
  });
});
