/** Private complete-profile composition for native series qualification.
 * NOT the default calendarRealm, public configuration or an activated service.
 * Parent and actor must import this same definition and matching native bind. */
import { defineDatabaseRealm, type DatabaseReadQueryHandler } from '../databases/database-realm';
import type { DatabaseWriterAdmissionDefinition } from '../databases/database-writer-admission';
import type { DatabaseSerializableValue } from '../databases/database-operations';
import { calendarRealm } from './realm';
import { CALENDAR_SERIES_MIGRATION, calendarSeriesTables } from './realm-series-migration';
import { CALENDAR_SERIES_MATERIALIZATION_MIGRATION, calendarSeriesMaterializationTables } from './realm-series-materialization-migration';
import { readCalendarSeriesOccupancy, CALENDAR_SERIES_OCCUPANCY_QUERY } from './series-occupancy';
import { beginCalendarSeriesMaterialization, stageCalendarSeriesMaterialization, abortCalendarSeriesMaterialization,
  readCalendarSeriesMaterialization, reconcileCalendarSeriesMaterializationReceipt } from './series-materialization-writer';
import { sealCalendarSeriesMaterialization, publishCalendarSeriesMaterialization } from './series-materialization-publication';
import { CALENDAR_SERIES_PUBLICATION_QUERY, readCalendarSeriesPublicationWork } from './series-publication-query';
import { readCalendarSeriesPlan, readCalendarTimedSeriesSource } from './series-read-model';
import { normalizeCalendarSeriesNativeWriterPolicy, verifyCalendarSeriesNativeEnvelope, type CalendarSeriesNativeOperation } from './series-native-transport';
import { CalendarError, calendarRead, calendarCommand } from './error';
import { acceptCalendarInitialSeriesNativeSource } from './series-source-native';
import { verifyCalendarInitialSeriesNativeEnvelope } from './series-native-transport';
import { readCalendarInitialSeriesReceipt } from './series-initial-query';

const NATIVE_COMMANDS = new Set(['calendar.series.run.begin', 'calendar.series.run.stage', 'calendar.series.run.abort', 'calendar.series.run.seal', 'calendar.series.run.publish']);
const COMMANDS = new Set([...Object.keys(calendarRealm.commands), ...NATIVE_COMMANDS, 'calendar.series.source.accept']);
function read(handler: (context: Parameters<DatabaseReadQueryHandler>[0], input: unknown) => unknown): DatabaseReadQueryHandler {
  return (context, input) => calendarRead(() => handler(context, input)) as DatabaseSerializableValue;
}
/** Stable code, ephemeral runtime binding. An unrelated low-level CRUD command
 * cannot bypass canonical Calendar admission merely by acquiring the private DB. */
export const calendarSeriesMaterializationWriterAdmission: DatabaseWriterAdmissionDefinition = Object.freeze<DatabaseWriterAdmissionDefinition>({
  id: 'zero.calendar.series.native.v1',
  normalizeBinding: normalizeCalendarSeriesNativeWriterPolicy,
  snapshot(context) {
    const state = context.get('_calendar_series_materialization_state', 'application');
    if (state?.version !== 21) throw new CalendarError('CALENDAR_STATE_INVALID');
    return { version: 21 };
  },
  validate(context, operation) {
    calendarCommand(() => {
      if (operation.type !== 'command' || !COMMANDS.has(operation.name)) throw new CalendarError('CALENDAR_FORBIDDEN');
      if (NATIVE_COMMANDS.has(operation.name)) {
        // Repeat the seal deadline/root/realm/policy check after the handler,
        // immediately before the real engine records its transport receipt.
        verifyCalendarSeriesNativeEnvelope(context.policy, operation.input, operation.name as CalendarSeriesNativeOperation);
      }
      if (operation.name === 'calendar.series.source.accept') verifyCalendarInitialSeriesNativeEnvelope(context.policy, operation.input);
    });
    return undefined;
  },
  project() { return { version: 21 }; },
});

export const calendarSeriesMaterializationRealm = defineDatabaseRealm({
  name: calendarRealm.name,
  version: '21',
  tables: calendarSeriesMaterializationTables(),
  migrations: [...calendarRealm.migrations, CALENDAR_SERIES_MIGRATION, CALENDAR_SERIES_MATERIALIZATION_MIGRATION],
  migrationTableStages: [...calendarRealm.migrationTableStages!,
    { version: '020', tables: calendarSeriesTables() },
    { version: '021', tables: calendarSeriesMaterializationTables() }],
  writerAdmission: calendarSeriesMaterializationWriterAdmission,
  commands: { ...calendarRealm.commands,
    'calendar.series.run.begin': beginCalendarSeriesMaterialization,
    'calendar.series.run.stage': stageCalendarSeriesMaterialization,
    'calendar.series.run.abort': abortCalendarSeriesMaterialization,
    'calendar.series.run.seal': sealCalendarSeriesMaterialization,
    'calendar.series.run.publish': publishCalendarSeriesMaterialization,
    'calendar.series.source.accept': acceptCalendarInitialSeriesNativeSource,
  },
  queries: { ...calendarRealm.queries,
    [CALENDAR_SERIES_OCCUPANCY_QUERY]: read(readCalendarSeriesOccupancy),
    [CALENDAR_SERIES_PUBLICATION_QUERY]: read(readCalendarSeriesPublicationWork),
    'calendar.series.plan': read(readCalendarSeriesPlan),
    'calendar.series.source': read(readCalendarTimedSeriesSource),
    'calendar.series.run': read(readCalendarSeriesMaterialization),
    'calendar.series.run.receipt': read(reconcileCalendarSeriesMaterializationReceipt),
    'calendar.series.initialReceipt': read(readCalendarInitialSeriesReceipt),
  },
});
