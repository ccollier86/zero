import { describe, expect, test } from 'bun:test';

import { WorkflowRegistry } from '@zero/framework/workflows';

import { TORRENT_PROOF_WORKFLOW } from '../shared/torrent-proof';
import {
  registerTorrentProof,
  TORRENT_CREATE_ACTIVITY,
  TORRENT_DECLINE_ACTIVITY,
  TORRENT_PREPARE_ACTIVITY,
} from './torrent-proof';

describe('Guardian + Fabric + Torrent proof workflow', () => {
  test('compiles a pinned human-wait graph with explicit approved and declined branches', () => {
    const registry = proofRegistry();
    const compiled = registry.getCompiledWorkflow(TORRENT_PROOF_WORKFLOW);

    expect(compiled).toMatchObject({
      name: TORRENT_PROOF_WORKFLOW,
      format: 'flow',
      version: 1,
      activate: true,
      access: {
        start: ['editor', 'manager'],
        inspect: ['viewer', 'editor', 'manager'],
      },
    });
    expect(compiled?.graph.nodes.map((node) => [node.id, node.kind])).toEqual([
      ['@zero/route-decision/join', 'join'],
      ['create-approved-task', 'activity'],
      ['prepare-task', 'activity'],
      ['record-declined-task', 'activity'],
      ['review-task', 'wait'],
      ['route-decision', 'choice'],
    ]);
    expect(compiled?.graph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        from: 'route-decision',
        to: 'create-approved-task',
        branch: 'when.0',
      }),
      expect.objectContaining({
        from: 'route-decision',
        to: 'record-declined-task',
        branch: 'otherwise',
        default: true,
      }),
    ]));
  });

  test('validates workflow input before an activity can prepare durable state', () => {
    const registry = proofRegistry();
    expect(() => registry.activities.validateInput({
      name: TORRENT_PREPARE_ACTIVITY,
      version: '1',
    }, {
      taskId: 'valid-task',
      title: '   ',
    })).toThrow('Input does not match workflow activity');
  });

  test('writes the approved task through the bound Fabric capability with stable attribution', async () => {
    const registry = proofRegistry();
    const activity = registry.activities.resolve({
      name: TORRENT_CREATE_ACTIVITY,
      version: '1',
    });
    const calls: unknown[] = [];
    let authorityAssertions = 0;

    const result = await activity.handler({
      input: {
        taskId: 'task-from-torrent',
        title: 'Approved by a human',
        createdAt: 1_795_000_000_000,
      },
      workflowInput: {},
      instanceId: 'workflow-instance',
      stepIndex: 3,
      attempt: 0,
      attemptId: 'attempt-one',
      idempotencyKey: 'workflow-instance:create-approved-task',
      execution: {
        kind: 'actor',
        userId: 'user-one',
        platformRole: 'user',
        scopeKind: 'tenant',
        scopeId: 'tenant-one',
        tenantId: 'tenant-one',
        membershipId: 'membership-one',
        roles: ['editor'],
        permissions: ['tasks:create'],
        allPermissions: false,
        authorizationRevision: 'revision-one',
        credentialKind: 'session',
        sessionKind: 'web',
        clientId: 'browser-one',
      },
      zero: {
        data: {
          mutate: async (...input: unknown[]) => {
            calls.push(input);
            return {};
          },
        },
      },
      assertCurrentAuthority: () => { authorityAssertions += 1; },
    } as never);

    expect(authorityAssertions).toBe(1);
    expect(calls).toEqual([[
      {
        type: 'create',
        table: 'tasks',
        row: {
          task_id: 'task-from-torrent',
          title: 'Approved by a human',
          status: 'open',
          created_at: 1_795_000_000_000,
          created_by_user_id: 'user-one',
          assigned_membership_id: 'membership-one',
        },
      },
      { idempotencyKey: 'workflow-instance:create-approved-task' },
    ]]);
    expect(result).toEqual({ taskId: 'task-from-torrent', created: true });
  });

  test('keeps the declined activity free of tenant-data capabilities', () => {
    const activity = proofRegistry().activities.resolve({
      name: TORRENT_DECLINE_ACTIVITY,
      version: '1',
    });
    expect(activity.capabilities).toEqual([]);
  });
});

function proofRegistry(): WorkflowRegistry {
  const registry = new WorkflowRegistry();
  registerTorrentProof(registry);
  return registry;
}
