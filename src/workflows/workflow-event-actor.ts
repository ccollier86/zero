/** Bounded private actor snapshots for durable workflow event delivery. */

import { WorkflowError } from './workflow-error';
import type { WorkflowInteractionActor } from './workflow-interaction-authority';

const MAX_ACTOR_SNAPSHOT_BYTES = 32 * 1024;

export function serializeWorkflowEventActor(
  actor: WorkflowInteractionActor | null | undefined,
): string | null {
  if (!actor) return null;
  if (typeof actor.actorId !== 'string' || !actor.actorId.trim()
    || actor.actorId !== actor.actorId.trim() || actor.actorId.length > 512) {
    throw invalidActor();
  }
  if (actor.tenantId !== undefined && actor.tenantId !== null
    && (typeof actor.tenantId !== 'string' || !actor.tenantId.trim()
      || actor.tenantId.length > 512)) throw invalidActor();
  if (actor.roles !== undefined && (!Array.isArray(actor.roles)
    || actor.roles.length > 100
    || actor.roles.some((role) => typeof role !== 'string'
      || !role.trim() || role !== role.trim() || role.length > 128))) throw invalidActor();
  if (actor.claims !== undefined
    && (!actor.claims || typeof actor.claims !== 'object' || Array.isArray(actor.claims))) {
    throw invalidActor();
  }
  let serialized: string;
  try {
    serialized = JSON.stringify({
      actorId: actor.actorId,
      ...(actor.tenantId === undefined ? {} : { tenantId: actor.tenantId }),
      ...(actor.roles === undefined ? {} : { roles: [...actor.roles] }),
      ...(actor.claims === undefined ? {} : { claims: actor.claims }),
    });
  } catch {
    throw invalidActor();
  }
  if (Buffer.byteLength(serialized, 'utf8') > MAX_ACTOR_SNAPSHOT_BYTES) throw invalidActor();
  return serialized;
}

export function parseWorkflowEventActor(value: string | null): WorkflowInteractionActor | null {
  if (value === null) return null;
  if (Buffer.byteLength(value, 'utf8') > MAX_ACTOR_SNAPSHOT_BYTES) throw invalidSnapshot();
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw invalidSnapshot();
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw invalidSnapshot();
  }
  try {
    const normalized = serializeWorkflowEventActor(parsed as WorkflowInteractionActor);
    if (normalized === null) throw invalidSnapshot();
    return JSON.parse(normalized) as WorkflowInteractionActor;
  } catch {
    throw invalidSnapshot();
  }
}

function invalidActor(): WorkflowError {
  return new WorkflowError(
    'Workflow event actor is invalid or exceeds its size limit',
    'WORKFLOW_EVENT_INVALID',
    422,
  );
}

function invalidSnapshot(): TypeError {
  return new TypeError('Workflow event actor snapshot is invalid');
}
