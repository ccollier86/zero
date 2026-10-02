/** Shared persistence records for the graph workflow stores. */

import type { WorkflowGraphIR } from './workflow-ir';

export interface CreateGraphInstanceInput {
  instanceId: string;
  definitionId: string;
  definitionVersionId: string;
  definitionVersion: number;
  name: string;
  graph: WorkflowGraphIR;
  graphJson: string;
  graphFingerprint: string;
  inputJson: string | null;
  tenantId: string | null;
  startedBy: string | null;
  now: string;
}

export interface WorkflowGraphDecisionRecord {
  decision_id: string;
  instance_id: string;
  node_id: string;
  activation_key: string;
  selected_edge_id: string | null;
  selected_branch: string | null;
  decision_json: string | null;
  created_at: string;
}

export interface WorkflowGraphEdgeRecord {
  edge_id: string;
  instance_id: string;
  from_node_id: string | null;
  to_node_id: string;
  edge_kind: string;
  branch_key: string | null;
  condition_json: string | null;
  ordinal: number;
  created_at: string;
}

export interface WorkflowEachItemRecord {
  item_id: string;
  instance_id: string;
  parent_step_id: string | null;
  node_id: string;
  activation_key: string;
  item_key: string;
  item_index: number;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped' | 'cancelled';
  input_json: string;
  output_json: string | null;
  error: string | null;
  attempts: number;
  max_attempts: number;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
}

/** Raw public/private interaction envelope used only for fail-closed recovery checks. */
export interface WorkflowPersistedInteractionRecord {
  interaction_id: string;
  tenant_id: string | null;
  instance_id: string;
  node_id: string;
  step_id: string | null;
  safe_label: string;
  status: string;
  opened_at: string;
  expires_at: string | null;
  accepted_at: string | null;
  accepted_by: string | null;
  rejection_count: number;
  max_rejections: number;
  created_at: string;
  updated_at: string;
  detail_interaction_id: string | null;
  responder_policy_json: string | null;
  response_schema_json: string | null;
  request_json: string | null;
  validator_activity_id: string | null;
  accepted_response_id: string | null;
  response_count: number | null;
  response_bytes: number | null;
  detail_created_at: string | null;
  detail_updated_at: string | null;
}

/** Raw private response row paired with its owning instance for integrity validation. */
export interface WorkflowPersistedInteractionResponseRecord {
  response_id: string;
  interaction_id: string;
  submission_id: string;
  actor_id: string | null;
  channel: string | null;
  origin: 'external' | 'event' | string;
  event_id: string | null;
  /** Parent instance of event_id; null when absent or dangling. */
  event_instance_id: string | null;
  payload_hash: string;
  payload_json: string;
  accepted_value_json: string | null;
  status: string;
  rejection_code: string | null;
  public_message: string | null;
  created_at: string;
  decided_at: string | null;
}
