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

  test('keeps server-owned chronology and ownership readable but never client-writable', () => {
    expect(tasksResource.fields?.read).toEqual(expect.arrayContaining([
      'created_at',
      'created_by_user_id',
      'assigned_membership_id',
    ]));
    for (const field of [
      'created_at',
      'created_by_user_id',
      'assigned_membership_id',
    ]) {
      expect(tasksResource.fields?.create).not.toContain(field);
      expect(tasksResource.fields?.update).not.toContain(field);
    }
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
