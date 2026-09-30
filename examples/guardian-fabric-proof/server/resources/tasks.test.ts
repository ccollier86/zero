import { describe, expect, test } from 'bun:test';

import {
  getGuardianAnchorRequirements,
  getGuardianTableReferences,
} from '@zero/framework/schema';
import { getPolicyOwnerFields } from '@zero/framework/server';

import { tasks } from '../../db/schema';
import { tasksResource } from './tasks';

describe('Guardian + Fabric proof task model', () => {
  test('declares the canonical local identity anchors required by its foreign keys', () => {
    expect(getGuardianAnchorRequirements(tasks.serverTable)).toEqual(['user', 'membership']);
    expect(getGuardianTableReferences(tasks.serverTable)).toEqual([
      expect.objectContaining({ field: 'created_by_user_id', kind: 'user' }),
      expect.objectContaining({ field: 'assigned_membership_id', kind: 'membership' }),
    ]);
  });

  test('keeps ownership fields readable but never client-writable', () => {
    expect(tasksResource.fields?.read).toEqual(expect.arrayContaining([
      'created_by_user_id',
      'assigned_membership_id',
    ]));
    expect(tasksResource.fields?.create).not.toContain('created_by_user_id');
    expect(tasksResource.fields?.create).not.toContain('assigned_membership_id');
    expect(tasksResource.fields?.update).not.toContain('created_by_user_id');
    expect(tasksResource.fields?.update).not.toContain('assigned_membership_id');
  });

  test('uses trusted actor ownership on constrained read and write paths', () => {
    for (const action of ['list', 'get', 'create', 'update'] as const) {
      expect(getPolicyOwnerFields(tasksResource.policy[action]!)).toEqual([
        'created_by_user_id',
        'assigned_membership_id',
      ]);
    }
    expect(getPolicyOwnerFields(tasksResource.policy.delete!)).toEqual([]);
  });
});
