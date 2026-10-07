import type { ServerWebSocket } from 'bun';
import type { EphemeralStateManager } from './ephemeral-manager';
import type {
  EphemeralErrorCode,
  EphemeralErrorMessage,
  EphemeralTopicAllowedDecision,
  EphemeralTopicOperation,
  EphemeralTopicPolicy,
  EphemeralWireOperation,
} from './ephemeral-policy';
import {
  EPHEMERAL_LIMITS,
  asJsonValue,
  validateEphemeralKey,
  validateEphemeralNamespace,
  validateEphemeralTTL,
  validateEphemeralTopic,
  validateEphemeralValue,
} from './ephemeral-validation';
import type {
  EphemeralChangeMessage,
  EphemeralSnapshotMessage,
  JsonValue,
  SyncSocketData,
} from './types';
import { sendSyncWire } from './sync-wire-send';

interface EphemeralTopicBinding {
  topic: string;
  namespace: string;
}

export interface EphemeralChannelOptions {
  /** Periodically recheck live custom/room membership policy. Default: 30000. */
  revalidateIntervalMs?: number;
  /** Observe a failed authority sweep before its sockets are failed closed. */
  onRevalidationFailure?: (
    error: unknown,
    trigger: EphemeralRevalidationTrigger,
  ) => void;
}

export type EphemeralRevalidationTrigger =
  | 'authority-revision'
  | 'periodic'
  | 'room-members-change';

type EphemeralSocket = ServerWebSocket<SyncSocketData>;

const EPHEMERAL_ERROR_CODES = new Set<EphemeralErrorCode>([
  'EPHEMERAL_UNAUTHENTICATED',
  'EPHEMERAL_FORBIDDEN',
  'EPHEMERAL_TOPIC_UNCLASSIFIED',
  'EPHEMERAL_POLICY_UNAVAILABLE',
  'EPHEMERAL_POLICY_INVALID',
  'EPHEMERAL_INVALID_TOPIC',
  'EPHEMERAL_INVALID_KEY',
  'EPHEMERAL_INVALID_TTL',
  'EPHEMERAL_VALUE_TOO_LARGE',
  'EPHEMERAL_TOO_MANY_TOPICS',
  'EPHEMERAL_CAPACITY_EXCEEDED',
  'EPHEMERAL_KEY_NOT_OWNED',
]);

/**
 * App-local owner for authorized ephemeral subscriptions and delivery.
 *
 * Delivery is direct instead of Bun topic fanout so each subscriber's live
 * policy can be rechecked before a change crosses the socket boundary.
 */
export class EphemeralChannel {
  private readonly bindings = new Map<string, Map<string, EphemeralTopicBinding>>();
  private readonly sockets = new Map<string, EphemeralSocket>();
  private readonly revalidationTimer: ReturnType<typeof setInterval> | null;
  private readonly observedRevalidations = new WeakSet<Promise<void>>();
  private revalidation: Promise<void> | null = null;
  private revalidationQueued = false;
  private disposed = false;
  private readonly removeExpirationListener: () => void;

  constructor(
    private readonly manager: EphemeralStateManager,
    private readonly policy: EphemeralTopicPolicy,
    private readonly options: EphemeralChannelOptions = {},
  ) {
    this.removeExpirationListener = manager.onExpired(expiration => {
      if (this.disposed) return;
      void this.broadcast(expiration.namespace, {
        type: 'ephemeral.change', topic: '', key: expiration.key, value: null,
        userId: expiration.entry.userId, op: 'delete',
      }).catch(error => this.handleRevalidationFailure(error, 'periodic'));
    });
    const intervalMs = options.revalidateIntervalMs ?? 30_000;
    this.revalidationTimer = intervalMs > 0
      ? setInterval(
          () => { this.requestRevalidation('periodic'); },
          Math.max(10, intervalMs),
        )
      : null;
  }

