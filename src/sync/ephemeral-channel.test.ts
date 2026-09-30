import { afterEach, describe, expect, test } from 'bun:test';
import type { ServerWebSocket } from 'bun';
import { EphemeralChannel } from './ephemeral-channel';
import { EphemeralStateManager } from './ephemeral-manager';
import { createManagedEphemeralTopicPolicy } from './ephemeral-managed-policy';
import {
  allowLegacyEphemeralTopicPolicy,
  type EphemeralErrorMessage,
  type EphemeralTopicPolicy,
} from './ephemeral-policy';
import { EPHEMERAL_LIMITS } from './ephemeral-validation';
import type {
  EphemeralChangeMessage,
  EphemeralSnapshotMessage,
  SyncSocketData,
} from './types';

type EphemeralServerMessage =
  | EphemeralErrorMessage
  | EphemeralSnapshotMessage
  | EphemeralChangeMessage;

interface MockSocket {
  ws: ServerWebSocket<SyncSocketData>;
  messages: EphemeralServerMessage[];
}

const managers: EphemeralStateManager[] = [];
const channels: EphemeralChannel[] = [];

afterEach(() => {
  for (const channel of channels.splice(0)) channel.dispose();
  for (const manager of managers.splice(0)) manager.dispose();
});

describe('managed ephemeral topic authorization', () => {
  test('rejects unauthenticated and non-member room access with stable wire errors', async () => {
    const members = new Set(['room-a:alice']);
    const channel = createManagedChannel(members);
    const anonymous = createSocket('anonymous', null);
    const bob = createSocket('bob-connection', 'bob');

    await channel.subscribe(anonymous.ws, 'presence:room-a');
    await channel.subscribe(bob.ws, 'presence:room-a');
    await channel.set(bob.ws, {
      topic: 'typing:room-a',
      key: 'user:bob',
      value: true,
    });

    expect(errorCodes(anonymous)).toEqual(['EPHEMERAL_UNAUTHENTICATED']);
    expect(errorCodes(bob)).toEqual([
      'EPHEMERAL_FORBIDDEN',
      'EPHEMERAL_FORBIDDEN',
    ]);
    expect(bob.ws.data.ephemeralTopics.size).toBe(0);
  });

  test('allows room members while isolating two server-derived room namespaces', async () => {
    const members = new Set(['room-a:alice', 'room-b:alice']);
    const channel = createManagedChannel(members);
    const alice = createSocket('alice-connection', 'alice');

    await channel.subscribe(alice.ws, 'presence:room-a');
    await channel.subscribe(alice.ws, 'presence:room-b');
    await channel.set(alice.ws, {
      topic: 'presence:room-a',
      key: 'user:alice',
      value: { status: 'available' },
    });
    await channel.set(alice.ws, {
      topic: 'presence:room-b',
      key: 'user:alice',
      value: { status: 'busy' },
    });

    const manager = managers.at(-1)!;
    expect(manager.getSnapshot('application:room:room-a:presence')).toEqual({
      'user:alice': {
        value: { status: 'available' },
        userId: 'alice',
      },
    });
    expect(manager.getSnapshot('application:room:room-b:presence')).toEqual({
      'user:alice': {
        value: { status: 'busy' },
        userId: 'alice',
      },
    });
    expect(errorCodes(alice)).toEqual([]);
  });

  test('prevents room key spoofing and cross-principal overwrite or delete', async () => {
    const members = new Set(['room-a:alice', 'room-a:bob']);
    const channel = createManagedChannel(members, actorOwnedSharedPolicy);
    const alice = createSocket('alice-connection', 'alice');
    const bob = createSocket('bob-connection', 'bob');

    await channel.set(alice.ws, {
      topic: 'presence:room-a',
      key: 'user:bob',
      value: true,
    });
    expect(errorCodes(alice)).toEqual(['EPHEMERAL_KEY_NOT_OWNED']);

    await channel.set(alice.ws, {
      topic: 'canvas:project-a',
      key: 'cursor:shared',
      value: { x: 1 },
    });
    await channel.set(bob.ws, {
      topic: 'canvas:project-a',
      key: 'cursor:shared',
      value: { x: 2 },
    });
    await channel.delete(bob.ws, 'canvas:project-a', 'cursor:shared');

    expect(errorCodes(bob)).toEqual([
      'EPHEMERAL_KEY_NOT_OWNED',
      'EPHEMERAL_KEY_NOT_OWNED',
    ]);
    expect(managers.at(-1)!.getSnapshot('application:app:custom:canvas:project-a')).toEqual({
      'cursor:shared': { value: { x: 1 }, userId: 'alice' },
    });
  });

  test('protects personal topics and delegates only unclassified topics to app policy', async () => {
    const policyCalls: string[] = [];
    const customPolicy: EphemeralTopicPolicy = {
      async authorize(context) {
        policyCalls.push(context.topic);
        return context.topic === 'custom:team-a'
          ? { ok: true, namespace: 'app:team-a', keyOwnership: 'actor' }
          : {
              ok: false,
              code: 'EPHEMERAL_FORBIDDEN',
              reason: 'Custom topic denied',
            };
      },
    };
    const channel = createManagedChannel(new Set(), customPolicy);
    const alice = createSocket('alice-connection', 'alice');

    await channel.subscribe(alice.ws, 'user:alice:notifications');
    await channel.subscribe(alice.ws, 'user:bob:notifications');
    await channel.subscribe(alice.ws, 'custom:team-a');
    await channel.subscribe(alice.ws, 'unknown:team-a');

    expect(policyCalls).toEqual(['custom:team-a', 'unknown:team-a']);
    expect(alice.ws.data.ephemeralTopics).toEqual(new Set([
      'user:alice:notifications',
      'custom:team-a',
    ]));
    expect(errorCodes(alice)).toEqual([
      'EPHEMERAL_FORBIDDEN',
      'EPHEMERAL_FORBIDDEN',
    ]);
  });

  test('denies unclassified shared topics by default', async () => {
    const channel = createManagedChannel(new Set());
    const alice = createSocket('alice-connection', 'alice');

    await channel.subscribe(alice.ws, 'project:unclassified');

    expect(errorCodes(alice)).toEqual(['EPHEMERAL_TOPIC_UNCLASSIFIED']);
  });

  test('revokes a live room subscription after membership is removed', async () => {
    const members = new Set(['room-a:alice', 'room-a:bob']);
    const channel = createManagedChannel(members);
    const alice = createSocket('alice-connection', 'alice');
    const bob = createSocket('bob-connection', 'bob');

    await channel.subscribe(alice.ws, 'presence:room-a');
    await channel.subscribe(bob.ws, 'presence:room-a');
    members.delete('room-a:alice');
    await channel.revalidateAll();

    const revocation = alice.messages.find(
      (message): message is EphemeralErrorMessage => message.type === 'ephemeral.error',
    );
    expect(revocation).toMatchObject({
      code: 'EPHEMERAL_FORBIDDEN',
      topic: 'presence:room-a',
      revoked: true,
    });
    expect(alice.messages).toContainEqual({
      type: 'ephemeral.snapshot',
      topic: 'presence:room-a',
      entries: {},
    });
    expect(alice.ws.data.ephemeralTopics.size).toBe(0);
    expect(managers.at(-1)!.getSubscribers('application:room:room-a:presence')).toEqual(
      new Set(['bob-connection']),
    );

    const afterRevocation = alice.messages.length;
    await channel.set(bob.ws, {
      topic: 'presence:room-a',
      key: 'user:bob',
      value: true,
    });
    expect(alice.messages).toHaveLength(afterRevocation);
  });

  test('queues an authority recheck that arrives during an in-flight sweep', async () => {
    let authorizationCalls = 0;
    let releaseInFlight!: () => void;
    let inFlightStarted!: () => void;
    const release = new Promise<void>((resolve) => { releaseInFlight = resolve; });
    const started = new Promise<void>((resolve) => { inFlightStarted = resolve; });
    const policy: EphemeralTopicPolicy = {
      async authorize(context) {
        authorizationCalls += 1;
        if (authorizationCalls === 2) {
          inFlightStarted();
          await release;
          return {
            ok: true,
            namespace: `queued:${context.topic}`,
            keyOwnership: 'actor',
          };
        }
        if (authorizationCalls >= 3) {
          return {
            ok: false,
            code: 'EPHEMERAL_FORBIDDEN',
            reason: 'Authority was revoked during revalidation',
          };
        }
        return {
          ok: true,
          namespace: `queued:${context.topic}`,
          keyOwnership: 'actor',
        };
      },
    };
    const channel = createChannel(policy);
    const socket = createSocket('queued-revalidation', 'alice');
    await channel.subscribe(socket.ws, 'custom:queued');

    const firstSweep = channel.revalidateAll();
    await started;
    const queuedSweep = channel.revalidateAll();
    expect(queuedSweep).toBe(firstSweep);
    releaseInFlight();
    await queuedSweep;

    expect(authorizationCalls).toBe(3);
    expect(socket.ws.data.ephemeralTopics).toEqual(new Set());
    expect(socket.messages.at(-1)).toMatchObject({
      type: 'ephemeral.error',
      code: 'EPHEMERAL_FORBIDDEN',
      revoked: true,
    });
  });

  test('observes periodic sweep failure before fail-closed socket cleanup', async () => {
    let authorizationCalls = 0;
    const cleanupFailure = new Error('private manager failure');
    const order: string[] = [];
    let observedFailure: unknown;
    let observedTrigger: string | undefined;
    let releaseObserved!: () => void;
    const observed = new Promise<void>((resolve) => { releaseObserved = resolve; });
    const manager = new EphemeralStateManager(1_000_000);
    const originalUnsubscribe = manager.unsubscribe.bind(manager);
    const channel = new EphemeralChannel(manager, {
      async authorize(context) {
        authorizationCalls += 1;
        return authorizationCalls === 1
          ? {
              ok: true,
              namespace: `periodic:${context.topic}`,
              keyOwnership: 'actor',
            }
          : {
              ok: false,
              code: 'EPHEMERAL_FORBIDDEN',
              reason: 'Periodic authority was revoked',
            };
      },
    }, {
      revalidateIntervalMs: 10,
      onRevalidationFailure(error, trigger) {
        order.push('report');
        observedFailure = error;
        observedTrigger = trigger;
        releaseObserved();
        throw new Error('private observability failure');
      },
    });
    const socket = createSocket('periodic-failure', 'alice');
    (socket.ws as unknown as {
      close(code: number, reason: string): void;
    }).close = (code, reason) => {
      order.push(`close:${code}:${reason}`);
      throw new Error('private transport close failure');
    };
    manager.unsubscribe = (namespace, connectionId) => {
      if (authorizationCalls > 1) throw cleanupFailure;
      originalUnsubscribe(namespace, connectionId);
    };
    managers.push(manager);
    channels.push(channel);

    await channel.subscribe(socket.ws, 'custom:periodic');
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        observed,
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error('Periodic revalidation did not run.')),
            1_000,
          );
        }),
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }

    expect(observedFailure).toBe(cleanupFailure);
    expect(observedTrigger).toBe('periodic');
    await Bun.sleep(30);
    expect(order).toEqual([
      'report',
      'close:1011:Ephemeral authority revalidation failed',
    ]);
    expect(socket.ws.data.ephemeralTopics.size).toBe(0);
  });

  test('isolates identical room and custom topics across active tenants', async () => {
    const policy = createManagedEphemeralTopicPolicy({
      getRoomService: () => ({
        isMember(roomId, userId, scope) {
          return userId === 'shared-user'
            && roomId === 'alpha-room'
            && scope?.tenantId === 'ten_alpha';
        },
      }),
      customPolicy: actorOwnedSharedPolicy,
    });
    const channel = createChannel(policy);
    const alpha = createTenantSocket(
      'alpha-connection',
      'shared-user',
      'ten_alpha',
      'mem_alpha',
    );
    const beta = createTenantSocket(
      'beta-connection',
      'shared-user',
      'ten_beta',
      'mem_beta',
    );

    await channel.set(alpha.ws, {
      topic: 'canvas:shared',
      key: 'cursor',
      value: { tenant: 'alpha' },
    });
    await channel.set(beta.ws, {
      topic: 'canvas:shared',
      key: 'cursor',
      value: { tenant: 'beta' },
    });
    await channel.subscribe(beta.ws, 'presence:alpha-room');

    const manager = managers.at(-1)!;
    expect(manager.getSnapshot('tenant:ten_alpha:app:custom:canvas:shared'))
      .toHaveProperty('cursor.value.tenant', 'alpha');
    expect(manager.getSnapshot('tenant:ten_beta:app:custom:canvas:shared'))
      .toHaveProperty('cursor.value.tenant', 'beta');
    expect(errorCodes(beta)).toContain('EPHEMERAL_FORBIDDEN');
  });

  test('rejects identity-only application sessions in multi mode', async () => {
    const channel = createChannel(createManagedEphemeralTopicPolicy({
      tenancyMode: 'multi',
      getRoomService: () => ({ isMember: () => true }),
      customPolicy: actorOwnedSharedPolicy,
    }));
    const socket = createSocket('application-session', 'shared-user');
    socket.ws.data.authContext = {
      userId: 'shared-user',
      email: 'shared-user@example.test',
      role: 'user',
      sessionScopeKind: 'application',
      sessionScopeId: 'application',
    };

    await channel.subscribe(socket.ws, 'user:shared-user:notifications');
    await channel.subscribe(socket.ws, 'custom:shared');

    expect(errorCodes(socket)).toEqual([
      'EPHEMERAL_FORBIDDEN',
      'EPHEMERAL_FORBIDDEN',
    ]);
    expect(socket.ws.data.ephemeralTopics).toEqual(new Set());
  });
});

