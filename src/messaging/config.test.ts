/** Pure opt-in and hostile-input tests; configuration never opens databases or starts workers. */
import { expect, test } from 'bun:test';
import { resolveAuthBehaviorConfig } from '../auth/auth-config';
import { resolveMessagingConfig } from './config';

test('messaging is opt-in and retains bounded private actors with contact/history controls', () => {
  const auth = resolveAuthBehaviorConfig(), root = '/synthetic-project';
  expect(resolveMessagingConfig(undefined, root, auth)).toBe(false);
  expect(resolveMessagingConfig(false, root, auth)).toBe(false);
  expect(() => resolveMessagingConfig(true, root, null)).toThrow('Guardian must be enabled');
  const config = resolveMessagingConfig({ directory: 'contacts', history: 'since-join', support: {} }, root, auth);
  expect(config).toMatchObject({ directory: 'contacts', history: 'since-join', rootDirectory: root + '/data/zero.messaging', maxMessageLength: 20000, maxParticipants: 100, maxActiveDatabases: 4, maxDatabaseFiles: 1000, support: { staff: 'admin' } });
  expect(Object.isFrozen(config)).toBe(true);
});
test('unknown, hostile and unbounded configuration does not become permissive messaging policy', () => {
  const auth = resolveAuthBehaviorConfig(), resolve = (value: unknown) => resolveMessagingConfig(value as never, '/synthetic-project', auth);
  for (const input of [null, [], { notAField: true }, { maxMessageLength: Infinity }, { maxMessageLength: 20001 }, { maxParticipants: 101 }, { maxDatabaseFiles: 10001 }, { maxActiveDatabases: 65 }, { directory: 'public' }, { support: { staff: true } }, { rootDirectory: '\0' }]) expect(() => resolve(input)).toThrow();
  let called = false; const input = Object.defineProperty({}, 'directory', { enumerable: true, get() { called = true; return 'everyone'; } });
  expect(() => resolve(input)).toThrow(); expect(called).toBe(false);
});
