/** Recovery-only reads joining public interactions to private details. */

import type { ReactiveDB } from '../sync/reactive-db';
import type {
  WorkflowPersistedInteractionRecord,
  WorkflowPersistedInteractionResponseRecord,
} from './workflow-graph-records';

/** Read interaction envelopes used by fail-closed graph recovery validation. */
export class WorkflowGraphInteractionReader {
  constructor(private readonly db: ReactiveDB) {}

  list(instanceId: string): WorkflowPersistedInteractionRecord[] {
    return this.db.prepare(`
      SELECT interaction.*,
        detail.interaction_id AS detail_interaction_id,
        detail.responder_policy_json,
        detail.response_schema_json,
        detail.request_json,
        detail.validator_activity_id,
        detail.accepted_response_id,
        detail.response_count,
        detail.response_bytes,
        detail.created_at AS detail_created_at,
        detail.updated_at AS detail_updated_at
      FROM workflow_interactions AS interaction
      LEFT JOIN _workflow_interaction_details AS detail
        ON detail.interaction_id = interaction.interaction_id
      WHERE interaction.instance_id = ?
      ORDER BY interaction.opened_at ASC, interaction.rowid ASC
    `).all(instanceId) as WorkflowPersistedInteractionRecord[];
  }

  listResponses(instanceId: string): WorkflowPersistedInteractionResponseRecord[] {
    return this.db.prepare(`
      SELECT response.*, event.instance_id AS event_instance_id
      FROM _workflow_interaction_responses AS response
      INNER JOIN workflow_interactions AS interaction
        ON interaction.interaction_id = response.interaction_id
      LEFT JOIN workflow_events AS event ON event.event_id = response.event_id
      WHERE interaction.instance_id = ?
      ORDER BY response.created_at ASC, response.rowid ASC
    `).all(instanceId) as WorkflowPersistedInteractionResponseRecord[];
  }
}
