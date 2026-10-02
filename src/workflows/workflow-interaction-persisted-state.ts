/**
 * workflow-interaction-persisted-state.ts
 *
 * Validates graph interaction envelopes against pinned wait nodes and their
 * public steps. It is a pure recovery guard and never authorizes or mutates.
 */

import { encodeWorkflowActivityReference } from './workflow-activity-reference-codec';
import type {
  WorkflowPersistedInteractionRecord,
  WorkflowPersistedInteractionResponseRecord,
} from './workflow-graph-store';
import type { WorkflowGraphIR, WorkflowWaitNode } from './workflow-ir';
import {
  validateWorkflowInteractionResponses,
  type WorkflowInteractionResponseIntegritySummary,
} from './workflow-interaction-response-integrity';
import { validatePersistedInteractionSchema } from './workflow-interaction-schema';
import {
  MAX_WORKFLOW_INTERACTION_RESPONSE_BYTES,
  MAX_WORKFLOW_INTERACTION_SUBMISSIONS,
} from './workflow-interaction-store';
import { serializeWorkflowJson } from './workflow-json-value';
import {
  assertPersistedWorkflowString,
  canonicalPersistedWorkflowJson,
  parsePersistedWorkflowJson,
  persistedStateInvalid,
  persistedWorkflowTimestamp,
} from './workflow-persisted-state-values';
import type { WorkflowInstanceRecord, WorkflowStepRecord } from './types';

const INTERACTION_STATUSES = new Set([
  'open', 'accepted', 'expired', 'cancelled', 'rejection_limit',
]);

/** Validate all public/private graph interaction rows in one coherent snapshot. */
export function validateWorkflowInteractionPersistedState(input: {
  instance: WorkflowInstanceRecord;
  graph: WorkflowGraphIR;
  steps: readonly WorkflowStepRecord[];
  interactions: readonly WorkflowPersistedInteractionRecord[];
  responses: readonly WorkflowPersistedInteractionResponseRecord[];
}): void {
  const roots = new Map(input.steps
    .filter((step) => step.parent_step_id === null && typeof step.node_id === 'string')
    .map((step) => [step.node_id!, step]));
  const interactionsByStep = groupBy(input.interactions, (row) => row.step_id ?? '');
  const responsesByInteraction = groupBy(input.responses, (row) => row.interaction_id);
  const accountedInteractions = new Set<string>();
  const knownInteractionIds = new Set(input.interactions.map((row) => row.interaction_id));

  for (const node of input.graph.nodes) {
    if (node.kind !== 'wait' || !node.interaction) continue;
    const parent = roots.get(node.id);
    if (!parent) persistedStateInvalid(`interaction wait "${node.id}" has no root step`);
    const matches = interactionsByStep.get(parent.step_id) ?? [];
    if (parent.status === 'pending' || parent.status === 'skipped') {
      if (matches.length !== 0) {
        persistedStateInvalid(`interaction wait "${node.id}" opened before execution`);
      }
      continue;
    }
    if ((parent.status !== 'waiting' && parent.status !== 'completed')
      || matches.length !== 1) {
      persistedStateInvalid(`interaction wait "${node.id}" has no unique envelope`);
    }
    const interaction = matches[0]!;
    if (accountedInteractions.has(interaction.interaction_id)) {
      persistedStateInvalid('workflow interaction is attached to multiple wait nodes');
    }
    accountedInteractions.add(interaction.interaction_id);
    validateInteractionEnvelope(
      input.instance,
      node,
      parent,
      interaction,
      responsesByInteraction.get(interaction.interaction_id) ?? [],
    );
  }

  if (accountedInteractions.size !== input.interactions.length
    || input.interactions.some((row) => row.step_id === null)) {
    persistedStateInvalid('workflow interactions contain a foreign or non-graph envelope');
  }
  if (input.responses.some((row) => !knownInteractionIds.has(row.interaction_id))) {
    persistedStateInvalid('workflow interaction response has no owning envelope');
  }
}

function validateInteractionEnvelope(
  instance: WorkflowInstanceRecord,
  node: WorkflowWaitNode,
  parent: WorkflowStepRecord,
  interaction: WorkflowPersistedInteractionRecord,
  responses: readonly WorkflowPersistedInteractionResponseRecord[],
): void {
  validateInteractionIdentity(instance, node, parent, interaction);
  validateInteractionDefinition(node, parent, interaction);
  const summary = validateWorkflowInteractionResponses(
    interaction.interaction_id,
    interaction.opened_at,
    responses,
  );
  validateInteractionLifecycle(node, parent, interaction, summary);
}

