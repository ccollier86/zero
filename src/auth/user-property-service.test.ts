import { describe, expect, test } from 'bun:test';
import { resolveAuthBehaviorConfig } from './auth-config';
import { AuthError } from './types';
import { UserPropertyService, type UserPropertyStore } from './user-property-service';

class MemoryPropertyStore implements UserPropertyStore {
  readonly values = new Map<string, string>();

  getProperty(userId: string, key: string): string | null {
    return this.values.get(`${userId}:${key}`) ?? null;
  }

  setProperty(userId: string, key: string, value: string): void {
    this.values.set(`${userId}:${key}`, value);
  }

  deleteProperty(userId: string, key: string): void {
    this.values.delete(`${userId}:${key}`);
  }
}

function createService(strictUserProperties = false): UserPropertyService {
  return new UserPropertyService(
    resolveAuthBehaviorConfig({
      strictUserProperties,
      userProperties: {
        plan: {
          type: 'enum',
          values: ['free', 'pro'],
          default: 'free',
          editableBy: 'admin',
        },
        notificationsEnabled: {
          type: 'boolean',
          default: true,
          editableBy: 'user',
        },
        quota: {
          type: 'number',
          default: 10,
          editableBy: 'admin',
        },
        internalFlag: {
          type: 'string',
          editableBy: 'none',
        },
      },
    })
  );
}

describe('UserPropertyService', () => {
  test('returns configured defaults as serialized strings', () => {
    const service = createService();

    expect(service.getDefaultProperties()).toEqual({
      plan: 'free',
      notificationsEnabled: 'true',
      quota: '10',
    });
  });

  test('validates configured enum, boolean, and number values', () => {
    const service = createService();

    expect(service.validateWrite('plan', 'pro', 'admin')).toBe('pro');
    expect(service.validateWrite('notificationsEnabled', false, 'user')).toBe('false');
    expect(service.validateWrite('quota', '25', 'admin')).toBe('25');
  });

  test('rejects invalid enum values', () => {
    const service = createService();

    expect(() => service.validateWrite('plan', 'enterprise', 'admin')).toThrow(AuthError);
  });

  test('enforces actor edit policy for configured properties', () => {
    const service = createService();

    expect(() => service.validateWrite('plan', 'free', 'user')).toThrow(AuthError);
    expect(service.validateWrite('notificationsEnabled', true, 'admin')).toBe('true');
    expect(() => service.validateWrite('internalFlag', 'on', 'admin')).toThrow(AuthError);
    expect(service.validateWrite('internalFlag', 'on', 'system')).toBe('on');
  });

  test('allows unknown keys by default and serializes structured values', () => {
    const service = createService();

    expect(service.validateWrite('custom', { theme: 'dark' }, 'user')).toBe('{"theme":"dark"}');
  });

  test('rejects unknown writes and deletes in strict mode', () => {
    const service = createService(true);
    const store = new MemoryPropertyStore();

    expect(() => service.validateWrite('custom', 'value', 'user')).toThrow(AuthError);
    expect(() => service.deleteProperty('u_1', 'custom', 'user', store)).toThrow(AuthError);
  });

  test('applies missing defaults without overwriting existing values', () => {
    const service = createService();
    const store = new MemoryPropertyStore();
    store.setProperty('u_1', 'plan', 'pro');

    const applied = service.applyMissingDefaults('u_1', store);

    expect(applied).toEqual({
      notificationsEnabled: 'true',
      quota: '10',
    });
    expect(store.getProperty('u_1', 'plan')).toBe('pro');
    expect(store.getProperty('u_1', 'quota')).toBe('10');
  });
});