  async subscribe(ws: EphemeralSocket, topicInput: unknown): Promise<void> {
    if (this.disposed) return;
    this.register(ws);
    const validated = validateEphemeralTopic(topicInput);
    if (!validated.ok) {
      this.reject(ws, 'subscribe', validated.code, validated.reason);
      return;
    }
    const topic = topicInput as string;
    const socketBindings = this.getBindings(ws);
    const current = socketBindings.get(topic);
    if (!current && socketBindings.size >= EPHEMERAL_LIMITS.maxTopicsPerSocket) {
      this.reject(
        ws,
        'subscribe',
        'EPHEMERAL_TOO_MANY_TOPICS',
        `A socket may subscribe to at most ${EPHEMERAL_LIMITS.maxTopicsPerSocket} ephemeral topics`,
        topic,
        undefined,
      );
      return;
    }

    const decision = await this.authorize(ws, 'subscribe', topic);
    if (!decision.ok) {
      if (current) this.removeBinding(ws, current);
      this.reject(
        ws,
        'subscribe',
        decision.code,
        decision.reason,
        topic,
        undefined,
        current !== undefined,
      );
      return;
    }
    if (current && current.namespace !== decision.namespace) {
      this.removeBinding(ws, current);
    }

    const binding: EphemeralTopicBinding = { topic, namespace: decision.namespace };
    socketBindings.set(topic, binding);
    this.manager.subscribe(binding.namespace, ws.data.connectionId);
    ws.data.ephemeralTopics.add(topic);
    this.sendSnapshot(ws, binding);
  }

  unsubscribe(ws: EphemeralSocket, topicInput: unknown): void {
    const validated = validateEphemeralTopic(topicInput);
    if (!validated.ok) {
      this.reject(ws, 'unsubscribe', validated.code, validated.reason);
      return;
    }
    const topic = topicInput as string;
    const binding = this.bindings.get(ws.data.connectionId)?.get(topic);
    if (binding) this.removeBinding(ws, binding);
  }

  async set(
    ws: EphemeralSocket,
    input: { topic: unknown; key: unknown; value: unknown; ttl?: unknown },
  ): Promise<void> {
    if (this.disposed) return;
    this.register(ws);
    const topicValidation = validateEphemeralTopic(input.topic);
    if (!topicValidation.ok) {
      this.reject(ws, 'set', topicValidation.code, topicValidation.reason);
      return;
    }
    const keyValidation = validateEphemeralKey(input.key);
    if (!keyValidation.ok) {
      this.reject(
        ws,
        'set',
        keyValidation.code,
        keyValidation.reason,
        input.topic as string,
      );
      return;
    }
    const ttlValidation = validateEphemeralTTL(input.ttl);
    if (!ttlValidation.ok) {
      this.reject(
        ws,
        'set',
        ttlValidation.code,
        ttlValidation.reason,
        input.topic as string,
        input.key as string,
      );
      return;
    }
    const valueValidation = validateEphemeralValue(input.value);
    if (!valueValidation.ok) {
      this.reject(
        ws,
        'set',
        valueValidation.code,
        valueValidation.reason,
        input.topic as string,
        input.key as string,
      );
      return;
    }

    const topic = input.topic as string;
    const key = input.key as string;
    const value = asJsonValue(input.value);
    const ttl = input.ttl as number | undefined;
    const decision = await this.authorize(ws, 'set', topic, key, value, ttl);
    if (!decision.ok) {
      this.reject(ws, 'set', decision.code, decision.reason, topic, key);
      return;
    }
    if (!this.bindingMatchesDecision(ws, topic, decision)) return;

    const actorId = this.actorId(ws);
    const existing = this.manager.getEntry(decision.namespace, key);
    if ((decision.keyOwnership ?? 'actor') === 'actor'
      && existing && existing.userId !== actorId) {
      this.reject(
        ws,
        'set',
        'EPHEMERAL_KEY_NOT_OWNED',
        'Ephemeral key is owned by another principal',
        topic,
        key,
      );
      return;
    }

    const valueSize = new TextEncoder().encode(JSON.stringify(value)).byteLength;
    if (!this.hasWriteCapacity(decision.namespace, actorId, existing, valueSize)) {
      this.reject(
        ws,
        'set',
        'EPHEMERAL_CAPACITY_EXCEEDED',
        'Ephemeral state capacity has been reached; wait for existing values to expire',
        topic,
        key,
      );
      return;
    }

    this.manager.set(decision.namespace, key, value, actorId, ttl, valueSize);
    await this.broadcast(decision.namespace, {
      type: 'ephemeral.change',
      topic,
      key,
      value,
      userId: actorId,
      op: 'set',
    });
  }

