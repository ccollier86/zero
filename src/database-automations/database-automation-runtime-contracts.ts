/** Shared actor-local contracts for ReactiveDB automation execution. */

import type {
  DatabaseFunctionInvocation,
} from './database-function';
import type { DatabaseTriggerFunctionInput } from './database-trigger-input';

/** Durable work captured atomically by a source-database outbox. */
export interface DatabaseDurableAutomationEnqueueInput {
  /** Stable idempotency identity retained across every delivery attempt. */
  readonly deliveryId: string;
  /** Exact function invocation and source-trigger correlation. */
  readonly invocation: DatabaseFunctionInvocation;
  /** Handler-free registry identity admitted with this database realm. */
  readonly automationFingerprint: string;
  /** Canonical source change supplied to the durable function. */
  readonly input: DatabaseTriggerFunctionInput;
  /** Time at which the work became eligible for dispatch. */
  readonly availableAt: number;
}

/** Synchronous source-local sink; implementations must join the current commit. */
export interface DatabaseDurableAutomationSink {
  enqueue(input: DatabaseDurableAutomationEnqueueInput): void;
}

/** Aggregate-only signal safe to return across a Fabric actor boundary. */
export interface DatabaseAutomationPendingSignal {
  readonly pending: boolean;
  readonly enqueued: number;
}
