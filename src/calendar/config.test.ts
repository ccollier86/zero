/** Pure, memory-only admission: no fixture roots, files, actors, providers or dependency installation. */
import { expect, test } from 'bun:test';
import { resolveAuthBehaviorConfig } from '../auth/auth-config';
import { createAuthorizationKernel, type AccessRequirement, type AuthorizationSubjectSnapshot } from '../auth/authorization-kernel';
import type { AuthBehaviorConfig, NormalizedAuthBehaviorConfig } from '../auth/types';
import { resolveCalendarConfig, type CalendarConfig, type ResolvedCalendarConfig } from './config';
import { CalendarError, type CalendarErrorCode } from './error';

const PROJECT = '/synthetic-zero-calendar';
const auth = resolveAuthBehaviorConfig();
function resolve(input: unknown, guardian: NormalizedAuthBehaviorConfig | null = auth): ResolvedCalendarConfig | false {
  return resolveCalendarConfig(input as CalendarConfig, PROJECT, guardian);
}
function enabled(input: unknown = true, guardian: NormalizedAuthBehaviorConfig = auth): ResolvedCalendarConfig {
  const config = resolve(input, guardian);
  if (config === false) throw new Error('Synthetic calendar configuration missing.');
  return config;
}
function rejects(input: unknown, code: CalendarErrorCode = 'CALENDAR_CONFIG_INVALID', guardian: NormalizedAuthBehaviorConfig | null = auth) {
  try { resolve(input, guardian); throw new Error('Expected calendar configuration rejection.'); }
  catch (error) { expect(error).toBeInstanceOf(CalendarError); expect((error as CalendarError).code).toBe(code); }
}

test('omitted and false calendar declarations are inert even without Guardian or valid project inputs', () => {
  let invoked = 0;
  const hostile = new Proxy({}, { get() { invoked++; throw new Error('must not inspect disabled inputs'); } });
  expect(resolveCalendarConfig(undefined, hostile as never, hostile as never)).toBe(false);
  expect(resolveCalendarConfig(false, '' as never, null)).toBe(false);
  expect(invoked).toBe(0);
  rejects(true, 'CALENDAR_CONFIG_INVALID', null);
  rejects({}, 'CALENDAR_CONFIG_INVALID', null);
});

test('enabled shorthand has private bounded defaults but does not claim runtime or timezone readiness', () => {
  const config = enabled();
  expect(config).toEqual({
    rootDirectory: PROJECT + '/data/zero.calendar', timezone: null, readiness: 'setup-required',
    createOwn: 'user', manage: 'admin', maxRangeDays: 31, maxPageSize: 100, maxResources: 16,
    maxParticipants: 100, participants: false, maxActiveDatabases: 4, maxDatabaseFiles: 1000,
    recurrence: false, reminders: false, selfBooking: false,
  });
  expect(enabled({})).toEqual(config);
  expect(Object.isFrozen(config)).toBe(true);
  expect(config).not.toHaveProperty('createExecutor');
  expect(config).not.toHaveProperty('defaultActorEntrypoint');
  expect(config.readiness).not.toBe('ready');
});

test('scheduling timezone must be deliberately selected and only makes configuration complete', () => {
  expect(enabled({ timezone: null }).timezone).toBeNull();
  expect(enabled({ timezone: 'America/New_York' })).toMatchObject({ timezone: 'America/New_York', readiness: 'configured' });
  expect(enabled({ timezone: 'UTC' })).toMatchObject({ timezone: 'UTC', readiness: 'configured' });
  expect(enabled({ timezone: 'US/Eastern' }).timezone).toBe(new Intl.DateTimeFormat('en-US', { timeZone: 'US/Eastern' }).resolvedOptions().timeZone);
  for (const timezone of ['', '  ', '+05:30', 'Invalid/Region', 1, false, {}, new String('UTC')]) rejects({ timezone });
});

test('private root resolution is lexical and does not provision or inspect a future actor entrypoint', () => {
  expect(enabled({ rootDirectory: 'private/calendar' }).rootDirectory).toBe(PROJECT + '/private/calendar');
  expect(enabled({ rootDirectory: '/synthetic-private-calendar' }).rootDirectory).toBe('/synthetic-private-calendar');
  for (const rootDirectory of [null, '', ' ', ' private', 'private ', '\0', '/', '.', '..', PROJECT, '/synthetic-zero-calendar/..']) rejects({ rootDirectory });
  for (const projectRoot of ['', 'relative', ' /synthetic', '/synthetic\0']) {
    expect(() => resolveCalendarConfig(true, projectRoot, auth)).toThrow(CalendarError);
  }
});

