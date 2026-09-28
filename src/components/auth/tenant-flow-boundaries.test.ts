import { describe, expect, test } from 'bun:test';
import { tenantCreationFlowKey } from './tenant-creation-form';
import { tenantInvitationFlowKey } from './tenant-invitation-form';
import { tenantJoinRequestFlowKey } from './tenant-join-request-form';

describe('packaged tenant flow reset boundaries', () => {
  test('resets creation state when the creator or proof changes', () => {
    const signedIn = tenantCreationFlowKey('user-1');
    expect(tenantCreationFlowKey('user-2')).not.toBe(signedIn);
    const preSession = tenantCreationFlowKey(undefined, 'proof-1');
    expect(tenantCreationFlowKey(undefined, 'proof-2')).not.toBe(preSession);
    expect(tenantCreationFlowKey('new-user', 'proof-1')).toBe(preSession);
  });

  test('resets invitation state when the token or proof changes', () => {
    const initial = tenantInvitationFlowKey('invite-1', 'proof-1');
    expect(tenantInvitationFlowKey('invite-2', 'proof-1')).not.toBe(initial);
    expect(tenantInvitationFlowKey('invite-1', 'proof-2')).not.toBe(initial);
  });

  test('resets join-request success when the target, proof, or identity changes', () => {
    const initial = tenantJoinRequestFlowKey('acme', 'proof-1', 'user-1');
    expect(tenantJoinRequestFlowKey('other', 'proof-1', 'user-1')).not.toBe(initial);
    expect(tenantJoinRequestFlowKey('acme', 'proof-2', 'user-1')).not.toBe(initial);
    expect(tenantJoinRequestFlowKey('acme', 'proof-1', 'user-2')).not.toBe(initial);
  });
});
