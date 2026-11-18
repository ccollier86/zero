/** Internal native-source boundary only. Deliberately absent from request/public calendar exports. */
import { serviceDataScopeKey, type ServiceDataScope } from '../auth/service-data-scope';
import { CALENDAR_INTEGRATION_COMMANDS, CALENDAR_INTEGRATION_QUERIES, integrationPolicy } from './integration-model';
import { CalendarError } from './error';
import type { CalendarOwnerRecord } from './owner-schema';
import { calendarKey, calendarRecord, calendarValue } from './validation';

export type CalendarIntegrationCommand = typeof CALENDAR_INTEGRATION_COMMANDS[number];
export type CalendarIntegrationQuery = typeof CALENDAR_INTEGRATION_QUERIES[number];

export interface CalendarIntegrationReadOptions {
  readonly signal?: AbortSignal;
  /** Trusted synchronous current-policy fence, separate from owner lifetime. */
  readonly assertCurrent?: () => void;
}
export interface CalendarIntegrationCommandOptions extends CalendarIntegrationReadOptions {
  readonly idempotencyKey: string;
}

/** Owner-bound native operations, not a synthetic CalendarActor or a general database capability. */
export interface CalendarIntegrationOwner {
  readonly owner: CalendarOwnerRecord;
  readonly scope: ServiceDataScope;
  /** Calendar owner/runtime lifetime only; retiring policy must not abort historical reconciliation. */
  readonly signal: AbortSignal;
  /** Synchronous SYSTEM metadata/lifetime fence. Does not claim a physical file was freshly read. */
  assertCurrent(): void;
  /** Fresh same-lease physical owner proof; never binds/provisions an owner or explicitly migrates. */
  verify(options?: CalendarIntegrationReadOptions): Promise<void>;
  read<T>(name: CalendarIntegrationQuery, input: unknown, options?: CalendarIntegrationReadOptions): Promise<T>;
  command<T>(name: CalendarIntegrationCommand, input: unknown, options: CalendarIntegrationCommandOptions): Promise<T>;
}

const commands = new Set<string>(CALENDAR_INTEGRATION_COMMANDS);
const queries = new Set<string>(CALENDAR_INTEGRATION_QUERIES);

/** Detach authored values before acquiring a lease; routing/ownership/request identity remain native. */
export function calendarIntegrationInput(owner: CalendarOwnerRecord, scope: ServiceDataScope,
  kind: 'query' | 'command', name: string, input: unknown, requestId?: string): Record<string, unknown> {
  if (!(kind === 'command' ? commands : queries).has(name)) throw new CalendarError('CALENDAR_INPUT_INVALID');
  const body = calendarRecord(calendarValue(input));
  if (['scopeId', 'expectedOwnerId', 'actor', 'requestId'].some(key => Object.hasOwn(body, key))) throw new CalendarError('CALENDAR_INPUT_INVALID');
  if (serviceDataScopeKey(scope) !== owner.scope_id) throw new CalendarError('CALENDAR_STATE_INVALID');
  if (kind === 'command' && name === 'calendar.integration.policy.install') {
    const policy = integrationPolicy(body.policy), source = policy.source, identity = source.identity;
    // The private realm knows its immutable owner and scope, not its physical
    // root or currently admitted realm. Bind those contract facts here, after
    // the runtime's established/current-owner fence and before acquiring SQL.
    if (identity.databaseId !== owner.id || identity.ownerId !== owner.owner_id || identity.scopeId !== owner.scope_id
      || identity.rootHash !== owner.root_hash || source.realmFingerprint !== owner.realm_fingerprint) throw new CalendarError('CALENDAR_STATE_INVALID');
    body.policy = policy;
  }
  return { ...body, scopeId: owner.scope_id, expectedOwnerId: owner.owner_id,
    ...(kind === 'command' ? { requestId: calendarKey(requestId) } : {}) };
}

export function calendarIntegrationOptions(input: unknown, command: boolean): {
  readonly signal?: AbortSignal; readonly assertCurrent: () => void; readonly key?: string;
} {
  const record = calendarRecord(input ?? {}, command ? ['signal', 'assertCurrent', 'idempotencyKey'] : ['signal', 'assertCurrent']);
  if (record.signal !== undefined && !(record.signal instanceof AbortSignal)
    || record.assertCurrent !== undefined && typeof record.assertCurrent !== 'function') throw new CalendarError('CALENDAR_INPUT_INVALID');
  return { ...(record.signal === undefined ? {} : { signal: record.signal as AbortSignal }),
    assertCurrent: record.assertCurrent as (() => void) | undefined ?? (() => {}),
    ...(command ? { key: calendarKey(record.idempotencyKey) } : {}) };
}
