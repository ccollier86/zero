/**
 * Delivery-bound Torrent effects for durable ReactiveDB handlers. This adapter
 * derives stable effect identities and delegates durable receipts to Torrent;
 * it never selects a user identity or a different data scope.
 */

import type { ServiceDataScope } from '../../auth/service-data-scope';
import type { ClaimedDatabaseAutomationDelivery } from '../../database-automations/automation-outbox-contracts';
import { DatabaseError } from '../../databases/database-error';
import { WorkflowError } from '../../workflows/workflow-error';
import type { WorkflowStartOptions } from '../../workflows/workflow-start-options';
import type { WorkflowSystemStartResult } from '../../workflows/workflow-system-start-contract';
import type { WorkflowSystemEventDeliveryResult } from '../../workflows/workflow-system-event-delivery-contract';
import type { ServerRouteServices } from './server-services';

const TORRENT_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/u;

/** Scoped, permanently idempotent Torrent effects owned by one outbox delivery. */
export interface DatabaseAutomationTorrentService {
  /** Commit a retry-safe start receipt and return without joining AI/network activities. Prefer for short outbox handoffs. */
  enqueue(
    name: string,
    input?: unknown,
    options?: WorkflowStartOptions & Readonly<{ key?: string }>,
  ): Promise<WorkflowSystemStartResult>;
  /**
   * Start one run in the source scope. Repeating the same delivery/key returns
   * its original run; a changed command conflicts instead of creating a second.
   * Multiple intended starts in one handler require distinct keys.
   */
  start(
    name: string,
    input?: unknown,
    options?: WorkflowStartOptions & Readonly<{ key?: string }>,
  ): Promise<WorkflowSystemStartResult>;
  /**
   * Deliver an exact Torrent event. Zero derives permanent idempotency from
   * the outbox delivery plus the optional per-handler discriminator.
   */
  deliverEvent(
    instanceId: string,
    eventName: string,
    payload?: unknown,
    options?: Readonly<{ key?: string }>,
  ): Promise<WorkflowSystemEventDeliveryResult>;
  /** Commit a retry-safe event receipt without joining the resumed execution frontier. */
  enqueueEvent(
    instanceId: string,
    eventName: string,
    payload?: unknown,
    options?: Readonly<{ key?: string }>,
  ): Promise<WorkflowSystemEventDeliveryResult>;
}

/** @internal Compose one delivery's effects with mandatory live source fences. */
export function createDatabaseAutomationTorrentService(
  services: ServerRouteServices,
  scope: ServiceDataScope,
  delivery: ClaimedDatabaseAutomationDelivery,
  assertCurrentAuthority: () => void,
): DatabaseAutomationTorrentService {
  const requireWorkflows = () => {
    assertCurrentAuthority();
    const workflows = services.workflows;
    if (!workflows) {
      throw new DatabaseError(
        'DATABASE_OPERATION_UNSUPPORTED',
        'Torrent is unavailable to this database automation.',
        { retryable: true, outcome: 'not-started' },
      );
    }
    return workflows;
  };
  const assertWorkflowAuthority = (): void => {
    try {
      assertCurrentAuthority();
    } catch {
      throw new WorkflowError(
        'Database automation authority changed before Torrent effect commit',
        'WORKFLOW_AUTHORITY_CHANGED',
        409,
      );
    }
  };
  const start = (method: 'startAsSystemOnce' | 'enqueueAsSystemOnce'): DatabaseAutomationTorrentService['start'] =>
    async (name, input, options = {}) => {
      const workflows = requireWorkflows();
      const { key: discriminator, ...startOptions } = options;
      const key = normalizeTorrentKey(discriminator);
      const result = await workflows[method](name, input, {
        principal: 'reactivedb-automation',
        reason: 'ReactiveDB durable function workflow start',
        scope,
        idempotencyKey: torrentIdempotencyKey(delivery.deliveryId, key),
      }, startOptions, { assertCurrentAuthority: assertWorkflowAuthority });
      assertCurrentAuthority();
      return result;
    };
  const event = (method: 'deliverEventAsSystem' | 'enqueueEventAsSystem'): DatabaseAutomationTorrentService['deliverEvent'] =>
    async (instanceId, eventName, payload, options = {}) => {
      const workflows = requireWorkflows();
      const key = normalizeTorrentKey(options.key);
      const result = await workflows[method](
        instanceId,
        eventName,
        payload,
        {
          principal: 'reactivedb-automation',
          reason: 'ReactiveDB durable function event delivery',
          scope,
          idempotencyKey: torrentIdempotencyKey(delivery.deliveryId, key),
        },
        { assertCurrentAuthority: assertWorkflowAuthority },
      );
      assertCurrentAuthority();
      return result;
    };
  return Object.freeze({
    start: start('startAsSystemOnce'), enqueue: start('enqueueAsSystemOnce'),
    deliverEvent: event('deliverEventAsSystem'), enqueueEvent: event('enqueueEventAsSystem'),
  } satisfies DatabaseAutomationTorrentService);
}

function normalizeTorrentKey(value: unknown): string {
  if (value === undefined) return 'default';
  if (typeof value !== 'string' || !TORRENT_KEY_PATTERN.test(value)) {
    throw new DatabaseError(
      'DATABASE_PAYLOAD_INVALID',
      'Database automation Torrent key is invalid.',
      { retryable: false, outcome: 'not-started' },
    );
  }
  return value;
}

function torrentIdempotencyKey(deliveryId: string, key: string): string {
  return `dba:${new Bun.CryptoHasher('sha256')
    .update('zero.database-automation.torrent.v1\0')
    .update(deliveryId)
    .update('\0')
    .update(key)
    .digest('hex')}`;
}
