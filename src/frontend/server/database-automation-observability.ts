/** Low-cardinality observability projection for durable database functions. */

import type { DatabaseAutomationSourceRecord } from '../../database-automations/automation-source-catalog-contract';
import type { DatabaseAutomationDeliveryEvent } from '../../database-automations/database-automation-delivery-contracts';
import {
  OBS_CODES,
  emitPlatformCodeTo,
} from '../../observability';
import type { PlatformObservabilityRuntime } from '../../observability/types';

export function emitDatabaseAutomationDeliveryEvent(
  observability: PlatformObservabilityRuntime,
  source: DatabaseAutomationSourceRecord,
  event: DatabaseAutomationDeliveryEvent,
): void {
  const sourceMetadata = { sourceKind: source.sourceKind };
  switch (event.type) {
    case 'recovered':
      emitPlatformCodeTo(
        observability,
        OBS_CODES.DATABASE_AUTOMATION_DELIVERY_RECOVERED,
        { metadata: { ...sourceMetadata, requeued: event.requeued, dead: event.dead } },
      );
      return;
    case 'claimed':
      emitPlatformCodeTo(
        observability,
        OBS_CODES.DATABASE_AUTOMATION_DELIVERY_CLAIMED,
        { metadata: { ...sourceMetadata, attempt: event.attempt } },
      );
      return;
    case 'completed':
      emitPlatformCodeTo(
        observability,
        OBS_CODES.DATABASE_AUTOMATION_DELIVERY_COMPLETED,
        { metadata: { ...sourceMetadata, attempt: event.attempt } },
      );
      return;
    case 'retry-scheduled':
      emitPlatformCodeTo(
        observability,
        OBS_CODES.DATABASE_AUTOMATION_DELIVERY_RETRY_SCHEDULED,
        { metadata: { ...sourceMetadata, attempt: event.attempt } },
      );
      return;
    case 'dead-lettered':
      emitPlatformCodeTo(
        observability,
        OBS_CODES.DATABASE_AUTOMATION_DELIVERY_DEAD_LETTERED,
        {
          metadata: {
            ...sourceMetadata,
            attempt: event.attempt,
            reason: event.reason,
          },
        },
      );
      return;
    case 'lease-lost':
      emitPlatformCodeTo(
        observability,
        OBS_CODES.DATABASE_AUTOMATION_DELIVERY_LEASE_LOST,
        { metadata: { ...sourceMetadata, attempt: event.attempt } },
      );
      return;
    case 'manifest-drift':
      emitPlatformCodeTo(
        observability,
        OBS_CODES.DATABASE_AUTOMATION_MANIFEST_DRIFT,
        { metadata: { ...sourceMetadata, attempt: event.attempt } },
      );
      return;
    case 'execution-abandoned':
      emitPlatformCodeTo(
        observability,
        OBS_CODES.DATABASE_AUTOMATION_EXECUTION_ABANDONED,
        {
          metadata: {
            ...sourceMetadata,
            attempt: event.attempt,
            reason: event.reason,
          },
        },
      );
      return;
    case 'service-cleanup-failed':
      emitPlatformCodeTo(
        observability,
        OBS_CODES.DATABASE_AUTOMATION_SERVICE_CLEANUP_FAILED,
        { metadata: { ...sourceMetadata, attempt: event.attempt } },
      );
  }
}
