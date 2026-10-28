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
  expect(resolve({ assistant: {} })).toMatchObject({ support: false, assistants: { default: { id: 'default' } } });
  for (const input of [{ support: {}, assistant: { maxOutputTokens: 8193 } }, { jobs: { concurrency: 101 } }, { jobs: { concurrency: 0 } }, { notifications: 'yes' }]) expect(() => resolve(input)).toThrow();
});

test('named assistants do not require support and compile Guardian policies without publishing instructions or keys', () => {
  const auth = resolveAuthBehaviorConfig({ userProperties: { department: { editableBy: 'admin', useInPolicies: true } } });
  const config = resolveMessagingConfig({ assistants: { knowledge: { name: 'Knowledge', access: { properties: { department: 'clinical' } }, instructions: 'Synthetic private policy' }, writing: { name: 'Writing' } } }, '/synthetic-project', auth);
  if (!config) throw new Error('Synthetic config missing.');
  expect(config.support).toBe(false); expect(config.assistant).toBe(false);
  expect(Object.keys(config.assistants)).toEqual(['knowledge', 'writing']);
  expect(config.assistants.knowledge!.policyHash).not.toBe(config.assistants.writing!.policyHash);
  expect(Object.isFrozen(config.assistants.knowledge!.access)).toBe(true);
  expect(() => resolveMessagingConfig({ assistants: { knowledge: { access: { properties: { unknown: 'yes' } } } } }, '/synthetic-project', auth)).toThrow();
  const selected = resolveMessagingConfig({ support: { assistant: 'help' }, assistants: { help: { name: 'Help' }, writing: {} } }, '/synthetic-project', auth);
  expect(selected && selected.assistant).toMatchObject({ id: 'help' });
  expect(() => resolveMessagingConfig({ support: { assistant: 'missing' } }, '/synthetic-project', auth)).toThrow();
  expect(() => resolveMessagingConfig({ assistant: {}, assistants: { default: {} } }, '/synthetic-project', auth)).toThrow();
  let called = false;
  const hostile = Object.defineProperty({}, 'knowledge', { enumerable: true, get() { called = true; return {}; } });
  expect(() => resolveMessagingConfig({ assistants: hostile }, '/synthetic-project', auth)).toThrow(); expect(called).toBe(false);
});

test('native notification links are configurable local paths, never caller-selected external URLs', () => {
  const auth = resolveAuthBehaviorConfig(), resolve = (input: unknown) => resolveMessagingConfig(input as never, '/synthetic-project', auth);
  expect(resolve({ notifications: true })).toMatchObject({ notifications: true, notificationPath: '/messages' });
  expect(resolve({ notifications: { path: '/app/messages' } })).toMatchObject({ notifications: true, notificationPath: '/app/messages' });
  expect(resolve({ notifications: false })).toMatchObject({ notifications: false });
  for (const path of ['https://hostile.example', '//hostile.example', '/\\hostile.example', '/messages?tenant=other', '/messages#fragment', '/messages\n', '/' + 'x'.repeat(400)]) expect(() => resolve({ notifications: { path } })).toThrow();
});

test('configured groups reuse Guardian policy-trusted fields and keep ordinary contacts/directory options independent', () => {
  const auth = resolveAuthBehaviorConfig({ userProperties: { department: { editableBy: 'admin', useInPolicies: true } } });
  const config = resolveMessagingConfig({ directory: 'contacts', groups: { team: { name: 'Team' }, clinical: { members: { properties: { department: 'clinical' } }, history: 'since-join' } } }, '/synthetic', auth);
  expect(config && config.groups.clinical).toMatchObject({ id: 'clinical', history: 'since-join' });
  expect(config && config.groups.team!.policyHash).toMatch(/^[a-f0-9]{64}$/);
  expect(() => resolveMessagingConfig({ groups: { invalid: { members: { properties: { untrusted: 'yes' } } } } }, '/synthetic', auth)).toThrow();
});

test('public support entries require a fixed secure origin, explicit tenant ownership and a deliberately public assistant', () => {
  const auth = resolveAuthBehaviorConfig(), resolve = (entries: unknown) => resolveMessagingConfig({ support: { entries: entries as never } }, '/synthetic', auth);
  const entry = resolve({ website: { origin: 'https://support.example.test' } });
  expect(entry && entry.supportEntries.website).toMatchObject({ tenantId: null, assistantId: null, sessionTtlSeconds: 86400, maxVisitors: 10000 });
  expect(entry && entry.supportEntries.website!.policyHash).toMatch(/^[a-f0-9]{64}$/);
  expect(resolve({ local: { origin: 'http://127.0.0.1:4317' } })).toBeTruthy();
  for (const value of [
    { origin: 'https://support.example.test/' }, { origin: 'http://support.example.test' }, { origin: 'https://user:password@support.example.test' },
    { origin: 'https://support.example.test#secret' }, { origin: 'https://support.example.test', tenantId: 'foreign' },
    { origin: 'https://support.example.test', sessionTtlSeconds: 59 }, { origin: 'https://support.example.test', maxVisitors: Infinity },
  ]) expect(() => resolve({ website: value })).toThrow();
  const multi = resolveAuthBehaviorConfig({ tenancy: 'multi' });
  expect(() => resolveMessagingConfig({ support: { entries: { website: { origin: 'https://support.example.test' } } } }, '/synthetic', multi)).toThrow();
  expect(resolveMessagingConfig({ support: { entries: { website: { origin: 'https://support.example.test', tenantId: 'known-tenant' } } } }, '/synthetic', multi)).toBeTruthy();
  expect(() => resolveMessagingConfig({ assistants: { private: { access: 'admin' } }, support: { entries: { website: { origin: 'https://support.example.test', assistant: 'private' } } } }, '/synthetic', auth)).toThrow();
  let invoked = false; const accessor = Object.defineProperty({}, 'website', { enumerable: true, get() { invoked = true; return {}; } });
  expect(() => resolve(accessor)).toThrow(); expect(invoked).toBe(false);
});