describe('ephemeral transport bounds and compatibility', () => {
  test('bounds topic, key, TTL, value size, and subscriptions per socket', async () => {
    const channel = createLegacyChannel();
    const socket = createSocket('legacy-connection', null);

    await channel.subscribe(socket.ws, ` ${'t'.repeat(EPHEMERAL_LIMITS.maxTopicLength)}`);
    await channel.set(socket.ws, {
      topic: 'valid',
      key: '',
      value: true,
    });
    await channel.set(socket.ws, {
      topic: 'valid',
      key: 'key',
      value: true,
      ttl: EPHEMERAL_LIMITS.maxTTL + 1,
    });
    await channel.set(socket.ws, {
      topic: 'valid',
      key: 'key',
      value: 'x'.repeat(EPHEMERAL_LIMITS.maxValueSize + 1),
    });
    for (let index = 0; index <= EPHEMERAL_LIMITS.maxTopicsPerSocket; index++) {
      await channel.subscribe(socket.ws, `topic-${index}`);
    }

    expect(errorCodes(socket)).toEqual([
      'EPHEMERAL_INVALID_TOPIC',
      'EPHEMERAL_INVALID_KEY',
      'EPHEMERAL_INVALID_TTL',
      'EPHEMERAL_VALUE_TOO_LARGE',
      'EPHEMERAL_TOO_MANY_TOPICS',
    ]);
  });

  test('preserves unrestricted standalone authless behavior', async () => {
    const channel = createLegacyChannel();
    const first = createSocket('first-connection', null);
    const second = createSocket('second-connection', null);

    await channel.subscribe(first.ws, 'shared');
    await channel.subscribe(second.ws, 'shared');
    await channel.set(first.ws, {
      topic: 'shared',
      key: 'cursor',
      value: { x: 1 },
    });
    await channel.set(second.ws, {
      topic: 'shared',
      key: 'cursor',
      value: { x: 2 },
    });
    await channel.delete(second.ws, 'shared', 'cursor');

    expect(managers.at(-1)!.getSnapshot('legacy:shared')).toEqual({});
    expect(errorCodes(first)).toEqual([]);
    expect(errorCodes(second)).toEqual([]);
    expect(first.messages.filter((message) => message.type === 'ephemeral.change'))
      .toHaveLength(3);
  });

  test('bounds aggregate actor state even when writes do not subscribe', async () => {
    const channel = createLegacyChannel();
    const socket = createSocket('bounded-connection', null);

    for (let index = 0; index < EPHEMERAL_LIMITS.maxEntriesPerActor; index++) {
      await channel.set(socket.ws, {
        topic: `unsubscribed-${index}`,
        key: 'value',
        value: index,
      });
    }
    await channel.set(socket.ws, {
      topic: 'one-too-many',
      key: 'value',
      value: true,
    });

    expect(errorCodes(socket)).toEqual(['EPHEMERAL_CAPACITY_EXCEEDED']);
    expect(managers.at(-1)!.getSnapshot('legacy:one-too-many')).toEqual({});
  });
});

