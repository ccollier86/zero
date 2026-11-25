/** Unregistered selected-child qualification profile. Default Calendar remains
 *019; importing this fixed package module is not managed/public activation. */
import { defineDatabaseRealm, type DatabaseReadQueryHandler } from '../databases/database-realm';
import type { DatabaseWriterAdmissionDefinition } from '../databases/database-writer-admission';
import type { DatabaseSerializableValue } from '../databases/database-operations';
import { calendarSeriesMaterializationRealm, calendarSeriesMaterializationWriterAdmission } from './series-materialization-realm';
import { CALENDAR_SERIES_CHILD_MIGRATION, CALENDAR_SERIES_CHILD_TABLES, calendarSeriesChildTables } from './realm-series-children-migration';
import { beginCalendarSeriesSelectedMaterialization, stageCalendarSeriesSelectedMaterialization, abortCalendarSeriesSelectedMaterialization,
  readCalendarSeriesSelectedMaterialization } from './series-materialization-writer';
import { sealCalendarSeriesSelectedMaterialization, publishCalendarSeriesSelectedMaterialization } from './series-materialization-publication';
import { CALENDAR_SERIES_CHILD_TARGET_QUERY, CALENDAR_SERIES_CHILD_QUERY, CALENDAR_SERIES_CHILDREN_QUERY,
  CALENDAR_SERIES_CHILD_BUSY_QUERY, CALENDAR_SERIES_CHILD_PARTICIPANTS_QUERY, CALENDAR_SERIES_CHILD_MANAGE_TARGET_QUERY,
  resolveNativeSeriesChild, readCalendarSeriesChild, readCalendarSeriesChildParticipants, readCalendarSeriesChildManageTarget,
  queryCalendarSeriesChildren, queryCalendarSeriesChildBusy, readCalendarAppointmentWithSeries, queryCalendarAppointmentsWithSeries,
  queryCalendarBusyWithSeries, readCalendarAppointmentParticipantsWithSeries } from './series-child-reader';
import { CALENDAR_SERIES_OCCUPANCY_QUERY } from './series-occupancy';
import { readCalendarSelectedSeriesOccupancy } from './series-children-occupancy';
import { guardCalendarLegacySeriesAction, assertCalendarLegacySeriesReviewAction } from './series-legacy-action-guard';
import { reviewCalendarSelectedAppointmentCreate, reviewCalendarSelectedAppointmentUpdate } from './series-child-read-store';
import { calendarRecord } from './validation';
import { calendarRead, CalendarError } from './error';

const read = (handler: (context: Parameters<DatabaseReadQueryHandler>[0], input: unknown) => unknown): DatabaseReadQueryHandler =>
  (context, input) => calendarRead(() => handler(context, input)) as DatabaseSerializableValue;

const admission: DatabaseWriterAdmissionDefinition = Object.freeze<DatabaseWriterAdmissionDefinition>({
  id: 'zero.calendar.series.children.native.v1',
  normalizeBinding: calendarSeriesMaterializationWriterAdmission.normalizeBinding,
  snapshot(context) {
    if (context.get(CALENDAR_SERIES_CHILD_TABLES.state, 'application')?.version !== 22) throw new CalendarError('CALENDAR_NOT_READY');
    return { native: calendarSeriesMaterializationWriterAdmission.snapshot(context), children: 22 };
  },
  validate(context, operation, before) {
    // Reuse exact crypto/root/deadline/native-command admission, not a relaxed
    // child-profile route or a second raw CRUD capability.
    const prior = calendarRecord(before, ['native', 'children']);
    if (prior.children !== 22 || context.get(CALENDAR_SERIES_CHILD_TABLES.state, 'application')?.version !== 22) throw new CalendarError('CALENDAR_NOT_READY');
    return calendarSeriesMaterializationWriterAdmission.validate(context, operation, prior.native as DatabaseSerializableValue);
  },
  project() { return { version: 22 }; },
});

export const calendarSeriesChildrenRealm = defineDatabaseRealm({
  name: calendarSeriesMaterializationRealm.name,
  version: '22',
  tables: calendarSeriesChildTables(),
  migrations: [...calendarSeriesMaterializationRealm.migrations, CALENDAR_SERIES_CHILD_MIGRATION],
  migrationTableStages: [...calendarSeriesMaterializationRealm.migrationTableStages!, { version: '022', tables: calendarSeriesChildTables() }],
  writerAdmission: admission,
  commands: { ...calendarSeriesMaterializationRealm.commands,
    'calendar.appointment.update': guardCalendarLegacySeriesAction(calendarSeriesMaterializationRealm.commands['calendar.appointment.update']!),
    'calendar.appointment.reschedule': guardCalendarLegacySeriesAction(calendarSeriesMaterializationRealm.commands['calendar.appointment.reschedule']!),
    'calendar.appointment.cancel': guardCalendarLegacySeriesAction(calendarSeriesMaterializationRealm.commands['calendar.appointment.cancel']!),
    'calendar.appointment.transition': guardCalendarLegacySeriesAction(calendarSeriesMaterializationRealm.commands['calendar.appointment.transition']!),
    'calendar.appointment.participants': guardCalendarLegacySeriesAction(calendarSeriesMaterializationRealm.commands['calendar.appointment.participants']!),
    'calendar.series.run.begin': beginCalendarSeriesSelectedMaterialization,
    'calendar.series.run.stage': stageCalendarSeriesSelectedMaterialization,
    'calendar.series.run.seal': sealCalendarSeriesSelectedMaterialization,
    'calendar.series.run.publish': publishCalendarSeriesSelectedMaterialization,
    'calendar.series.run.abort': abortCalendarSeriesSelectedMaterialization,
  },
  queries: { ...calendarSeriesMaterializationRealm.queries,
    'calendar.series.run': read(readCalendarSeriesSelectedMaterialization),
    [CALENDAR_SERIES_OCCUPANCY_QUERY]: read(readCalendarSelectedSeriesOccupancy),
    'calendar.appointment': read(readCalendarAppointmentWithSeries),
    'calendar.appointments': read(queryCalendarAppointmentsWithSeries),
    'calendar.busy': read(queryCalendarBusyWithSeries),
    'calendar.appointmentParticipants': read(readCalendarAppointmentParticipantsWithSeries),
    'calendar.appointmentReviewCreate': read(reviewCalendarSelectedAppointmentCreate),
    'calendar.appointmentReviewUpdate': read((context, input) => {
      assertCalendarLegacySeriesReviewAction(context, input);
      return reviewCalendarSelectedAppointmentUpdate(context, input);
    }),
    [CALENDAR_SERIES_CHILD_TARGET_QUERY]: read(resolveNativeSeriesChild),
    [CALENDAR_SERIES_CHILD_QUERY]: read(readCalendarSeriesChild),
    [CALENDAR_SERIES_CHILDREN_QUERY]: read(queryCalendarSeriesChildren),
    [CALENDAR_SERIES_CHILD_BUSY_QUERY]: read(queryCalendarSeriesChildBusy),
    [CALENDAR_SERIES_CHILD_MANAGE_TARGET_QUERY]: read(readCalendarSeriesChildManageTarget),
    [CALENDAR_SERIES_CHILD_PARTICIPANTS_QUERY]: read(readCalendarSeriesChildParticipants),
  },
});
