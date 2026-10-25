/** Dedicated delivery subprocess entry. Owns batching/retry scheduling; all database access uses fixed parent capabilities. */
import { parseDatabaseActorInvocation } from '../databases/database-actor-entry-contract';
import { LoggingError } from './logging-error';
import { LoggingDeliveryChannel } from './logging-delivery-channel';
import { LoggingDeliveryScheduler } from './logging-delivery-scheduler';
import { LOGGING_DELIVERY_FLAG, LOGGING_DELIVERY_MAX_SOURCES, readDeliveryAppend, readDeliveryWire } from './logging-delivery-protocol';
import { loggingArray, loggingId, loggingRecord, normalizeLoggingEvent } from './logging-validation';
import type { ResolvedLoggingConfig } from './logging-config';

/** Returns false only when the exact private marker is absent; malformed child invocations never boot the app. */
export async function runLoggingDeliveryIfRequested(argv: readonly string[] = process.argv): Promise<boolean> {
  const invocation = parseDatabaseActorInvocation(argv, LOGGING_DELIVERY_FLAG); if (!invocation) return false;
  if (invocation.role !== 'writer' || invocation.slot !== 0 || typeof process.send !== 'function' || !process.connected)
    throw new LoggingError('LOGGING_CONFIG_INVALID', 'Delivery worker requires its private parent channel.');
  let channel: LoggingDeliveryChannel | null = null, scheduler: LoggingDeliveryScheduler | null = null, stopping = false;
  let finish!: () => void; const done = new Promise<void>(resolve => { finish = resolve; });
  const startup = setTimeout(() => process.exit(70), 10000);
  const ids = (raw: unknown) => loggingArray(raw, LOGGING_DELIVERY_MAX_SOURCES).map(id => loggingId(id)!);
  const failed = () => { channel?.close(); process.exit(70); };
  const onMessage = (raw: unknown) => {
    try {
      if (!channel) {
        const message = readDeliveryWire(raw);
        if (message.type !== 'call' || message.op !== 'init') throw new Error();
        channel = new LoggingDeliveryChannel(message.nonce, value => { process.send!(value); }, async (op, value) => {
          if (op === 'init') {
            if (scheduler) throw new Error();
            const config = loggingRecord(value, ['queue']);
            scheduler = new LoggingDeliveryScheduler(config.queue as ResolvedLoggingConfig['queue'], {
              page: (id, acknowledge) => channel!.call('source.page', { id, acknowledge }),
              append: async (stream, events) => readDeliveryAppend(await channel!.call('sink.append', { stream, events }), events),
              sourceState: (id, state) => channel!.signal('source.state', { id, state }),
              sourceFailed: id => channel!.signal('source.failed', { id }),
              pending: state => channel!.signal('pending', state),
            });
            clearTimeout(startup); return { pid: process.pid };
          }
          if (!scheduler || stopping) throw new LoggingError('LOGGING_CLOSED', 'Delivery worker is unavailable.');
          switch (op) {
            case 'write': return scheduler.write(normalizeLoggingEvent(value));
            case 'source.add': scheduler.add(ids(value)); return null;
            case 'source.flush': await scheduler.flush(ids(value)); return null;
            case 'source.close': await scheduler.remove(ids(value)); return null;
            case 'flush': await scheduler.flush(); return null;
            case 'status': return scheduler.diagnostics();
            case 'stop':
              stopping = true; await scheduler.stop();
              // Let the channel deliver this reply before disconnecting.
              setTimeout(finish, 0); return scheduler.diagnostics();
            default: throw new LoggingError('LOGGING_EVENT_INVALID', 'Unknown delivery worker operation.');
          }
        }, (op, value) => {
          if (op !== 'source.wake' || !scheduler || stopping) throw new Error();
          for (const id of ids(value)) scheduler.wake(id);
        }, failed, 16, 200032);
      }
      channel.receive(raw);
    } catch { failed(); }
  };
  const disconnect = () => { channel?.close(); process.exit(0); };
  process.on('message', onMessage); process.on('disconnect', disconnect);
  try { await done; await (channel as LoggingDeliveryChannel | null)?.settled(); }
  finally {
    clearTimeout(startup); process.off('message', onMessage); process.off('disconnect', disconnect); (channel as LoggingDeliveryChannel | null)?.close();
    if (process.connected) process.disconnect?.();
  }
  return true;
}