const actorOwnedSharedPolicy: EphemeralTopicPolicy = {
  async authorize(context) {
    return {
      ok: true,
      namespace: `custom:${context.topic}`,
      keyOwnership: 'actor',
    };
  },
};

function createManagedChannel(
  members: Set<string>,
  customPolicy?: EphemeralTopicPolicy,
): EphemeralChannel {
  return createChannel(createManagedEphemeralTopicPolicy({
    getRoomService: () => ({
      isMember(roomId, userId) {
        return members.has(`${roomId}:${userId}`);
      },
    }),
    customPolicy,
  }));
}

function createLegacyChannel(): EphemeralChannel {
  return createChannel(allowLegacyEphemeralTopicPolicy);
}

function createChannel(policy: EphemeralTopicPolicy): EphemeralChannel {
  const manager = new EphemeralStateManager(1_000_000);
  const channel = new EphemeralChannel(manager, policy, {
    revalidateIntervalMs: 0,
  });
  managers.push(manager);
  channels.push(channel);
  return channel;
}

function createSocket(connectionId: string, userId: string | null): MockSocket {
  const messages: EphemeralServerMessage[] = [];
  const data: SyncSocketData = {
    connectionId,
    subscribedTopics: new Set(),
    lastSeq: 0,
    syncSubscribedTables: new Set(),
    syncBackpressured: false,
    authContext: userId
      ? { userId, email: `${userId}@example.test`, role: 'user' }
      : null,
    authResolved: true,
    authorizationFingerprint: null,
    authorizationScope: null,
    allowedTables: new Set(),
    resourceRowFilters: new Map(),
    rowFilteredSubscribedTables: new Set(),
    query: {},
    stateSubscribed: false,
    ephemeralTopics: new Set(),
  };
  const ws = {
    data,
    send(message: string) {
      messages.push(JSON.parse(message) as EphemeralServerMessage);
      return message.length;
    },
  } as unknown as ServerWebSocket<SyncSocketData>;
  return { ws, messages };
}

function createTenantSocket(
  connectionId: string,
  userId: string,
  tenantId: string,
  membershipId: string,
): MockSocket {
  const socket = createSocket(connectionId, userId);
  socket.ws.data.authContext = {
    userId,
    email: `${userId}@example.test`,
    role: 'user',
    sessionScopeKind: 'tenant',
    sessionScopeId: tenantId,
    tenantId,
    membershipId,
    tenantRole: 'member',
    tenantAuthorizationGeneration: 0,
    membershipAuthorizationGeneration: 0,
  };
  return socket;
}

function errorCodes(socket: MockSocket): EphemeralErrorMessage['code'][] {
  return socket.messages
    .filter(
      (message): message is EphemeralErrorMessage => message.type === 'ephemeral.error',
    )
    .map((message) => message.code);
}
