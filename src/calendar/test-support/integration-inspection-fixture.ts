/** Synthetic native MEMORY only. No physical SQLite files, backups, workers or generated output. */
import { Database } from 'bun:sqlite';
import { spyOn } from 'bun:test';
import { defineDatabaseRealm, runDatabaseRealmCommand, runDatabaseRealmQuery } from '../../databases/database-realm';
import type { DatabaseSerializableValue } from '../../databases/database-operations';
import { createDatabaseReadQuerySession, withDatabaseReadQuerySession } from '../../databases/database-read-query-capability';
import { Migrator } from '../../migrations/migrator';
import { createReactiveDB } from '../../sync/reactive-db';
import { jobSourceId, jobSourceScheduleId } from '../../jobs/source-model';
import { calendarRealm } from '../realm';
import { CALENDAR_INTEGRATION_QUEUE_TABLES } from '../realm-integration-queue-migration';
import { CALENDAR_INTEGRATION_INSPECTION_ADDITIONS, CALENDAR_INTEGRATION_INSPECTION_TABLES } from '../realm-integration-inspection-migration';
import { calendarHash } from '../validation';
import type { CalendarIntegrationClaim, CalendarIntegrationPolicySpec } from '../integration-model';
import type { CalendarIntegrationInspection } from '../integration-inspection-model';

export const calendarInspectionHistoricalRealm = defineDatabaseRealm({ name: calendarRealm.name, version: '13', tables: CALENDAR_INTEGRATION_QUEUE_TABLES,
  migrations: calendarRealm.migrations.slice(0, 13), commands: Object.fromEntries(Object.entries(calendarRealm.commands).filter(([name]) => !name.startsWith('calendar.integration.operator.'))),
  queries: Object.fromEntries(Object.entries(calendarRealm.queries).filter(([name]) => name !== 'calendar.integration.inspection' && !name.startsWith('calendar.integration.operator.'))) });
export const calendarOperatorHistoricalRealm = defineDatabaseRealm({ name: calendarRealm.name, version: '14', tables: CALENDAR_INTEGRATION_INSPECTION_TABLES,
  migrations: calendarRealm.migrations.slice(0, 14), commands: calendarInspectionHistoricalRealm.commands,
  queries: Object.fromEntries(Object.entries(calendarRealm.queries).filter(([name]) => !name.startsWith('calendar.integration.operator.'))) });

