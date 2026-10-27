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

test('jobs default to maximum bounded concurrency and assistant policy changes cannot reuse an old decision contract', () => {
  const auth = resolveAuthBehaviorConfig(), resolve = (input: unknown) => resolveMessagingConfig(input as never, '/synthetic-project', auth);
  expect(resolve(true)).toMatchObject({ assistant: false, notifications: false, jobConcurrency: 100 });
  expect(resolve({ jobs: { concurrency: 4 } })).toMatchObject({ jobConcurrency: 4 });
  expect(resolve({ jobs: { concurrency: 'max' } })).toMatchObject({ jobConcurrency: 100 });
  const first = resolve({ support: {}, assistant: { model: 'smart', instructions: 'Synthetic support instructions' } });
  const same = resolve({ support: {}, assistant: { model: 'smart', instructions: 'Synthetic support instructions' } });
  const changed = resolve({ support: {}, assistant: { model: 'fast', instructions: 'Synthetic support instructions' } });
  if (!first || !same || !changed || !first.assistant || !same.assistant || !changed.assistant) throw new Error('Synthetic assistant policy missing.');
  expect(first.assistant.policyHash).toMatch(/^[a-f0-9]{64}$/); expect(same.assistant.policyHash).toBe(first.assistant.policyHash); expect(changed.assistant.policyHash).not.toBe(first.assistant.policyHash);
  for (const input of [{ assistant: {} }, { support: {}, assistant: { maxOutputTokens: 8193 } }, { jobs: { concurrency: 101 } }, { jobs: { concurrency: 0 } }, { notifications: 'yes' }]) expect(() => resolve(input)).toThrow();
});
