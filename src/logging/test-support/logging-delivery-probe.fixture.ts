/** Deliberately adversarial synthetic delivery child. Tests fixed capability admission, never opens a database. */
import { LoggingDeliveryChannel } from '../logging-delivery-channel';
import { readDeliveryWire } from '../logging-delivery-protocol';
import { loggingEvent } from './logging-fixture';

let channel: LoggingDeliveryChannel | null = null, probe: Promise<void> = Promise.resolve();
process.on('message', raw => {
  if (!channel) {
    const message = readDeliveryWire(raw);
    channel = new LoggingDeliveryChannel(message.nonce, value => { process.send!(value); }, async (op, value) => {
      if (op === 'init') return { pid: process.pid };
      if (op === 'probe') return { nonce: crypto.randomUUID() }; // A fresh but unrelated response must never satisfy the parent's challenge.
      if (op === 'source.add') {
        const id = (value as string[])[0]!;
        probe = (async () => {
          await channel!.call('source.page', { id, acknowledge: ['never-committed'] }).catch(() => {});
          const event = loggingEvent('manufactured');
          await channel!.call('sink.append', { stream: 'audit', events: [event] }).catch(() => {});
          const page = await channel!.call('source.page', { id, acknowledge: [] }) as { rows: { id: string; event: ReturnType<typeof loggingEvent> }[] };
          if (page.rows[0]) await channel!.call('sink.append', { stream: 'audit', events: [{ ...page.rows[0].event, target: { type: 'record', id: 'changed' } }] }).catch(() => {});
          await channel!.call('source.page', { id, acknowledge: page.rows.map(row => row.id) }).catch(() => {});
        })();
        await probe; return null;
      }
      if (op === 'stop') { setTimeout(() => process.exit(0), 0); return null; }
      await probe; return null;
    }, () => {}, () => process.exit(70));
  }
  channel.receive(raw);
});
process.on('disconnect', () => process.exit(0));
