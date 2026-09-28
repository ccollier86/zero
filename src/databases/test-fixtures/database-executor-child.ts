/** Test-only generic actor for SubprocessDatabaseExecutor. */

import {
  DATABASE_EXECUTOR_PROTOCOL_KIND,
  DATABASE_EXECUTOR_PROTOCOL_VERSION,
  type DatabaseExecutorHandshakeMessage,
  type DatabaseExecutorOperationMessage,
  type DatabaseExecutorShutdownMessage,
} from '../subprocess-database-executor';
import {
  DatabaseError,
  serializeDatabaseError,
} from '../database-error';

type Session = Omit<DatabaseExecutorHandshakeMessage, 'type'>;

const mode = process.argv[2] ?? 'normal';
let session: Session | null = null;

if (mode === 'ignore-sigterm') {
  process.on('SIGTERM', () => {
    // Keep the process alive until the parent reaches its SIGKILL deadline.
  });
}

process.on('message', (message: unknown) => {
  if (!session) {
    const handshake = parseHandshake(message);
    if (!handshake) process.exit(64);
    session = {
      protocol: handshake.protocol,
      version: handshake.version,
      nonce: handshake.nonce,
      role: handshake.role,
      slot: handshake.slot,
      generation: handshake.generation,
    };
    if (mode === 'delayed-ready') {
      setTimeout(() => send({ ...session!, type: 'ready' }), 30);
    } else if (mode !== 'never-ready') {
      send({ ...session, type: 'ready' });
    }
    return;
  }

  const record = asRecord(message);
  if (!record || !matchesSession(record, session)) process.exit(65);
  if (record.type === 'shutdown') {
    const shutdown = message as DatabaseExecutorShutdownMessage;
    void shutdown;
    send({ ...session, type: 'shutdown-ack' });
    setTimeout(() => {
      process.disconnect?.();
      process.exit(0);
    }, 10);
    return;
  }
  if (record.type !== 'request') process.exit(66);

  const request = message as DatabaseExecutorOperationMessage;
  handleRequest(request, session);
});

function handleRequest(
  request: DatabaseExecutorOperationMessage,
  active: Session,
): void {
  switch (request.operation) {
    case 'echo': {
      const payload = asRecord(request.payload);
      const delayMs = typeof payload?.delayMs === 'number' ? payload.delayMs : 0;
      setTimeout(() => {
        send({
          ...active,
          type: 'response',
          requestId: request.requestId,
          ok: true,
          value: payload?.value,
        });
      }, delayMs);
      return;
    }
    case 'malformed':
      send({
        ...active,
        type: 'response',
        requestId: request.requestId,
        ok: true,
        value: null,
        unexpected: true,
      });
      return;
    case 'unknown-response':
      send({
        ...active,
        type: 'response',
        requestId: request.requestId + 10_000,
        ok: true,
        value: null,
      });
      return;
    case 'stale-generation':
      send({
        ...active,
        generation: active.generation + 1,
        type: 'response',
        requestId: request.requestId,
        ok: true,
        value: null,
      });
      return;
    case 'invalid-value':
      send({
        ...active,
        type: 'response',
        requestId: request.requestId,
        ok: true,
        value: new Map([['outside', 'executor-value-contract']]),
      });
      return;
    case 'cyclic-value': {
      const value: Record<string, unknown> = {};
      value.self = value;
      send({
        ...active,
        type: 'response',
        requestId: request.requestId,
        ok: true,
        value,
      });
      return;
    }
    case 'oversized-value':
      send({
        ...active,
        type: 'response',
        requestId: request.requestId,
        ok: true,
        value: 'x'.repeat(1024 * 1024 + 1),
      });
      return;
    case 'environment':
      send({
        ...active,
        type: 'response',
        requestId: request.requestId,
        ok: true,
        value: {
          allowed: process.env.ZERO_EXECUTOR_ALLOWED ?? null,
          configuredSecret: process.env.ZERO_EXECUTOR_ENV_SECRET ?? null,
          parentOnly: process.env.ZERO_EXECUTOR_PARENT_ONLY_991F ?? null,
        },
      });
      return;
    case 'exit':
      process.exit(17);
    case 'exit-later': {
      const payload = asRecord(request.payload);
      const delayMs = typeof payload?.delayMs === 'number' ? payload.delayMs : 100;
      setTimeout(() => process.exit(0), delayMs);
      return;
    }
    case 'never':
      return;
    default:
      send({
        ...active,
        type: 'response',
        requestId: request.requestId,
        ok: false,
        error: serializeDatabaseError(new DatabaseError(
          'DATABASE_PROTOCOL_ERROR',
          'Unsupported test executor operation.',
        )),
      });
  }
}

function parseHandshake(value: unknown): DatabaseExecutorHandshakeMessage | null {
  const record = asRecord(value);
  if (!record
    || record.protocol !== DATABASE_EXECUTOR_PROTOCOL_KIND
    || record.version !== DATABASE_EXECUTOR_PROTOCOL_VERSION
    || record.type !== 'handshake'
    || typeof record.nonce !== 'string'
    || typeof record.role !== 'string'
    || !Number.isSafeInteger(record.slot)
    || !Number.isSafeInteger(record.generation)) {
    return null;
  }
  return value as DatabaseExecutorHandshakeMessage;
}

function matchesSession(
  record: Record<string, unknown>,
  active: Session,
): boolean {
  return record.protocol === active.protocol
    && record.version === active.version
    && record.nonce === active.nonce
    && record.role === active.role
    && record.slot === active.slot
    && record.generation === active.generation;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function send(message: unknown): void {
  if (typeof process.send !== 'function') process.exit(69);
  process.send(message);
}
