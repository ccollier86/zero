/** Pure internal admission only: no files, actor factories, routes, timers or providers are opened. */
import { isAbsolute, relative, resolve } from 'node:path';
import { createAuthorizationKernel, type AccessRequirement, type AuthorizationKernel } from '../auth/authorization-kernel';
import type { NormalizedAuthBehaviorConfig } from '../auth/types';
import { CalendarError } from './error';
import { normalizeCalendarTimeZone } from './time';
import { calendarInteger, calendarRecord, calendarText, calendarValue } from './validation';

export interface CalendarConfig {
  readonly rootDirectory?: string;
  /** Explicit scheduling zone; omission/null requires setup. Never inferred from the host or viewer. */
  readonly timezone?: string | null;
  /** false disables own-creation; it is a deny sentinel, not Guardian's public-access scalar. */
  readonly createOwn?: AccessRequirement;
  /** Delegated management may require a configured permission, role or trusted property instead of admin. */
  readonly manage?: AccessRequirement;
  readonly maxRangeDays?: number;
  readonly maxPageSize?: number;
  readonly maxResources?: number;
  readonly maxParticipants?: number;
  readonly maxActiveDatabases?: number;
  readonly maxDatabaseFiles?: number;
  /** These capabilities are not implemented. Explicit enablement fails closed, never reports readiness. */
  readonly recurrence?: false;
  readonly reminders?: false;
  readonly selfBooking?: false;
}

export interface ResolvedCalendarConfig {
  readonly rootDirectory: string;
  readonly timezone: string | null;
  /** Configuration admission is not storage, actor, domain or provider readiness. */
  readonly readiness: 'setup-required' | 'configured';
  /** false is a calendar deny sentinel: never pass it to Guardian as a public-access declaration. */
  readonly createOwn: AccessRequirement;
  readonly manage: AccessRequirement;
  readonly maxRangeDays: number;
  readonly maxPageSize: number;
  readonly maxResources: number;
  readonly maxParticipants: number;
  readonly maxActiveDatabases: number;
  readonly maxDatabaseFiles: number;
  readonly recurrence: false;
  readonly reminders: false;
  readonly selfBooking: false;
}

const CONFIG_FIELDS = [
  'rootDirectory', 'timezone', 'createOwn', 'manage', 'maxRangeDays', 'maxPageSize',
  'maxResources', 'maxParticipants', 'maxActiveDatabases', 'maxDatabaseFiles',
  'recurrence', 'reminders', 'selfBooking',
] as const;
const ACCESS_FIELDS = [
  'user', 'credentials', 'platformRole', 'tenant', 'scopeRole', 'permission',
  'allPermissions', 'anyPermissions', 'properties',
] as const;
const SESSION_ACCESS = Object.freeze({ user: 'required' as const, credentials: Object.freeze(['session'] as const) });

/** Explicit auth:false cannot produce an unauthenticated calendar; disabled declarations are entirely inert. */
export function resolveCalendarConfig(
  input: CalendarConfig | boolean | undefined,
  projectRoot: string,
  auth: NormalizedAuthBehaviorConfig | null,
): ResolvedCalendarConfig | false {
  if (input === undefined || input === false) return false;
  try {
    if (!auth) throw new CalendarError('CALENDAR_CONFIG_INVALID');
    const record = input === true ? {} : calendarRecord(input, CONFIG_FIELDS);
    // Reject malformed configuration before reporting an unavailable capability.
    const unsupported = ['recurrence', 'reminders', 'selfBooking'].map(key => requestedCapability(record[key])).some(Boolean);
    const root = calendarText(projectRoot, 4096);
    if (!isAbsolute(root) || root.trim() !== root) throw new CalendarError('CALENDAR_CONFIG_INVALID');
    const directory = calendarText(record.rootDirectory === undefined ? 'data/zero.calendar' : record.rootDirectory, 4096);
    if (directory.trim() !== directory) throw new CalendarError('CALENDAR_CONFIG_INVALID');
    const rootDirectory = resolve(root, directory);
    // A private feature root cannot swallow the project or one of its ancestors.
    const projectWithinRoot = relative(rootDirectory, resolve(root));
    if (!projectWithinRoot || projectWithinRoot !== '..' && !projectWithinRoot.startsWith('../') && !isAbsolute(projectWithinRoot)) {
      throw new CalendarError('CALENDAR_CONFIG_INVALID');
    }
    const kernel = createAuthorizationKernel(auth);
    const createOwn = admitAccess(record.createOwn === undefined ? 'user' : record.createOwn, kernel, false);
    const manage = admitAccess(record.manage === undefined ? (auth.tenancy.mode === 'multi' ? { permission: 'tenant.members:manage' } : 'admin') : record.manage, kernel, true);
    const timezone = record.timezone === undefined || record.timezone === null ? null : normalizeCalendarTimeZone(record.timezone);
    const maxActiveDatabases = calendarInteger(record.maxActiveDatabases === undefined ? 4 : record.maxActiveDatabases, 1, 64);
    const config: ResolvedCalendarConfig = {
      rootDirectory, timezone, readiness: timezone === null ? 'setup-required' : 'configured', createOwn, manage,
      maxRangeDays: calendarInteger(record.maxRangeDays === undefined ? 62 : record.maxRangeDays, 1, 366),
      maxPageSize: calendarInteger(record.maxPageSize === undefined ? 200 : record.maxPageSize, 1, 1000),
      maxResources: calendarInteger(record.maxResources === undefined ? 100 : record.maxResources, 1, 1000),
      maxParticipants: calendarInteger(record.maxParticipants === undefined ? 100 : record.maxParticipants, 1, 100),
      maxActiveDatabases, maxDatabaseFiles: calendarInteger(record.maxDatabaseFiles === undefined ? 1000 : record.maxDatabaseFiles, maxActiveDatabases, 10_000),
      recurrence: false, reminders: false, selfBooking: false,
    };
    if (unsupported) throw new CalendarError('CALENDAR_NOT_READY');
    return Object.freeze(config);
  } catch (error) {
    if (error instanceof CalendarError && error.code === 'CALENDAR_NOT_READY') throw error;
    throw new CalendarError('CALENDAR_CONFIG_INVALID');
  }
}

function admitAccess(input: unknown, kernel: AuthorizationKernel, management: boolean): AccessRequirement {
  if (!management && input === false) return false;
  const requirement = calendarValue(input) as AccessRequirement;
  if (requirement && typeof requirement === 'object') {
    const record = calendarRecord(requirement, ACCESS_FIELDS);
    // Native/API-key calendar admission is deferred, even when a declaration also permits sessions.
    if (record.credentials !== undefined && (!Array.isArray(record.credentials)
      || record.credentials.length !== 1 || record.credentials[0] !== 'session')) {
      throw new CalendarError('CALENDAR_CONFIG_INVALID');
    }
  }
  const own = kernel.compile(requirement);
  if (own.user !== 'required' || management && !own.platformRoleGroups.length && !own.scopeRoleGroups.length
    && !own.allPermissions.length && !own.anyPermissionGroups.length && !own.propertyGroups.length) {
    throw new CalendarError('CALENDAR_CONFIG_INVALID');
  }
  // Validate the fixed guard too. Future request services still require fresh scope/object authorization.
  kernel.compile(requirement, SESSION_ACCESS);
  return deepFreeze(requirement);
}

function requestedCapability(value: unknown): boolean {
  if (value === undefined || value === false) return false;
  if (value === true) return true;
  calendarRecord(value);
  calendarValue(value);
  return true;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
