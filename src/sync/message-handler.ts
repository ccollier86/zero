/**
 * Routes WebSocket wire messages to durable Sync, state, and ephemeral
 * handlers. Parsing and top-level dispatch live here; each subsystem owns its
 * validation, authorization, persistence, and delivery pipeline.
 */

import type { ServerWebSocket } from 'bun';
import type { PlatformObservabilityRuntime } from '../observability/types';
import {
  handleEphemeralDelete,
  handleEphemeralSet,
  handleEphemeralSubscribe,
  handleEphemeralUnsubscribe,
} from './ephemeral-handler';
import type { EphemeralChannel } from './ephemeral-channel';
import type { EphemeralStateManager } from './ephemeral-manager';
import {
  withReactiveDBLocalChangeOrigin,
  type ReactiveDB,
} from './reactive-db';
import {
  handleStateClear,
  handleStateDelete,
  handleStateSet,
  handleStateSubscribe,
  sendInvalidStateRequest,
} from './state-handler';
import { isJsonValue, type StateManager } from './state-manager';
import {
  isSyncDataMessage,
  routeSyncDataMessage,
} from './sync-data-message-router';
import type { SyncMutationOriginContext } from './sync-default-mutation-handler';
import type { SyncMutationReceiptStore } from './sync-mutation-receipt-store';
import { allowAllSyncPolicy, type SyncPolicy } from './sync-policy';
import type { SyncSystemSocketBridge } from './sync-system-data-plane';
import type { SyncTenantSocketBridge } from './sync-tenant-data-plane';
import type {
  EphemeralDeleteMessage,
  EphemeralSetMessage,
  EphemeralSubscribeMessage,
  EphemeralUnsubscribeMessage,
  StateClearMessage,
  StateDeleteMessage,
  StateSetMessage,
  SyncResourcePolicyAdapter,
  SyncSocketData,
  SyncTableMutationValidator,
} from './types';

export { currentMutationOrigin } from './sync-default-mutation-handler';
export type { SyncMutationOriginContext } from './sync-default-mutation-handler';

/**
 * Route an incoming WebSocket message to the appropriate handler.
 *
 * The positional signature remains the compatibility contract for existing
 * direct callers. Internally it is normalized into focused subsystem contexts.
 */