function validateInteractionIdentity(
  instance: WorkflowInstanceRecord,
  node: WorkflowWaitNode,
  parent: WorkflowStepRecord,
  interaction: WorkflowPersistedInteractionRecord,
): void {
  assertPersistedWorkflowString(interaction.interaction_id, 'workflow interaction id', 512);
  assertPersistedWorkflowString(interaction.safe_label, 'workflow interaction label', 240);
  if (interaction.instance_id !== instance.instance_id
    || interaction.node_id !== node.id
    || interaction.step_id !== parent.step_id
    || interaction.safe_label !== (node.label ?? node.id)
    || interaction.detail_interaction_id !== interaction.interaction_id) {
    persistedStateInvalid(`interaction wait "${node.id}" identity is invalid`);
  }
  if (!INTERACTION_STATUSES.has(interaction.status)) {
    persistedStateInvalid(`interaction wait "${node.id}" status is invalid`);
  }
  const opened = persistedWorkflowTimestamp(
    interaction.opened_at,
    `interaction wait "${node.id}" opened_at`,
  )!;
  const created = persistedWorkflowTimestamp(
    interaction.created_at,
    `interaction wait "${node.id}" created_at`,
  )!;
  const updated = persistedWorkflowTimestamp(
    interaction.updated_at,
    `interaction wait "${node.id}" updated_at`,
  )!;
  const detailCreated = persistedWorkflowTimestamp(
    interaction.detail_created_at,
    `interaction wait "${node.id}" detail created_at`,
  )!;
  const detailUpdated = persistedWorkflowTimestamp(
    interaction.detail_updated_at,
    `interaction wait "${node.id}" detail updated_at`,
  )!;
  if (opened !== created || opened !== detailCreated
    || updated < opened || detailUpdated < detailCreated
    || parent.started_at !== interaction.opened_at) {
    persistedStateInvalid(`interaction wait "${node.id}" timestamps are incoherent`);
  }
}

function validateInteractionDefinition(
  node: WorkflowWaitNode,
  parent: WorkflowStepRecord,
  interaction: WorkflowPersistedInteractionRecord,
): void {
  const expectedPolicy = serializeWorkflowJson({ type: 'starter' });
  const expectedSchema = serializeWorkflowJson(node.inputSchema ?? null);
  const expectedValidator = node.interaction?.validator
    ? encodeWorkflowActivityReference(node.interaction.validator)
    : null;
  if (canonicalPersistedWorkflowJson(
    interaction.responder_policy_json,
    `interaction wait "${node.id}" responder policy`,
  ) !== expectedPolicy
    || canonicalPersistedWorkflowJson(
      interaction.response_schema_json,
      `interaction wait "${node.id}" response schema`,
    ) !== expectedSchema
    || interaction.validator_activity_id !== expectedValidator
    || interaction.request_json === null
    || parent.input === null
    || canonicalPersistedWorkflowJson(
      interaction.request_json,
      `interaction wait "${node.id}" request`,
    ) !== canonicalPersistedWorkflowJson(
      parent.input,
      `interaction wait "${node.id}" step input`,
    )) {
    persistedStateInvalid(`interaction wait "${node.id}" definition snapshot is invalid`);
  }
}

