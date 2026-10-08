/** Receipt-boundary regression; synthetic writers only, no app/config/database imports. */
import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { toast } from 'sonner';
import { configureFrontendObservability, type FrontendObservabilityEvent } from '../../../frontend/client/observability';
import { useUserManagementMutations } from './use-user-management-mutations';
import type { UseAdminUsersResult, UserManagementUser } from './user-management-types';

type Options = Parameters<typeof useUserManagementMutations>[0];
let events: FrontendObservabilityEvent[];
let success: ReturnType<typeof spyOn<typeof toast, 'success'>>;
beforeEach(() => { events = []; configureFrontendObservability({ sink: { emit(event) { events.push(event); } } });
  success = spyOn(toast, 'success').mockImplementation(() => 'synthetic-toast'); });
afterEach(() => { success.mockRestore(); configureFrontendObservability({ http: false, console: false }); });

function actions(options: Options) {
  let result!: ReturnType<typeof useUserManagementMutations>;
  function Capture() { result = useUserManagementMutations(options); return null; }
  renderToStaticMarkup(<Capture />); return result;
}
function live(overrides: Partial<UseAdminUsersResult> = {}): UseAdminUsersResult {
  return { createUser: async () => ({ user, setupEmailSent: false }), updateUser: async () => user,
    deleteUserProperty: async () => user, deleteUser: async () => {}, ...overrides } as UseAdminUsersResult;
}
const user: UserManagementUser = { id: 'user', userId: 'user', username: 'synthetic', email: 'synthetic@example.test',
  firstName: 'Synthetic', lastName: 'User', role: 'user', status: 'active', passwordChangeRequired: false,
  emailVerifiedAt: null, emailVerificationRequired: false, mfaRequired: false, properties: {}, createdAt: 0, updatedAt: null };
const input = { username: 'synthetic', email: 'synthetic@example.test' };

describe('admin mutation receipt and notification separation', () => {
  test('committed create/update/delete receipts remain successful when post-acceptance callbacks reject', async () => {
    const writes: string[] = [], failure = () => Promise.reject(new Error('private synthetic callback payload'));
    const mutation = actions({ controlled: false, live: live({
      createUser: async () => { writes.push('create'); return { user, setupEmailSent: false }; },
      updateUser: async () => { writes.push('update'); return user; }, deleteUserProperty: async () => { writes.push('property'); return user; },
      deleteUser: async () => { writes.push('delete'); },
    }), handlers: { onCreate: failure, onUpdate: failure, onDeleteProperty: failure, onDelete: failure } });
    await expect(mutation.createUser(input)).resolves.toBeUndefined();
    await expect(mutation.updateUser('user', { firstName: 'Changed' })).resolves.toBeUndefined();
    await expect(mutation.deleteProperty('user', 'bio')).resolves.toBeUndefined();
    await expect(mutation.deleteUser('user')).resolves.toBeUndefined();
    expect(writes).toEqual(['create', 'update', 'property', 'delete']); expect(success).toHaveBeenCalledTimes(3);
    expect(events).toHaveLength(4); expect(events.every(event => event.code === 'frontend.admin_user.notification_failed')).toBe(true);
    expect(JSON.stringify(events)).not.toContain('private synthetic');
  });
  test('actual writer failure still rejects and never invokes post-acceptance callbacks or success toasts', async () => {
    let callbacks = 0;
    const failure = new Error('synthetic writer failed');
    const mutation = actions({ controlled: false, live: live({ createUser: async () => { throw failure; } }),
      handlers: { onCreate() { callbacks++; } } });
    await expect(mutation.createUser(input)).rejects.toBe(failure);
    expect(callbacks).toBe(0); expect(success).not.toHaveBeenCalled(); expect(events).toEqual([]);
  });
  test('controlled handlers remain actual writers and their rejection is not hidden as notification failure', async () => {
    let fallback = 0;
    const failure = new Error('controlled writer failed');
    const mutation = actions({ controlled: true, live: live({ createUser: async () => { fallback++; return { user, setupEmailSent: false }; } }),
      handlers: { onCreate: async () => { throw failure; } } });
    await expect(mutation.createUser(input)).rejects.toBe(failure);
    expect(fallback).toBe(0); expect(events).toEqual([]); expect(success).not.toHaveBeenCalled();
  });
  test('a failing toast after accepted mutation does not relabel it as failed or replay the writer', async () => {
    let writes = 0, callbacks = 0;
    success.mockImplementation(() => { throw new Error('private synthetic toast failure'); });
    const mutation = actions({ controlled: false, live: live({ createUser: async () => { writes++; return { user, setupEmailSent: true }; } }),
      handlers: { onCreate() { callbacks++; } } });
    await expect(mutation.createUser(input)).resolves.toBeUndefined();
    expect(writes).toBe(1); expect(callbacks).toBe(1); expect(events[0]?.metadata).toEqual({ action: 'create-user', stage: 'toast' });
    expect(JSON.stringify(events)).not.toContain('private synthetic');
  });
});
