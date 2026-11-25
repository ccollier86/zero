/** Read-only native structured store shared by Calendar admission and review.
 * This is not a writer facade: only the three read operations can escape.
 */
import type { DatabaseReadQueryContext } from '../databases/database-read-query-capability';
import type { DatabaseWriteCommandCapability, DatabaseWriteCommandQuery } from '../databases/database-write-command-capability';
import type { DatabaseOperationCatalog, DatabaseFindInput, DatabaseFindRows, DatabaseOperationRow, DatabaseSerializableValue } from '../databases/database-operations';
import { cloneDatabaseSerializableValue, databaseOperationRecord } from '../databases/database-operation-payload';
import { validateDatabaseFindOperation } from '../databases/database-find-validation';
import { compileDatabaseFindFilter } from '../databases/database-find';
import { DatabaseError } from '../databases/database-error';
import { quoteSqlIdentifier } from '../sync/identity';
import type { Row, TableSchema } from '../sync/types';
import { calendarOverrideTables } from './realm-overrides-migration';
import { CALENDAR_SERIES_MATERIALIZATION_ADDITIONS, CALENDAR_SERIES_MATERIALIZATION_TABLES } from './realm-series-materialization-migration';
import { readCalendarSeriesOccupancy, type CalendarSeriesOccupancyInput, type CalendarSeriesOccupancyResult } from './series-occupancy';

export interface CalendarReadContext {
  readonly db: Pick<DatabaseWriteCommandCapability, 'get' | 'find' | 'hasTable'>;
  /** Actual registered command query bridge, never raw SQL or input callbacks. */
  readonly query?: DatabaseWriteCommandQuery;
  /** Read-only review adapter's fixed native query; not a generic SQL grant. */
  readonly seriesOccupancy?: (input: CalendarSeriesOccupancyInput) => CalendarSeriesOccupancyResult;
}

// Native declarations, not sqlite_schema or caller JSON, are the authority for
// readable identifiers. No import of the realm/command registry (and no cycle).
const profileState = CALENDAR_SERIES_MATERIALIZATION_TABLES.state;
// Admit only this known profile marker to structured reads. Series occupancy
// itself uses its fixed read-only query, not arbitrary access to 021 tables.
const declarations: Readonly<Record<string, TableSchema>> = { ...calendarOverrideTables(), [profileState]: CALENDAR_SERIES_MATERIALIZATION_ADDITIONS[profileState]! };
const tables = Object.freeze(Object.keys(declarations));
const columns = Object.freeze(Object.fromEntries(tables.map(table => [table, Object.freeze(Object.keys(declarations[table]!).filter(name => name !== '_identity'))])));
const catalog: DatabaseOperationCatalog = Object.freeze({ tables,
  columns, primaryKeys: Object.freeze(Object.fromEntries(tables.map(table => [table, 'id']))) });

function admittedTable(table: string): readonly string[] {
  if (typeof table !== 'string' || !Object.hasOwn(columns, table)) {
    throw new DatabaseError('DATABASE_OPERATION_UNSUPPORTED', 'Calendar read table is not registered.');
  }
  return columns[table]!;
}
function serializableRow(row: Row): DatabaseOperationRow {
  // SQLite values are not a canonical row merely because the native SELECT
  // returned them (for example a damaged TEXT cell may contain a BLOB).
  cloneDatabaseSerializableValue(row);
  const fields: Record<string, DatabaseSerializableValue> = Object.create(null);
  for (const [name, value] of Object.entries(row)) fields[name] = cloneDatabaseSerializableValue(value);
  return Object.freeze(fields);
}

/** Adapt an actual path-free native query capability. Statement lifetimes remain
 * owned by that query session; this object cannot write, expose SQL, or outlive it.
 */
export function createCalendarReadContext(context: DatabaseReadQueryContext): CalendarReadContext {
  const db = Object.create(null) as Pick<DatabaseWriteCommandCapability, 'get' | 'find' | 'hasTable'>;
  Object.defineProperties(db, {
    hasTable: { enumerable: true, value(table: string): boolean {
      admittedTable(table);
      return context.database.query('SELECT 1 FROM main.sqlite_schema WHERE type=\'table\' AND name=? LIMIT 1').get(table) !== null;
    } },
    get: { enumerable: true, value(table: string, id: string): Row | null {
      const selected = admittedTable(table);
      if (typeof id !== 'string') throw new DatabaseError('DATABASE_PAYLOAD_INVALID', 'Calendar read identity is invalid.');
      const row = context.database.query<Row>(`SELECT ${selected.map(quoteSqlIdentifier).join(', ')} FROM main.${quoteSqlIdentifier(table)} WHERE "id"=? LIMIT 1`).get(id);
      return row === null ? null : serializableRow(row);
    } },
    find: { enumerable: true, value(table: string, input: DatabaseFindInput): DatabaseFindRows {
      admittedTable(table);
      const fields = databaseOperationRecord(input);
      if (Object.keys(fields).some(key => !['select', 'filters', 'order', 'limit', 'offset'].includes(key))) {
        throw new DatabaseError('DATABASE_PAYLOAD_INVALID', 'Calendar read find fields are invalid.');
      }
      const operation = validateDatabaseFindOperation({ ...fields, type: 'find', table }, catalog);
      const filters = operation.filters?.map(compileDatabaseFindFilter) ?? [];
      const where = filters.length ? ` WHERE ${filters.map(filter => filter.sql).join(' AND ')}` : '';
      const submitted = operation.order ?? [];
      const order = submitted.some(entry => entry.field === 'id') ? submitted : [...submitted, { field: 'id', direction: 'asc' as const }];
      const ordering = order.map(entry => quoteSqlIdentifier(entry.field) + ' ' + entry.direction.toUpperCase()).join(', ');
      const sql = 'SELECT ' + (operation.select ?? columns[table]!).map(quoteSqlIdentifier).join(', ')
        + ' FROM main.' + quoteSqlIdentifier(table) + where + ' ORDER BY ' + ordering + ' LIMIT ? OFFSET ?';
      return Object.freeze(context.database.query<Row>(sql)
        .all(...filters.flatMap(filter => filter.params), operation.limit, operation.offset ?? 0).map(serializableRow));
    } },
  });
  return Object.freeze({ db: Object.freeze(db), seriesOccupancy: (input: CalendarSeriesOccupancyInput) => readCalendarSeriesOccupancy(context, input) });
}
