/** Closed private human-request namespace. A receipt identifies an outcome, never current access. */
import type { ReactiveDB } from '../sync/reactive-db';
import type { Row } from '../sync/types';
import { CalendarError } from './error';
import { calendarHash, calendarKey, calendarScope, calendarText } from './validation';

export const CALENDAR_HUMAN_RECEIPT_FAMILIES = Object.freeze([
  Object.freeze({ family: 'ordinary', table: '_calendar_receipts', operator: false }),
  Object.freeze({ family: 'block', table: '_calendar_block_receipts', operator: false }),
  Object.freeze({ family: 'hold', table: '_calendar_hold_receipts', operator: false }),
  Object.freeze({ family: 'location', table: '_calendar_location_receipts', operator: false }),
  Object.freeze({ family: 'type', table: '_calendar_type_receipts', operator: false }),
  Object.freeze({ family: 'lifecycle', table: '_calendar_lifecycle_receipts', operator: false }),
  Object.freeze({ family: 'operator', table: '_calendar_integration_operator_requests', operator: true }),
  Object.freeze({ family: 'series', table: '_calendar_series_receipts', operator: false }),
] as const);
export type CalendarHumanReceiptFamily = typeof CALENDAR_HUMAN_RECEIPT_FAMILIES[number]['family'];
export interface CalendarHumanKeyClaim {
  readonly family: CalendarHumanReceiptFamily;
  readonly table: typeof CALENDAR_HUMAN_RECEIPT_FAMILIES[number]['table'];
  readonly row: Readonly<Row>;
}
export function calendarHumanRequestId(scopeId: string, principal: string, requestId: string): string {
  return calendarHash([calendarScope(scopeId), calendarText(principal, 256), calendarKey(requestId)]);
}

/** At most eight indexed primary-key probes. Missing historical families stay inert;
 * native source receipts never occupy a human key. Call under the source transaction.
 * Callers still validate the owning family's intent and current target permissions.
 */
export function readCalendarHumanKeyClaim(db: Pick<ReactiveDB, 'hasTable' | 'get'>,
  scopeInput: string, principalInput: string, requestInput: string): CalendarHumanKeyClaim | null {
  const scopeId = calendarScope(scopeInput), principal = calendarText(principalInput, 256), requestId = calendarKey(requestInput);
  const ordinaryId = calendarHumanRequestId(scopeId, principal, requestId);
  let claim: CalendarHumanKeyClaim | null = null;
  for (const definition of CALENDAR_HUMAN_RECEIPT_FAMILIES) {
    if (!db.hasTable(definition.table)) continue;
    const id = definition.operator ? calendarHash(['calendar-operator-v1', scopeId, principal, requestId]) : ordinaryId;
    const row = db.get(definition.table, id);
    if (!row) continue;
    if (claim || row.id !== id || row.scope_id !== scopeId || row.principal !== principal || row.request_id !== requestId) {
      throw new CalendarError('CALENDAR_STATE_INVALID');
    }
    claim = Object.freeze({ family: definition.family, table: definition.table, row: Object.freeze({ ...row }) });
  }
  return claim;
}
