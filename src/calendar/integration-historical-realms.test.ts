/** Metadata-only qualification: no database, migration execution, files or workers. */
import { expect, test } from 'bun:test';
import { defineDatabaseRealm } from '../databases/database-realm';
import { calendarRealm } from './realm';
import { CALENDAR_INTEGRATION_TABLES } from './realm-integrations-migration';
import { CALENDAR_INTEGRATION_OWNERSHIP_TABLES } from './realm-integration-ownership-migration';
import { CALENDAR_INTEGRATION_CONTROL_TABLES } from './realm-integration-controls-migration';
import { CALENDAR_INTEGRATION_QUEUE_TABLES } from './realm-integration-queue-migration';
import { CALENDAR_INTEGRATION_INSPECTION_TABLES } from './realm-integration-inspection-migration';
import { CALENDAR_INTEGRATION_HISTORICAL_REALMS, isCalendarIntegrationHistoricalRealmFingerprint } from './integration-historical-realms';
import { calendarInspectionHistoricalRealm } from './test-support/integration-inspection-fixture';

// Original registry names read from the committed realm.ts at 11e9bbc/c32d307,
// 6b3bf16 and fdc8262 respectively. 010/011 had neither the 012 controls nor
// 013 nextWake; 012 had controls but no nextWake. None had 014 inspection.
const CONTROL_COMMANDS = new Set(['calendar.integration.control.prepare', 'calendar.integration.control.ack', 'calendar.integration.control.fail']);
const CONTROL_QUERIES = new Set(['calendar.integration.control', 'calendar.integration.controls', 'calendar.integration.controlEvidence']);
const generations = [
  { version: '010', count: 10, tables: CALENDAR_INTEGRATION_TABLES, commands: 32, queries: 29,
    schema: '88c082bb2699190b38c842978ff66b770bf16ec32f452149fdae852d8cb5e5c7' },
  { version: '011', count: 11, tables: CALENDAR_INTEGRATION_OWNERSHIP_TABLES, commands: 32, queries: 29,
    schema: 'df10f32ada83b3f8bcf387f25beaf7fb1acb99801ec0af16b8c2f4ffe07c22fe' },
  { version: '012', count: 12, tables: CALENDAR_INTEGRATION_CONTROL_TABLES, commands: 35, queries: 32,
    schema: '3fe17c27bd4b6f2eda34e8f1f8bb43058d8779766248ab316111917c1d44f581' },
  { version: '013', count: 13, tables: CALENDAR_INTEGRATION_QUEUE_TABLES, commands: 35, queries: 33,
    schema: 'e18f7613d8eeee600bae966a25e3597ed6ba5c75686d49520d697c66357f9d6a' },
  { version: '014', count: 14, tables: CALENDAR_INTEGRATION_INSPECTION_TABLES, commands: 35, queries: 34,
    schema: 'a2f91077414b0a49d44a69e5c8e8f96fbccaf03e224542c5290bdc447f7dcb83' },
] as const;

test('retained source compatibility pins are genuine complete 010–013 realms, not current-registry approximations', () => {
  expect(CALENDAR_INTEGRATION_HISTORICAL_REALMS.map(realm => realm.version)).toEqual(generations.map(realm => realm.version));
  for (const generation of generations) {
    const commands = Object.fromEntries(Object.entries(calendarRealm.commands).filter(([name]) => !name.startsWith('calendar.integration.operator.') && (generation.count >= 12 || !CONTROL_COMMANDS.has(name))));
    const queries = Object.fromEntries(Object.entries(calendarRealm.queries).filter(([name]) => !name.startsWith('calendar.integration.operator.') && (generation.count >= 14 || name !== 'calendar.integration.inspection')
      && (generation.count >= 13 || name !== 'calendar.integration.nextWake') && (generation.count >= 12 || !CONTROL_QUERIES.has(name))));
    const historical = defineDatabaseRealm({ name: calendarRealm.name, version: String(generation.count), tables: generation.tables,
      migrations: calendarRealm.migrations.slice(0, generation.count), commands, queries });
    expect(Object.keys(historical.commands)).toHaveLength(generation.commands);
    expect(Object.keys(historical.queries)).toHaveLength(generation.queries);
    expect(historical.schemaChecksum).toBe(generation.schema);
    expect(historical.fingerprint).toBe(CALENDAR_INTEGRATION_HISTORICAL_REALMS.find(realm => realm.version === generation.version)!.fingerprint);
    expect(historical.fingerprint).not.toBe(calendarRealm.fingerprint);
    if (generation.version === '013') expect(historical.fingerprint).toBe(calendarInspectionHistoricalRealm.fingerprint);
  }
});

test('historical contract recognition is exact, immutable and cannot admit current or arbitrary fingerprints', () => {
  expect(Object.isFrozen(CALENDAR_INTEGRATION_HISTORICAL_REALMS)).toBe(true);
  for (const realm of CALENDAR_INTEGRATION_HISTORICAL_REALMS) {
    expect(Object.isFrozen(realm)).toBe(true); expect(isCalendarIntegrationHistoricalRealmFingerprint(realm.fingerprint)).toBe(true);
  }
  for (const input of [calendarRealm.fingerprint, 'sha256:' + '0'.repeat(64), '010', null, undefined, {},
    CALENDAR_INTEGRATION_HISTORICAL_REALMS[0]!.fingerprint.toUpperCase()]) expect(isCalendarIntegrationHistoricalRealmFingerprint(input)).toBe(false);
});