export function calendarInspectionFixture(options: { historical?: boolean | '014'; bind?: boolean; scopeId?: string } = {}) {
  const db = createReactiveDB({ mode: 'memory' }), raw = db.getRawDatabase(), now = 1_900_000_000_000, clock = spyOn(Date, 'now').mockReturnValue(now);
  const realm = options.historical === '014' ? calendarOperatorHistoricalRealm : options.historical ? calendarInspectionHistoricalRealm : calendarRealm;
  const close = () => { try { db.dispose(); } finally { clock.mockRestore(); } };
  try {
    raw.run('PRAGMA temp_store=MEMORY'); raw.run('PRAGMA foreign_keys=ON');
    for (const [name, schema] of Object.entries(realm.tables)) db.defineTable(name, schema);
    const migrate = (migrations = realm.migrations) => {
      const migrator = new Migrator({ database: raw, dbPath: ':memory:', migrations, createBackups: false, log() {} });
      try { return migrator.run(); } finally { migrator.dispose(); }
    };
    migrate();
    const owner = { scopeId: options.scopeId ?? 'application', expectedOwnerId: 'synthetic-inspection-owner' };
    const actor = { scopeId: owner.scopeId, userId: 'synthetic-user', principal: 'synthetic-session', manageAll: true, createOwn: true };
    let sequence = 0;
    const command = (name: string, body: Record<string, unknown> = {}): any => (runDatabaseRealmCommand(realm, db, 'calendar.' + name,
      { requestId: 'inspection-' + ++sequence, ...body } as DatabaseSerializableValue) as any).value;
    const integration = (name: string, body: Record<string, unknown> = {}): any => command('integration.' + name, { ...owner, ...body });
    let queries: string[] = [];
    const query = (name: string, body: Record<string, unknown> = {}): any => {
      const copy = Database.deserialize(raw.serialize(), { readonly: true, strict: true });
      const prepared = spyOn(copy, 'prepare');
      try {
        copy.run('PRAGMA temp_store=MEMORY');
        return withDatabaseReadQuerySession(createDatabaseReadQuerySession(copy), context => runDatabaseRealmQuery(calendarRealm, context,
          'calendar.integration.' + name, { ...owner, ...body } as DatabaseSerializableValue));
      } finally { queries = prepared.mock.calls.map(call => String(call[0])); prepared.mockRestore(); copy.close(); }
    };
    const inspect = (body: Record<string, unknown> = {}): CalendarIntegrationInspection => query('inspection', body);
    if (options.bind !== false) {
      runDatabaseRealmCommand(realm, db, 'calendar.owner.bind', { scopeId: owner.scopeId, ownerId: owner.expectedOwnerId });
      command('resource.create', { actor, id: 'resource', label: 'PRIVATE_INSPECTION_RESOURCE', kind: 'room', ownerId: null, timeZone: 'UTC' });
    }
    const policy = (ruleId = 'observe', version = 'A'): CalendarIntegrationPolicySpec => ({ ruleId, ruleVersion: '1', adapter: 'observation-v1', dueOffsetMs: -60_000, maxLatenessMs: 60_000,
      source: { identity: { domain: 'calendar.' + ruleId, databaseId: 'calendar:' + calendarHash(owner.scopeId), ownerId: owner.expectedOwnerId, scopeId: owner.scopeId, rootHash: '1'.repeat(64) },
        realmFingerprint: realm.fingerprint, policyVersion: version, semanticsVersion: 'observation-v1', definition: { name: 'calendar.observe', version: '1', fingerprint: '2'.repeat(64) },
        workflow: { name: 'calendar.observe', version: 1, definitionId: 'PRIVATE_DEFINITION', versionId: 'PRIVATE_VERSION', fingerprint: '3'.repeat(64) } } });
    const registration = (spec = policy(), epoch = 1) => ({ id: jobSourceId(spec.source.identity), generation: epoch, revision: epoch, state: 'active' as const, policyHash: calendarHash(spec.source) });
    const install = (ruleId = 'observe', version = 'A', expectedEpoch = 0, activate = true) => {
      const spec = policy(ruleId, version), selected = integration('policy.install', { policy: spec, expectedEpoch, now });
      if (activate) integration('policy.activate', { ruleId, epoch: selected.epoch, registration: registration(spec, selected.epoch) });
      return selected;
    };
    const rows = (suffix: string): any[] => raw.query('SELECT * FROM _calendar_integration_' + suffix + ' ORDER BY id').all();
    const appointment = (id = 'appointment', offset = 0) => {
      command('appointment.create', { actor, id, resourceIds: ['resource'], title: 'PRIVATE_INSPECTION_TITLE',
        startAt: new Date(now + 60_000 + offset).toISOString(), endAt: new Date(now + 120_000 + offset).toISOString(), timeZone: 'UTC', bufferBeforeMinutes: 0, bufferAfterMinutes: 0 });
      return rows('intents').filter(row => row.appointment_id === id)[0]!.id as string;
    };
    const claim = (at = now): CalendarIntegrationClaim => integration('claim', { now: at, nonce: 'inspection-nonce-' + sequence, leaseMs: 1000, limit: 1 })[0];
    const ack = (claim: CalendarIntegrationClaim) => integration('ack', { id: claim.id, nonce: claim.nonce, claimGeneration: claim.claimGeneration, phase: 'create',
      receipt: { id: jobSourceScheduleId(claim.intent.policy.source.identity, claim.intent.createKey), sourceId: claim.intent.registration!.id,
        policyGeneration: claim.intent.registration!.generation, control: 'active', revision: 1, generation: 1, createdAt: now, updatedAt: now } });
    const admit = (id: string) => {
      const intent = query('intent', { id }); return integration('effect.admit', { id, executionId: 'execution-' + id, nonce: 'effect-' + id, registration: intent.registration, workflow: intent.policy.source.workflow });
    };
    const settle = (id: string) => integration('effect.settle', { id, executionId: 'execution-' + id, nonce: 'effect-' + id, outcome: 'observed', now });
    const define = () => { for (const [name, schema] of Object.entries(CALENDAR_INTEGRATION_INSPECTION_ADDITIONS)) db.defineTable(name, schema); };
    const upgrade = () => { define(); return migrate(options.historical === true ? calendarRealm.migrations.slice(0, 14) : calendarRealm.migrations); };
    return { db, raw, realm, owner, actor, now, command, integration, query, inspect, policy, registration, install, appointment, claim, ack, admit, settle, rows, define, upgrade,
      get queries() { return queries; }, setNow: (at: number) => clock.mockReturnValue(at), close };
  } catch (error) { close(); throw error; }
}