export async function routeMessage(
  ws: ServerWebSocket<SyncSocketData>,
  raw: string | Record<string, unknown>,
  db: ReactiveDB,
  server: { publish: (topic: string, data: string) => void },
  stateManager?: StateManager | null,
  ephemeralManager?: EphemeralStateManager | null,
  policy: SyncPolicy = allowAllSyncPolicy,
  snapshotTables?: Set<string>,
  resourcePolicy?: SyncResourcePolicyAdapter,
  mutationReceipts?: SyncMutationReceiptStore,
  mutationOrigin?: SyncMutationOriginContext,
  mutationValidators?: Readonly<Record<string, SyncTableMutationValidator>>,
  ephemeralChannel?: EphemeralChannel | null,
  tenancyMode: 'single' | 'multi' = 'single',
  revalidateMutationAuthority?: () => Promise<boolean>,
  validateMutationAuthorityAtCommit?: () => boolean,
  tenantDataPlane?: SyncTenantSocketBridge,
  observability?: PlatformObservabilityRuntime | null,
  assertCurrentReadAuthority: () => void = () => undefined,
  systemDataPlane?: SyncSystemSocketBridge,
  stateDB: ReactiveDB = db,
  ensureMutationReady?: (input: Readonly<{
    table: string;
    authContext: SyncSocketData['authContext'];
  }>) => void | Promise<void>,
): Promise<void> {
  const message = parseMessage(raw);
  if (!message) return;

  if (isSyncDataMessage(message)) {
    await routeSyncDataMessage(ws, message, {
      db,
      policy,
      snapshotTables,
      resourcePolicy,
      mutationReceipts,
      mutationOrigin,
      mutationValidators,
      revalidateMutationAuthority,
      validateMutationAuthorityAtCommit,
      tenantDataPlane,
      systemDataPlane,
      observability,
      assertCurrentReadAuthority,
      ensureMutationReady,
    });
    return;
  }

  switch (message.type) {
    case 'state.subscribe':
      if (stateManager) {
        handleStateSubscribe(
          ws,
          stateManager,
          server,
          tenancyMode,
          validateMutationAuthorityAtCommit,
        );
      }
      break;
    case 'state.set':
      if (stateManager) {
        if (!isValidStateRef(message.ref)
          || typeof message.key !== 'string'
          || !Object.hasOwn(message, 'value')
          || !isJsonValue(message.value)) {
          sendInvalidStateRequest(ws, safeStateRef(message.ref));
          break;
        }
        withReactiveDBLocalChangeOrigin(
          stateDB,
          ws.data.connectionId,
          () => handleStateSet(
            ws,
            message as unknown as StateSetMessage,
            stateManager,
            server,
            tenancyMode,
            mutationOrigin,
            validateMutationAuthorityAtCommit,
          ),
        );
      }
      break;
    case 'state.delete':
      if (stateManager) {
        if (!isValidStateRef(message.ref) || typeof message.key !== 'string') {
          sendInvalidStateRequest(ws, safeStateRef(message.ref));
          break;
        }
        withReactiveDBLocalChangeOrigin(
          stateDB,
          ws.data.connectionId,
          () => handleStateDelete(
            ws,
            message as unknown as StateDeleteMessage,
            stateManager,
            server,
            tenancyMode,
            mutationOrigin,
            validateMutationAuthorityAtCommit,
          ),
        );
      }
      break;
    case 'state.clear':
      if (stateManager) {
        if (!isValidStateRef(message.ref)) {
          sendInvalidStateRequest(ws, safeStateRef(message.ref));
          break;
        }
        withReactiveDBLocalChangeOrigin(
          stateDB,
          ws.data.connectionId,
          () => handleStateClear(
            ws,
            message as unknown as StateClearMessage,
            stateManager,
            server,
            tenancyMode,
            mutationOrigin,
            validateMutationAuthorityAtCommit,
          ),
        );
      }
      break;
    case 'ephemeral.subscribe':
      if (ephemeralChannel) {
        await ephemeralChannel.subscribe(ws, message.topic);
      } else if (ephemeralManager) {
        handleEphemeralSubscribe(
          ws,
          message as unknown as EphemeralSubscribeMessage,
          ephemeralManager,
          server.publish.bind(server),
        );
      }
      break;
    case 'ephemeral.unsubscribe':
      if (ephemeralChannel) {
        ephemeralChannel.unsubscribe(ws, message.topic);
      } else if (ephemeralManager) {
        handleEphemeralUnsubscribe(
          ws,
          message as unknown as EphemeralUnsubscribeMessage,
          ephemeralManager,
        );
      }
      break;
    case 'ephemeral.set':
      if (ephemeralChannel) {
        await ephemeralChannel.set(ws, {
          topic: message.topic,
          key: message.key,
          value: message.value,
          ttl: message.ttl,
        });
      } else if (ephemeralManager) {
        handleEphemeralSet(
          ws,
          message as unknown as EphemeralSetMessage,
          ephemeralManager,
          server,
        );
      }
      break;
    case 'ephemeral.delete':
      if (ephemeralChannel) {
        await ephemeralChannel.delete(ws, message.topic, message.key);
      } else if (ephemeralManager) {
        handleEphemeralDelete(
          ws,
          message as unknown as EphemeralDeleteMessage,
          ephemeralManager,
          server,
        );
      }
      break;
    default:
      // Unknown message type — ignore.
      break;
  }
}

function parseMessage(
  raw: string | Record<string, unknown>,
): { type: string; [key: string]: unknown } | null {
  let message: unknown = raw;
  if (typeof raw === 'string') {
    try {
      message = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!message) return null;
  if (typeof (message as { type?: unknown }).type !== 'string') return null;
  return message as { type: string; [key: string]: unknown };
}

const MAX_STATE_REF_LENGTH = 128;

function isValidStateRef(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_STATE_REF_LENGTH;
}

function safeStateRef(value: unknown): string {
  return isValidStateRef(value) ? value : '';
}