test('query and actor/database ceilings are finite integers and explicitly bounded', () => {
  const bounds = [
    ['maxRangeDays', 1, 31], ['maxPageSize', 1, 100], ['maxResources', 1, 16],
    ['maxParticipants', 1, 100], ['maxActiveDatabases', 1, 64], ['maxDatabaseFiles', 4, 10_000],
  ] as const;
  for (const [key, min, max] of bounds) {
    expect(enabled({ [key]: min })[key]).toBe(min);
    expect(enabled({ [key]: max })[key]).toBe(max);
    for (const value of [min - 1, max + 1, 0.5, NaN, Infinity, -Infinity, null, '1', true]) rejects({ [key]: value });
  }
  expect(enabled({ maxActiveDatabases: 1, maxDatabaseFiles: 1 }).maxDatabaseFiles).toBe(1);
  rejects({ maxActiveDatabases: 8, maxDatabaseFiles: 7 });
});

test('the current internal stage never advertises recurrence, reminders or self-booking as available', () => {
  for (const key of ['recurrence', 'reminders', 'selfBooking']) {
    expect(enabled({ [key]: false })[key as 'recurrence']).toBe(false);
    for (const value of [true, {}, { enabled: true }, { enabled: false }]) rejects({ [key]: value }, 'CALENDAR_NOT_READY');
    for (const value of [null, 'enabled', 1, []]) rejects({ [key]: value });
  }
  // A separate malformed field cannot be hidden by an unsupported capability.
  rejects({ recurrence: true, maxPageSize: 0 });
  rejects({ recurrence: true, reminders: null });
});

test('only known own enumerable data settings are admitted, without invoking accessors or proxy traps', () => {
  for (const input of [null, [], 'true', 1, new Date(), new Boolean(true), { unknown: true }, { actors: {} }, { jobs: true }, { timezone: 'UTC', [Symbol('private')]: true }]) rejects(input);
  let invoked = 0;
  const getter = Object.defineProperty({}, 'timezone', { enumerable: true, get() { invoked++; return 'UTC'; } });
  const hidden = Object.defineProperty({}, 'timezone', { enumerable: false, value: 'UTC' });
  const proxy = new Proxy({}, { ownKeys() { invoked++; return []; }, getPrototypeOf() { invoked++; return Object.prototype; } });
  const inherited = Object.create({ timezone: 'UTC' });
  for (const input of [getter, hidden, proxy, inherited]) rejects(input);
  expect(invoked).toBe(0);
  expect(enabled(Object.create(null))).toMatchObject({ timezone: null });
});

test('createOwn can be deliberately disabled, but never widened to unauthenticated access', () => {
  expect(enabled({ createOwn: false }).createOwn).toBe(false);
  const choices: AccessRequirement[] = ['user', 'required', true, { user: 'required' }, { credentials: ['session'] }];
  for (const createOwn of choices) {
    expect(enabled({ createOwn }).createOwn).toEqual(createOwn);
  }
  for (const createOwn of [null, 'optional', {}, { user: 'optional' }, { user: 'optional', credentials: ['session'] }]) rejects({ createOwn });
});

test('management requires an admitted Guardian role, permission or trusted property rather than mere authentication', () => {
  for (const manage of [null, false, true, 'user', 'required', 'optional', {}, { user: 'required' }, { credentials: ['session'] }]) rejects({ manage });
  expect(enabled({ manage: { platformRole: ['admin'] } }).manage).toEqual({ platformRole: ['admin'] });
  const trusted = resolveAuthBehaviorConfig({ userProperties: {
    department: { editableBy: 'admin', useInPolicies: true }, preference: { editableBy: 'user', useInPolicies: false },
  } });
  expect(enabled({ manage: { properties: { department: 'scheduling' } } }, trusted).manage).toEqual({ properties: { department: 'scheduling' } });
  rejects({ manage: { permission: 'calendar.unknown:manage' } });
  rejects({ manage: { scopeRole: 'unknown' } });
  rejects({ manage: { properties: { preference: 'scheduling' } } }, 'CALENDAR_CONFIG_INVALID', trusted);
  rejects({ createOwn: { tenant: 'required' } });
});

test('single and multi simple/advanced Guardian configurations retain normal management defaults', () => {
  for (const tenancy of ['single', 'multi'] as const) for (const mode of ['simple', 'advanced'] as const) {
    const guardian = resolveAuthBehaviorConfig({ tenancy, authorization: mode });
    expect(enabled({}, guardian).manage).toEqual(tenancy === 'single' ? 'admin' : { permission: 'tenant.members:manage' });
  }
});

