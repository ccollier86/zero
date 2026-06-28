/**
 * identity.test.ts
 *
 * Verifies deterministic natural-identity key generation independent of the
 * database, websocket transport, or frontend collection APIs.
 */

import { describe, expect, test } from 'bun:test';
import {
  createIdentityId,
  ensureRowSyncPrimaryKey,
  getIdentityValues,
  withIdentityPrimaryKey,
} from './identity';
import type { Row } from './types';

describe('natural identity helpers', () => {
  test('creates stable ids for the same table and identity values', () => {
    const fields = ['team_id', 'user_id'];
    const first = createIdentityId('memberships', fields, {
      team_id: 'team-1',
      user_id: 'user-1',
    });
    const second = createIdentityId('memberships', fields, {
      team_id: 'team-1',
      user_id: 'user-1',
    });

    expect(first).toBe(second);
    expect(first.startsWith('zi1:')).toBe(true);
  });

  test('uses table name and ordered identity values as part of the key', () => {
    const base = createIdentityId('memberships', ['team_id', 'user_id'], {
      team_id: 'team-1',
      user_id: 'user-1',
    });

    expect(createIdentityId('invitations', ['team_id', 'user_id'], {
      team_id: 'team-1',
      user_id: 'user-1',
    })).not.toBe(base);
    expect(createIdentityId('memberships', ['user_id', 'team_id'], {
      team_id: 'team-1',
      user_id: 'user-1',
    })).not.toBe(base);
  });

  test('rejects missing and unsupported identity values', () => {
    expect(() => getIdentityValues(['team_id'], {})).toThrow('Missing identity field "team_id"');
    expect(() => getIdentityValues(['team_id'], { team_id: {} })).toThrow('must be a string, number, or boolean');
    expect(() => getIdentityValues(['team_id'], { team_id: Number.NaN })).toThrow('must be a finite number');
  });

  test('adds deterministic primary keys for identity tables', () => {
    const row = ensureRowSyncPrimaryKey(
      'memberships',
      { _pk: 'membership_id', _identity: ['team_id', 'user_id'] },
      { team_id: 'team-1', user_id: 'user-1', role: 'admin' },
    );

    expect((row as Row).membership_id).toBe(createIdentityId('memberships', ['team_id', 'user_id'], row));
  });

  test('can force a deterministic primary key for identity upsert APIs', () => {
    const row = withIdentityPrimaryKey(
      'memberships',
      'membership_id',
      ['team_id', 'user_id'],
      { membership_id: 'custom', team_id: 'team-1', user_id: 'user-1' },
    );

    expect(row.membership_id).toBe(createIdentityId('memberships', ['team_id', 'user_id'], row));
  });
});
