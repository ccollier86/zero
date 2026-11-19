/** Internal adjacent-service admission contract. Not a request/client API and intentionally absent from public barrels. */
import type { WorkflowSystemStartResult } from './workflow-system-start-contract';
import type { WorkflowInstanceRecord } from './types';
export interface WorkflowPinnedStart {
  readonly name: string; readonly version: number; readonly definitionId: string; readonly versionId: string; readonly fingerprint: string;
}
/** Native code-catalog invalidation only. No scoped persisted selection, input
 * admission, execution authority or permission to enqueue is implied. */
export interface WorkflowRegisteredCatalogStamp {
  readonly name: string; readonly version: number; readonly format: 'flow' | 'graph';
  readonly schemaVersion: number; readonly fingerprint: string;
}
export interface WorkflowDeferredStartInspection {
  readonly receipt: WorkflowSystemStartResult;
  readonly status: WorkflowInstanceRecord['status'];
}
