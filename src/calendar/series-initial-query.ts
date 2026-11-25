/** Original-human intent reconciliation; no Temporal, fresh source policy,
 * participant admission, mutation, provisioning or provider call. */
import type { DatabaseReadQueryContext } from '../databases/database-realm';
import type { Row } from '../sync/types';
import { calendarActor } from './realm-model';
import { normalizeCalendarInitialSeriesRequestFacts } from './series-source-admission';
import { readCalendarSeriesPlan, type CalendarSeriesPlanStatus } from './series-read-model';
import { calendarHash, calendarKey, calendarRecord } from './validation';
import { CalendarError } from './error';

export function readCalendarInitialSeriesReceipt(context: DatabaseReadQueryContext, input: unknown): CalendarSeriesPlanStatus | null {
  const r = calendarRecord(input, ['actor', 'ownerId', 'request']), actor = calendarActor(r.actor), ownerId = calendarKey(r.ownerId);
  const request = normalizeCalendarInitialSeriesRequestFacts(r.request);
  if (!actor.manageAll || actor.scopeId !== request.scopeId || actor.userId !== request.userId || actor.principal !== request.principal) throw new CalendarError('CALENDAR_FORBIDDEN');
  const owner = context.database.query<Row>("SELECT * FROM _calendar_owner WHERE id='application'").get();
  if (!owner || owner.scope_id !== actor.scopeId || owner.owner_id !== ownerId) throw new CalendarError('CALENDAR_STATE_INVALID');
  const receipt = context.database.query<Row>('SELECT * FROM _calendar_series_receipts WHERE scope_id=? AND id=? LIMIT 1')
    .get(actor.scopeId, calendarHash([actor.scopeId, actor.principal, request.requestId]));
  if (!receipt) return null;
  if (receipt.principal !== request.principal || receipt.request_id !== request.requestId || receipt.series_id !== request.seriesId || receipt.digest !== request.digest) {
    throw new CalendarError('CALENDAR_INTENT_CONFLICT');
  }
  return readCalendarSeriesPlan(context, { actor, requestId: request.requestId });
}