function validateInteractionLifecycle(
  node: WorkflowWaitNode,
  parent: WorkflowStepRecord,
  interaction: WorkflowPersistedInteractionRecord,
  summary: WorkflowInteractionResponseIntegritySummary,
): void {
  if (!Number.isSafeInteger(interaction.rejection_count)
    || !Number.isSafeInteger(interaction.max_rejections)
    || !Number.isSafeInteger(interaction.response_count)
    || !Number.isSafeInteger(interaction.response_bytes)
    || interaction.rejection_count < 0
    || interaction.response_count! < 0
    || interaction.response_bytes! < 0
    || interaction.max_rejections !== (node.interaction?.maxRejections ?? 10)
    || interaction.rejection_count !== summary.rejectionCount
    || interaction.response_count !== summary.responseCount
    || interaction.response_bytes !== summary.responseBytes
    || interaction.response_count! > MAX_WORKFLOW_INTERACTION_SUBMISSIONS
    || interaction.response_bytes! > MAX_WORKFLOW_INTERACTION_RESPONSE_BYTES
    || interaction.rejection_count > interaction.max_rejections) {
    persistedStateInvalid(`interaction wait "${node.id}" counters are invalid`);
  }
  if (summary.latestCreatedAt !== null
    && interaction.detail_updated_at! < summary.latestCreatedAt) {
    persistedStateInvalid(`interaction wait "${node.id}" detail timestamp is stale`);
  }
  validateExpiry(node, parent, interaction);

  if (interaction.status === 'accepted') {
    validateAcceptedInteraction(node, parent, interaction, summary);
    return;
  }
  if (interaction.status === 'cancelled') {
    persistedStateInvalid(`interaction wait "${node.id}" is cancelled on an active run`);
  }
  if (summary.accepted || summary.acceptedValue !== null
    || interaction.accepted_response_id !== null
    || interaction.accepted_at !== null
    || interaction.accepted_by !== null
    || parent.status === 'completed') {
    persistedStateInvalid(`interaction wait "${node.id}" non-accepted state is incoherent`);
  }
  if ((interaction.status === 'open'
      && interaction.rejection_count >= interaction.max_rejections)
    || (interaction.status === 'rejection_limit'
      && (interaction.rejection_count !== interaction.max_rejections
        || summary.latestRejectionAt === null
        || interaction.updated_at !== summary.latestRejectionAt))) {
    persistedStateInvalid(`interaction wait "${node.id}" terminal counter is incoherent`);
  }
  if (interaction.status === 'expired'
    && (interaction.expires_at === null || interaction.updated_at < interaction.expires_at)) {
    persistedStateInvalid(`interaction wait "${node.id}" expiry lifecycle is incoherent`);
  }
  if (interaction.status === 'open') {
    const expectedUpdated = summary.latestRejectionAt ?? interaction.opened_at;
    const shiftedTimedWait = node.timeoutMs !== undefined
      && interaction.updated_at >= expectedUpdated
      && interaction.expires_at !== null
      && interaction.updated_at < interaction.expires_at;
    if (interaction.updated_at !== expectedUpdated && !shiftedTimedWait) {
      persistedStateInvalid(`interaction wait "${node.id}" open timestamp is incoherent`);
    }
  } else if (summary.latestRejectionAt && interaction.updated_at < summary.latestRejectionAt) {
    persistedStateInvalid(`interaction wait "${node.id}" closed before its rejection`);
  }
}

function validateAcceptedInteraction(
  node: WorkflowWaitNode,
  parent: WorkflowStepRecord,
  interaction: WorkflowPersistedInteractionRecord,
  summary: WorkflowInteractionResponseIntegritySummary,
): void {
  const accepted = summary.accepted;
  if (!accepted || summary.acceptedValue === null
    || interaction.accepted_response_id !== accepted.response_id
    || interaction.accepted_at !== accepted.decided_at
    || interaction.accepted_by !== accepted.actor_id
    || interaction.updated_at !== interaction.accepted_at
    || interaction.detail_updated_at !== interaction.accepted_at
    || interaction.rejection_count >= interaction.max_rejections) {
    persistedStateInvalid(`interaction wait "${node.id}" accepted linkage is invalid`);
  }
  const payload = parsePersistedWorkflowJson(
    accepted.payload_json,
    `interaction wait "${node.id}" accepted payload`,
  );
  if (node.inputSchema !== undefined) {
    try {
      if (!validatePersistedInteractionSchema(node.inputSchema, payload)) {
        persistedStateInvalid(`interaction wait "${node.id}" accepted an invalid payload`);
      }
    } catch {
      persistedStateInvalid(`interaction wait "${node.id}" response schema is invalid`);
    }
  }
  if (parent.status === 'completed') {
    if (parent.output === null
      || canonicalPersistedWorkflowJson(
        parent.output,
        `interaction wait "${node.id}" output`,
      ) !== summary.acceptedValue
      || parent.completed_at === null
      || parent.completed_at < interaction.accepted_at!) {
      persistedStateInvalid(`interaction wait "${node.id}" completion is incoherent`);
    }
  }
}

function validateExpiry(
  node: WorkflowWaitNode,
  parent: WorkflowStepRecord,
  interaction: WorkflowPersistedInteractionRecord,
): void {
  const expires = persistedWorkflowTimestamp(
    interaction.expires_at,
    `interaction wait "${node.id}" expires_at`,
    true,
  );
  if (node.timeoutMs === undefined) {
    if (expires !== null) persistedStateInvalid(`interaction wait "${node.id}" has extra expiry`);
  } else {
    const opened = persistedWorkflowTimestamp(
      interaction.opened_at,
      `interaction wait "${node.id}" opened_at`,
    )!;
    if (expires === null || expires < opened + node.timeoutMs) {
      persistedStateInvalid(`interaction wait "${node.id}" expiry is invalid`);
    }
  }
  if ((parent.status === 'waiting' && parent.timeout_at !== interaction.expires_at)
    || (parent.status === 'completed' && parent.timeout_at !== null)) {
    persistedStateInvalid(`interaction wait "${node.id}" step deadline is incoherent`);
  }
}

function groupBy<T>(values: readonly T[], key: (value: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const value of values) {
    const groupKey = key(value);
    const group = groups.get(groupKey) ?? [];
    group.push(value);
    groups.set(groupKey, group);
  }
  return groups;
}
