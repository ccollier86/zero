/** Native MEMORY only; every source, snapshot, clock and database is closed by the owning test's finally. */
import { Database } from 'bun:sqlite';
import { runDatabaseRealmCommand, runDatabaseRealmQuery } from '../../databases/database-realm';
import type { DatabaseSerializableValue } from '../../databases/database-operations';
import { createDatabaseReadQuerySession, withDatabaseReadQuerySession } from '../../databases/database-read-query-capability';
import { LoggingActorSource, normalizeLoggingActorSourceBinding } from '../../logging/logging-actor-source';
import { loggingContext } from '../../logging/test-support/logging-fixture';
import { calendarRealm } from '../realm';
import { calendarInspectionFixture } from './integration-inspection-fixture';
import type { CalendarActor } from '../contracts';
import type { CalendarIntegrationOperatorRequestReceipt } from '../integration-operator-request-model';
import type { CalendarIntegrationPolicySelection } from '../integration-controller';
import { calendarValue } from '../validation';

export function calendarOperatorRequestFixture(options: { historical?: '014'; logging?: boolean; workflow?: boolean; maxEvents?: number; scopeId?: string } = {}) {
  const f = calendarInspectionFixture({ ...(options.historical ? { historical: options.historical } : {}), ...(options.scopeId ? { scopeId: options.scopeId } : {}) });
  let source: LoggingActorSource | null = null;
  try {
    source = options.logging ? new LoggingActorSource(f.db, normalizeLoggingActorSourceBinding({ records: false, workflow: options.workflow !== false,
      policyVersion: 'operator-request-audit', scope: f.owner.scopeId === 'application' ? { kind: 'application', tenantId: null } : { kind: 'tenant', tenantId: f.owner.scopeId.slice(7) }, sourceQueue: { maxEvents: options.maxEvents ?? 100 } })) : null;
    const command = (input: Record<string, unknown>): CalendarIntegrationOperatorRequestReceipt => {
      const actor = (input.actor ?? f.actor) as CalendarActor;
      const run = () => runDatabaseRealmCommand(calendarRealm, f.db, 'calendar.integration.operator.request',
        calendarValue({ actor, expectedOwnerId: f.owner.expectedOwnerId, ...input })) as unknown as { readonly ok: true; readonly value: CalendarIntegrationOperatorRequestReceipt };
      const attribution = { ...loggingContext(f.owner.scopeId === 'application' ? null : f.owner.scopeId.slice(7)), actor: { kind: 'user' as const, id: actor.userId, sessionId: 'synthetic-session', initiatorId: null } };
      return (source ? source.run(attribution, run) : run()).value;
    };
    const query = (requestId: string, overrides: Record<string, unknown> = {}): CalendarIntegrationOperatorRequestReceipt | null => {
      const copy = Database.deserialize(f.raw.serialize(), { readonly: true, strict: true });
      try { copy.run('PRAGMA temp_store=MEMORY'); return withDatabaseReadQuerySession(createDatabaseReadQuerySession(copy), context => runDatabaseRealmQuery(calendarRealm, context,
        'calendar.integration.operator.receipt', { actor: f.actor, expectedOwnerId: f.owner.expectedOwnerId, requestId, ...overrides } as DatabaseSerializableValue)) as unknown as CalendarIntegrationOperatorRequestReceipt | null; }
      finally { copy.close(); }
    };
    const selection = (): CalendarIntegrationPolicySelection => {
      const policy = f.query('policy', { ruleId: 'observe' }); return { id: policy.id, epoch: policy.epoch, policyDigest: f.inspect().rules.find(rule => rule.ruleId === 'observe')!.policyDigest };
    };
    const retire = (requestId = 'retire', expected = selection(), extra: Record<string, unknown> = {}) => command({ requestId, action: 'retire', ruleId: 'observe', expected, ...extra });
    const reactivate = (requestId = 'reactivate', expected = selection(), extra: Record<string, unknown> = {}) => command({ requestId, action: 'reactivate', ruleId: 'observe', expected, desired: f.policy(), ...extra });
    const settleRetirement = () => {
      const policy = f.query('policy', { ruleId: 'observe' }), registration = f.registration();
      const control = f.integration('control.prepare', { ruleId: 'observe', epoch: policy.epoch, action: 'retire', expectedRegistration: registration });
      return f.integration('control.ack', { id: control.id, result: { state: 'accepted', registration: { ...registration, state: 'retired', revision: registration.revision + 1 } } });
    };
    return { ...f, source, request: command, receipt: query, selection, retire, reactivate, settleRetirement,
      close() { try { source?.close(); } finally { f.close(); } } };
  } catch (error) { try { source?.close(); } finally { f.close(); } throw error; }
}