test('an advanced non-admin scheduler can manage through an explicitly configured permission in either scope mode', () => {
  for (const tenancy of ['single', 'multi'] as const) {
    const guardian = resolveAuthBehaviorConfig({ tenancy, authorization: {
      mode: 'advanced', permissions: { 'calendar:manage': { label: 'Manage calendars' } },
      roles: { scheduler: { permissions: ['calendar:manage'] } },
    } } satisfies AuthBehaviorConfig);
    const config = enabled({ manage: { permission: 'calendar:manage' } }, guardian);
    const kernel = createAuthorizationKernel(guardian);
    const subject: AuthorizationSubjectSnapshot = {
      platformRole: 'user', authorization: {
        tenancy, mode: 'advanced', scopeKind: tenancy === 'single' ? 'application' : 'tenant', scopeId: 'synthetic-scope',
        roles: ['scheduler'], permissions: ['calendar:manage'], revision: 'synthetic-revision',
        ...(tenancy === 'multi' ? { tenantId: 'synthetic-scope', membershipId: 'synthetic-membership' } : {}),
      },
    };
    expect(kernel.evaluate(config.manage, subject).allowed).toBe(true);
    expect(kernel.evaluate(config.manage, { ...subject, authorization: { ...subject.authorization!, permissions: [], roles: [] } }).allowed).toBe(false);
  }
});

test('native/API-key access is not admitted before its separate calendar authority contract exists', () => {
  for (const key of ['createOwn', 'manage']) {
    for (const credentials of [['api-key'], ['session', 'api-key'], [], ['native'], 'session']) {
      rejects({ [key]: { user: 'required', platformRole: 'admin', credentials } });
    }
  }
});

test('canonical participants require an explicit compiled offline account eligibility policy', () => {
  const guardian = resolveAuthBehaviorConfig({ userProperties: {
    staff: { editableBy: 'admin', useInPolicies: true }, preference: { editableBy: 'user' },
  } });
  expect(enabled({ participants: false }).participants).toBe(false);
  expect(enabled({ participants: { userEligibility: 'user' } }).participants).toEqual({ userEligibility: 'user' });
  const rule = { properties: { staff: { equals: true } } };
  const result = enabled({ participants: { userEligibility: rule } }, guardian).participants;
  expect(result).toEqual({ userEligibility: rule });
  expect(Object.isFrozen(result)).toBe(true);
  if (!result) throw new Error('Expected admitted synthetic participant rule.');
  expect(Object.isFrozen((result.userEligibility as typeof rule).properties.staff)).toBe(true);
  expect(Object.isFrozen(rule)).toBe(false);
  for (const participants of [true, {}, { userEligibility: true }, { userEligibility: false }, { userEligibility: 'optional' },
    { userEligibility: {} }, { userEligibility: { credentials: ['session'] } },
    { userEligibility: { platformRole: 'admin', credentials: ['session'] } },
    { userEligibility: { user: 'required', mfa: 'required' } }, { userEligibility: 'user', contacts: true },
    { userEligibility: { properties: { preference: 'staff' } } }]) rejects({ participants }, 'CALENDAR_CONFIG_INVALID', guardian);
});

test('admitted requirements are deeply detached and frozen without freezing developer-owned inputs', () => {
  const guardian = resolveAuthBehaviorConfig({ userProperties: { department: { editableBy: 'admin', useInPolicies: true } } });
  const input = {
    createOwn: { credentials: ['session'], platformRole: ['user'] },
    manage: { properties: { department: { in: ['scheduling', 'operations'] } } },
  };
  const config = enabled(input, guardian);
  expect(config.createOwn).not.toBe(input.createOwn);
  expect(config.manage).not.toBe(input.manage);
  const own = config.createOwn as typeof input.createOwn;
  const manage = config.manage as typeof input.manage;
  expect(Object.isFrozen(own)).toBe(true);
  expect(Object.isFrozen(own.credentials)).toBe(true);
  expect(Object.isFrozen(own.platformRole)).toBe(true);
  expect(Object.isFrozen(manage.properties.department.in)).toBe(true);
  expect(Object.isFrozen(input)).toBe(false);
  expect(Object.isFrozen(input.manage.properties.department.in)).toBe(false);
  input.createOwn.credentials.push('api-key');
  input.manage.properties.department.in[0] = 'changed';
  expect(own.credentials).toEqual(['session']);
  expect(manage.properties.department.in).toEqual(['scheduling', 'operations']);
});

test('nested policy accessors, arrays, proxies, symbols, cycles and excessive data cannot execute during admission', () => {
  let invoked = 0;
  const getter = Object.defineProperty({}, 'permission', { enumerable: true, get() { invoked++; return 'application.members:manage'; } });
  const proxy = new Proxy({}, { getPrototypeOf() { invoked++; return Object.prototype; }, ownKeys() { invoked++; return []; } });
  const arrayGetter = Object.defineProperty(['session'], '0', { enumerable: true, get() { invoked++; return 'session'; } });
  const cycle: Record<string, unknown> = {}; cycle.properties = cycle;
  for (const manage of [getter, proxy, { credentials: arrayGetter }, { platformRole: new Proxy(['admin'], {}) }, { properties: { department: proxy } }, cycle,
    { [Symbol('role')]: 'admin' }, { permission: 'application.members:manage', unknown: true }, { properties: { department: 'x'.repeat(33 * 1024) } }]) rejects({ manage });
  const capability = Object.defineProperty({}, 'enabled', { enumerable: true, get() { invoked++; return true; } });
  rejects({ recurrence: capability });
  expect(invoked).toBe(0);
});
