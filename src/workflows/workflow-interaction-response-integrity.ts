/**
 * workflow-interaction-response-integrity.ts
 *
 * Validates private interaction submissions and derives their durable outcome
 * summary. It consumes persisted rows only and performs no authorization or I/O.
 */

import { createHash } from 'node:crypto';
import type {
  WorkflowPersistedInteractionResponseRecord,
} from './workflow-graph-store';
import {
  assertPersistedWorkflowString,
  canonicalPersistedWorkflowJson,
  persistedStateInvalid,
  persistedWorkflowTimestamp,
} from './workflow-persisted-state-values';
import { workflowJsonBytes } from './workflow-json-value';

const RESPONSE_STATUSES = new Set(['processing', 'rejected', 'accepted', 'superseded']);

export interface WorkflowInteractionResponseIntegritySummary {
  accepted: WorkflowPersistedInteractionResponseRecord | null;
  acceptedValue: string | null;
  rejectionCount: number;
  latestRejectionAt: string | null;
  responseCount: number;
  responseBytes: number;
  latestCreatedAt: string | null;
}

/** Validate every response owned by one interaction and summarize its outcomes. */
export function validateWorkflowInteractionResponses(
  interactionId: string,
  openedAt: string,
  rows: readonly WorkflowPersistedInteractionResponseRecord[],
): WorkflowInteractionResponseIntegritySummary {
  const responseIds = new Set<string>();
  const submissionIds = new Set<string>();
  let accepted: WorkflowPersistedInteractionResponseRecord | null = null;
  let acceptedValue: string | null = null;
  let rejectionCount = 0;
  let latestRejectionAt: string | null = null;
  let responseBytes = 0;
  let latestCreatedAt: string | null = null;
  const opened = persistedWorkflowTimestamp(openedAt, 'interaction opened_at')!;

  for (const row of rows) {
    validateIdentity(row, interactionId, responseIds, submissionIds);
    const created = persistedWorkflowTimestamp(row.created_at, 'interaction response created_at')!;
    if (created < opened) persistedStateInvalid('interaction response predates its interaction');
    if (!latestCreatedAt || row.created_at > latestCreatedAt) latestCreatedAt = row.created_at;
    const decided = persistedWorkflowTimestamp(
      row.decided_at,
      'interaction response decided_at',
      true,
    );
    if (decided !== null && decided < created) {
      persistedStateInvalid('interaction response decision predates submission');
    }
    canonicalPersistedWorkflowJson(
      row.payload_json,
      'interaction response payload',
    );
    responseBytes += workflowJsonBytes(row.payload_json);
    const expectedHash = createHash('sha256').update(row.payload_json).digest('hex');
    if (!/^[a-f0-9]{64}$/u.test(row.payload_hash) || row.payload_hash !== expectedHash) {
      persistedStateInvalid('interaction response payload hash is invalid');
    }
    if (!RESPONSE_STATUSES.has(row.status)) {
      persistedStateInvalid('interaction response status is invalid');
    }

    if (row.status === 'processing') {
      if (decided !== null || row.accepted_value_json !== null
        || row.rejection_code !== null || row.public_message !== null) {
        persistedStateInvalid('processing interaction response contains a decision');
      }
      continue;
    }
    if (decided === null) persistedStateInvalid('decided interaction response has no timestamp');

    if (row.status === 'accepted') {
      if (accepted || row.accepted_value_json === null
        || row.rejection_code !== null || row.public_message !== null) {
        persistedStateInvalid('accepted interaction response is incoherent');
      }
      acceptedValue = canonicalPersistedWorkflowJson(
        row.accepted_value_json,
        'accepted interaction value',
      );
      responseBytes += workflowJsonBytes(row.accepted_value_json);
      accepted = row;
      continue;
    }
    if (row.accepted_value_json !== null) {
      persistedStateInvalid('unaccepted interaction response contains an accepted value');
    }
    if (row.status === 'rejected') {
      assertPersistedWorkflowString(row.rejection_code, 'interaction rejection code', 64);
      if (!/^[a-z][a-z0-9_.-]{0,63}$/iu.test(row.rejection_code!)) {
        persistedStateInvalid('interaction rejection code is invalid');
      }
      assertPersistedWorkflowString(row.public_message, 'interaction public message', 280);
      rejectionCount += 1;
      if (!latestRejectionAt || row.decided_at! > latestRejectionAt) {
        latestRejectionAt = row.decided_at;
      }
      continue;
    }
    if (row.rejection_code !== null || row.public_message !== null) {
      persistedStateInvalid('superseded interaction response contains rejection data');
    }
  }

  return {
    accepted,
    acceptedValue,
    rejectionCount,
    latestRejectionAt,
    responseCount: rows.length,
    responseBytes,
    latestCreatedAt,
  };
}

function validateIdentity(
  row: WorkflowPersistedInteractionResponseRecord,
  interactionId: string,
  responseIds: Set<string>,
  submissionIds: Set<string>,
): void {
  assertPersistedWorkflowString(row.response_id, 'interaction response id', 512);
  assertPersistedWorkflowString(row.submission_id, 'interaction submission id', 512);
  assertPersistedWorkflowString(row.actor_id, 'interaction response actor', 512);
  if (row.channel !== null) {
    assertPersistedWorkflowString(row.channel, 'interaction response channel', 64);
  }
  if (row.interaction_id !== interactionId
    || responseIds.has(row.response_id)
    || submissionIds.has(row.submission_id)) {
    persistedStateInvalid('interaction response identity is invalid or duplicated');
  }
  responseIds.add(row.response_id);
  submissionIds.add(row.submission_id);
}