  async delete(
    ws: EphemeralSocket,
    topicInput: unknown,
    keyInput: unknown,
  ): Promise<void> {
    if (this.disposed) return;
    this.register(ws);
    const topicValidation = validateEphemeralTopic(topicInput);
    if (!topicValidation.ok) {
      this.reject(ws, 'delete', topicValidation.code, topicValidation.reason);
      return;
    }
    const keyValidation = validateEphemeralKey(keyInput);
    if (!keyValidation.ok) {
      this.reject(
        ws,
        'delete',
        keyValidation.code,
        keyValidation.reason,
        topicInput as string,
      );
      return;
    }
    const topic = topicInput as string;
    const key = keyInput as string;
    const decision = await this.authorize(ws, 'delete', topic, key);
    if (!decision.ok) {
      this.reject(ws, 'delete', decision.code, decision.reason, topic, key);
      return;
    }
    if (!this.bindingMatchesDecision(ws, topic, decision)) return;

    const actorId = this.actorId(ws);
    const existing = this.manager.getEntry(decision.namespace, key);
    if (!existing) return;
    if ((decision.keyOwnership ?? 'actor') === 'actor'
      && existing.userId !== actorId) {
      this.reject(
        ws,
        'delete',
        'EPHEMERAL_KEY_NOT_OWNED',
        'Ephemeral key is owned by another principal',
        topic,
        key,
      );
      return;
    }
    if (!this.manager.delete(decision.namespace, key)) return;

    await this.broadcast(decision.namespace, {
      type: 'ephemeral.change',
      topic,
      key,
      value: null,
      userId: actorId,
      op: 'delete',
    });
  }

  /** Recheck all live subscription decisions without losing concurrent invalidations. */
  revalidateAll(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    this.revalidationQueued = true;
    if (this.revalidation) return this.revalidation;

    const task = (async () => {
      // A policy/authority revision can change while an asynchronous sweep is
      // still using its prior snapshot. Preserve one queued follow-up so the
      // newest revision is always observed promptly instead of waiting for the
      // periodic fallback.
      while (this.revalidationQueued && !this.disposed) {
        this.revalidationQueued = false;
        await this.performRevalidation();
      }
    })();
    this.revalidation = task;
    void task.then(
      () => {
        if (this.revalidation === task) this.revalidation = null;
      },
      () => {
        this.revalidationQueued = false;
        if (this.revalidation === task) this.revalidation = null;
      },
    ).catch(() => undefined);
    return task;
  }

  /** Launch an authority sweep whose failure is observed and handled fail closed. */
  requestRevalidation(trigger: EphemeralRevalidationTrigger): void {
    const task = this.revalidateAll();
    if (this.observedRevalidations.has(task)) return;
    this.observedRevalidations.add(task);
    void task.catch((error) => {
      this.handleRevalidationFailure(error, trigger);
    }).catch(() => undefined);
  }

  cleanup(ws: EphemeralSocket): void {
    const socketBindings = this.bindings.get(ws.data.connectionId);
    if (socketBindings) {
      for (const binding of socketBindings.values()) {
        this.manager.unsubscribe(binding.namespace, ws.data.connectionId);
      }
    }
    this.bindings.delete(ws.data.connectionId);
    this.sockets.delete(ws.data.connectionId);
    this.manager.unsubscribeAll(ws.data.connectionId);
    ws.data.ephemeralTopics.clear();
  }

  dispose(): void {
    this.disposed = true;
    this.revalidationQueued = false;
    if (this.revalidationTimer) clearInterval(this.revalidationTimer);
    this.removeExpirationListener();
    this.bindings.clear();
    this.sockets.clear();
  }

  private async performRevalidation(): Promise<void> {
    for (const ws of [...this.sockets.values()]) {
      const socketBindings = this.bindings.get(ws.data.connectionId);
      if (!socketBindings) continue;
      for (const binding of [...socketBindings.values()]) {
        await this.revalidateBinding(ws, binding);
      }
    }
  }

