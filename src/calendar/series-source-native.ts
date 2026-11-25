/** Actual actor entry for a signed real-human initial source acceptance.
 * SYSTEM participant/Guardian checks stay in the parent and durable COMMIT
 * revision fence; this module never synthesizes an account/session/actor. */
import type { DatabaseWriteCommandContext } from '../databases/database-realm';
import { cloneDatabaseSerializableValue } from '../databases/database-operations';
import { stableStringify } from '../migrations/schema-snapshot';
import type { CalendarOwnerRecord } from './owner-schema';
import { createCalendarInitialSeriesSourceAdmission, normalizeCalendarInitialSeriesRequestFacts,
  type CalendarInitialSeriesCompilationFrame } from './series-source-admission';
import { verifyCalendarInitialSeriesNativeEnvelope } from './series-native-transport';
import { CalendarError, calendarCommand } from './error';
import { calendarInteger, calendarRecord } from './validation';

export function acceptCalendarInitialSeriesNativeSource(context: DatabaseWriteCommandContext, input: unknown) {
  return calendarCommand(() => {
    const envelope = verifyCalendarInitialSeriesNativeEnvelope(context.writerPolicy, input);
    const body = calendarRecord(cloneDatabaseSerializableValue(envelope.payload), ['kind', 'frame', 'owner', 'preparationTtlMs', 'policyGeneration']);
    if (body.kind !== 'calendar-series-initial-source-v1' || body.policyGeneration !== envelope.source.policyGeneration) throw new CalendarError('CALENDAR_FORBIDDEN');
    const frame = calendarRecord(body.frame, ['request', 'interval', 'engineGeneration']);
    const request = normalizeCalendarInitialSeriesRequestFacts(frame.request);
    const owner = calendarRecord(body.owner, ['id', 'scope_id', 'owner_id', 'root_hash', 'realm_fingerprint', 'established']) as unknown as CalendarOwnerRecord;
    if (request.scopeId !== envelope.source.scopeId || request.requestId !== envelope.logicalKey || owner.scope_id !== request.scopeId
      || owner.owner_id !== envelope.source.ownerId || owner.root_hash !== envelope.source.rootHash || owner.realm_fingerprint !== envelope.source.realmFingerprint
      || owner.established !== 1) throw new CalendarError('CALENDAR_FORBIDDEN');
    const guard = () => {
      // The native handler's final seal check repeats deadline/bind validation;
      // the actual parent+actor Guardian revision fence is independent of this.
      verifyCalendarInitialSeriesNativeEnvelope(context.writerPolicy, input);
      const physical = context.db.get('_calendar_owner', 'application');
      if (!physical || physical.owner_id !== owner.owner_id || physical.scope_id !== request.scopeId) throw new CalendarError('CALENDAR_STATE_INVALID');
    };
    const admitted = createCalendarInitialSeriesSourceAdmission({ owner, policyGeneration: envelope.source.policyGeneration,
      preparationTtlMs: calendarInteger(body.preparationTtlMs, 1000, 86_400_000), maximumResources: 16, maximumParticipants: 100,
      guard,
      compilation() {
        if (stableStringify((frame as unknown as CalendarInitialSeriesCompilationFrame).request) !== stableStringify(request)) throw new CalendarError('CALENDAR_FORBIDDEN');
        return frame as unknown as CalendarInitialSeriesCompilationFrame;
      },
    }, request);
    const result = admitted.run(context); admitted.assertCommitCurrent(); return result;
  });
}
