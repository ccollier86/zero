/** Internal adjacent-service admission contract. Not a request/client API and intentionally absent from public barrels. */
import type { WorkflowSystemStartResult } from './workflow-system-start-contract';
import type { WorkflowInstanceRecord } from './types';
export interface WorkflowPinnedStart {
  readonly name: string; readonly version: number; readonly definitionId: string; readonly versionId: string; readonly fingerprint: string;
}
export interface WorkflowDeferredStartInspection {
  readonly receipt: WorkflowSystemStartResult;
  readonly status: WorkflowInstanceRecord['status'];
}