  private handleRevalidationFailure(
    error: unknown,
    trigger: EphemeralRevalidationTrigger,
  ): void {
    try {
      this.options.onRevalidationFailure?.(error, trigger);
    } catch {
      // Observability/invalidation hooks cannot prevent local fail-closed cleanup.
    }

    for (const ws of [...this.sockets.values()]) {
      try {
        this.cleanup(ws);
      } catch {
        // A damaged manager cannot retain a live channel/socket association.
        this.bindings.delete(ws.data.connectionId);
        this.sockets.delete(ws.data.connectionId);
        ws.data.ephemeralTopics.clear();
      }
      try {
        ws.close(1011, 'Ephemeral authority revalidation failed');
      } catch {
        // Local maps are already revoked even if the transport is unavailable.
      }
    }
  }

  private async broadcast(
    namespace: string,
    change: EphemeralChangeMessage,
  ): Promise<void> {
    const connectionIds = [...this.manager.getSubscribers(namespace)];
    for (const connectionId of connectionIds) {
      if (this.disposed) return;
      const ws = this.sockets.get(connectionId);
      const socketBindings = this.bindings.get(connectionId);
      if (!ws || !socketBindings) continue;
      for (const binding of [...socketBindings.values()]) {
        if (binding.namespace !== namespace) continue;
        if (!(await this.revalidateBinding(ws, binding))) continue;
        this.send(ws, { ...change, topic: binding.topic });
      }
    }
  }

  private async revalidateBinding(
    ws: EphemeralSocket,
    binding: EphemeralTopicBinding,
  ): Promise<boolean> {
    const decision = await this.authorize(ws, 'subscribe', binding.topic);
    if (!decision.ok) {
      this.removeBinding(ws, binding);
      this.reject(
        ws,
        'subscribe',
        decision.code,
        decision.reason,
        binding.topic,
        undefined,
        true,
      );
      return false;
    }
    if (decision.namespace !== binding.namespace) {
      this.removeBinding(ws, binding);
      this.reject(
        ws,
        'subscribe',
        'EPHEMERAL_POLICY_INVALID',
        'Ephemeral topic namespace changed during revalidation',
        binding.topic,
        undefined,
        true,
      );
      return false;
    }
    return true;
  }

  private async authorize(
    ws: EphemeralSocket,
    operation: EphemeralTopicOperation,
    topic: string,
    key?: string,
    value?: JsonValue,
    ttl?: number,
  ): Promise<EphemeralTopicAllowedDecision | {
    ok: false;
    code: EphemeralErrorCode;
    reason: string;
  }> {
    let decision;
    try {
      decision = await this.policy.authorize({
        operation,
        topic,
        key,
        value,
        ttl,
        authContext: ws.data.authContext,
        connectionId: ws.data.connectionId,
      });
      // Cleanup/close may finish while an asynchronous policy is resolving.
      // A late decision cannot recreate a retired socket's subscription or values.
      if (this.disposed || this.sockets.get(ws.data.connectionId) !== ws) {
        return { ok: false, code: 'EPHEMERAL_FORBIDDEN', reason: 'Ephemeral connection is no longer current' };
      }
    } catch {
      return {
        ok: false,
        code: 'EPHEMERAL_POLICY_UNAVAILABLE',
        reason: 'Ephemeral topic policy evaluation failed',
      };
    }
    if (!decision || typeof decision !== 'object' || typeof decision.ok !== 'boolean') {
      return {
        ok: false,
        code: 'EPHEMERAL_POLICY_INVALID',
        reason: 'Ephemeral topic policy returned an invalid decision',
      };
    }
    if (!decision.ok) {
      if (!EPHEMERAL_ERROR_CODES.has(decision.code)
        || typeof decision.reason !== 'string'
        || decision.reason.length === 0) {
        return {
          ok: false,
          code: 'EPHEMERAL_POLICY_INVALID',
          reason: 'Ephemeral topic policy returned an invalid denial',
        };
      }
      return decision;
    }
    const namespaceValidation = validateEphemeralNamespace(decision.namespace);
    if (!namespaceValidation.ok) return namespaceValidation;
    if (decision.keyOwnership !== undefined
      && decision.keyOwnership !== 'actor'
      && decision.keyOwnership !== 'unrestricted') {
      return {
        ok: false,
        code: 'EPHEMERAL_POLICY_INVALID',
        reason: 'Ephemeral topic policy returned invalid key ownership',
      };
    }
    return decision;
  }

