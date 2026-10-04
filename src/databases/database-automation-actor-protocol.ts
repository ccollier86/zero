/** Internal private actor protocol for durable database-automation delivery. */

export {
  DATABASE_ACTOR_AUTOMATION_OUTBOX_OPERATION,
  type DatabaseActorAutomationOutboxAction,
  type DatabaseActorAutomationOutboxClaimPayload,
  type DatabaseActorAutomationOutboxCompletePayload,
  type DatabaseActorAutomationOutboxCountsPayload,
  type DatabaseActorAutomationOutboxDeadPayload,
  type DatabaseActorAutomationOutboxPayload,
  type DatabaseActorAutomationOutboxRecoverExpiredPayload,
  type DatabaseActorAutomationOutboxRenewPayload,
  type DatabaseActorAutomationOutboxResult,
  type DatabaseActorAutomationOutboxResultFor,
  type DatabaseActorAutomationOutboxRetryPayload,
} from './database-automation-actor-protocol-contracts';
export {
  validateDatabaseActorAutomationOutboxPayload,
} from './database-automation-actor-protocol-payload';
export {
  validateDatabaseActorAutomationOutboxResult,
} from './database-automation-actor-protocol-result';