  private bindingMatchesDecision(
    ws: EphemeralSocket,
    topic: string,
    decision: EphemeralTopicAllowedDecision,
  ): boolean {
    const binding = this.bindings.get(ws.data.connectionId)?.get(topic);
    if (!binding || binding.namespace === decision.namespace) return true;
    this.removeBinding(ws, binding);
    this.reject(
      ws,
      'subscribe',
      'EPHEMERAL_POLICY_INVALID',
      'Ephemeral topic namespace changed',
      topic,
      undefined,
      true,
    );
    return false;
  }

  private register(ws: EphemeralSocket): void {
    this.sockets.set(ws.data.connectionId, ws);
    if (!this.bindings.has(ws.data.connectionId)) {
      this.bindings.set(ws.data.connectionId, new Map());
    }
  }

  private getBindings(ws: EphemeralSocket): Map<string, EphemeralTopicBinding> {
    this.register(ws);
    return this.bindings.get(ws.data.connectionId)!;
  }

  private removeBinding(ws: EphemeralSocket, binding: EphemeralTopicBinding): void {
    this.manager.unsubscribe(binding.namespace, ws.data.connectionId);
    this.bindings.get(ws.data.connectionId)?.delete(binding.topic);
    ws.data.ephemeralTopics.delete(binding.topic);
  }

  private actorId(ws: EphemeralSocket): string {
    return ws.data.authContext?.userId ?? ws.data.connectionId;
  }

  private hasWriteCapacity(
    namespace: string,
    actorId: string,
    existing: ReturnType<EphemeralStateManager['getEntry']>,
    valueSize: number,
  ): boolean {
    const usage = this.manager.getUsage(namespace, actorId);
    const addsEntry = existing ? 0 : 1;
    const existingSize = existing?.byteSize
      ?? (existing
        ? new TextEncoder().encode(JSON.stringify(existing.value)).byteLength
        : 0);
    const actorExistingSize = existing?.userId === actorId ? existingSize : 0;
    return usage.totalEntries + addsEntry <= EPHEMERAL_LIMITS.maxEntriesTotal
      && usage.totalBytes - existingSize + valueSize <= EPHEMERAL_LIMITS.maxBytesTotal
      && usage.namespaceEntries + addsEntry <= EPHEMERAL_LIMITS.maxEntriesPerNamespace
      && usage.namespaceBytes - existingSize + valueSize
        <= EPHEMERAL_LIMITS.maxBytesPerNamespace
      && usage.actorEntries + (existing?.userId === actorId ? 0 : 1)
        <= EPHEMERAL_LIMITS.maxEntriesPerActor
      && usage.actorBytes - actorExistingSize + valueSize
        <= EPHEMERAL_LIMITS.maxBytesPerActor;
  }

  private sendSnapshot(ws: EphemeralSocket, binding: EphemeralTopicBinding): void {
    const snapshot: EphemeralSnapshotMessage = {
      type: 'ephemeral.snapshot',
      topic: binding.topic,
      entries: this.manager.getSnapshot(binding.namespace),
    };
    this.send(ws, snapshot);
  }

  private reject(
    ws: EphemeralSocket,
    operation: EphemeralWireOperation,
    code: EphemeralErrorCode,
    message: string,
    topic?: string,
    key?: string,
    revoked = false,
  ): void {
    if (revoked && topic) {
      this.send(ws, {
        type: 'ephemeral.snapshot',
        topic,
        entries: {},
      } satisfies EphemeralSnapshotMessage);
    }
    const error: EphemeralErrorMessage = {
      type: 'ephemeral.error',
      operation,
      code,
      message,
      topic,
      key,
      revoked: revoked || undefined,
    };
    this.send(ws, error);
  }

  private send(ws: EphemeralSocket, message: object): void {
    if (!sendSyncWire(ws, message as EphemeralSnapshotMessage
      | EphemeralChangeMessage
      | EphemeralErrorMessage)) this.cleanup(ws);
  }
}
