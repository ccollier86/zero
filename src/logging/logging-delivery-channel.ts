/** Bounded, nonce-fenced bidirectional IPC. Owns pending requests/deadlines, not subprocesses, SQL or retry policy. */
import { LoggingError } from './logging-error';
import { deliveryError, deliveryFailure, LOGGING_DELIVERY_PROTOCOL, LOGGING_DELIVERY_VERSION, readDeliveryWire, type DeliveryWire } from './logging-delivery-protocol';

export class LoggingDeliveryChannel {
  private nextId = 0;
  private incomingId = 0;
  private closed = false;
  private readonly pending = new Map<number, { op: string; resolve(value: unknown): void; reject(error: unknown): void; timer: ReturnType<typeof setTimeout> }>();
  private readonly active = new Set<number>();
  private readonly jobs = new Set<Promise<void>>();
  constructor(readonly nonce: string, private readonly send: (message: DeliveryWire) => void,
    private readonly handle: (op: string, value: unknown) => Promise<unknown>, private readonly signalHandler: (op: string, value: unknown) => void,
    private readonly failed: () => void, private readonly capacity = 2048, private readonly incomingCapacity = 16) {}

  call(op: string, value: unknown, timeoutMs = 15000): Promise<unknown> {
    if (this.closed) return Promise.reject(new LoggingError('LOGGING_OUTCOME_UNKNOWN', 'Delivery channel is unavailable.', 'unknown'));
    if (this.pending.size >= this.capacity) return Promise.reject(new LoggingError('LOGGING_BACKPRESSURE', 'Delivery channel capacity is exhausted.'));
    const id = ++this.nextId;
    const message = this.message('call', id, op, value);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.close(); this.failed(); }, timeoutMs);
      this.pending.set(id, { op, resolve, reject, timer });
      try { this.send(message); }
      catch { this.close(); this.failed(); }
    });
  }
  signal(op: string, value: unknown): void {
    if (this.closed) return;
    try { this.send(this.message('signal', 0, op, value)); }
    catch { this.close(); this.failed(); }
  }
  receive(raw: unknown): void {
    if (this.closed) return;
    try {
      const message = readDeliveryWire(raw, this.nonce);
      if (message.type === 'signal' && message.id === 0 && message.error === undefined) { this.signalHandler(message.op, message.value); return; }
      if (message.type === 'reply') {
        const pending = this.pending.get(message.id);
        if (!pending || pending.op !== message.op) throw new Error();
        const failure = message.error ? deliveryError(message.error) : null;
        this.pending.delete(message.id); clearTimeout(pending.timer);
        if (failure) pending.reject(failure); else pending.resolve(message.value);
        return;
      }
      if (message.type !== 'call' || message.id <= this.incomingId || message.error !== undefined || this.active.has(message.id) || this.active.size >= this.incomingCapacity) throw new Error();
      this.incomingId = message.id;
      this.active.add(message.id);
      const job = Promise.resolve().then(() => this.handle(message.op, message.value)).then(value => {
        if (!this.closed) this.send(this.message('reply', message.id, message.op, value));
      }, error => { if (!this.closed) this.send(this.message('reply', message.id, message.op, null, deliveryFailure(error))); })
        .catch(() => { this.close(); this.failed(); }).finally(() => { this.active.delete(message.id); this.jobs.delete(job); });
      this.jobs.add(job);
    } catch { this.close(); this.failed(); }
  }
  /** Join already admitted local broker work before disposing its source/database owner. */
  async settled(): Promise<void> { await Promise.allSettled([...this.jobs]); }
  close(): void {
    if (this.closed) return; this.closed = true;
    for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(new LoggingError('LOGGING_OUTCOME_UNKNOWN', 'Delivery worker outcome is unresolved; retain the original event identity.', 'unknown')); }
    this.pending.clear();
  }
  private message(type: DeliveryWire['type'], id: number, op: string, value: unknown, error?: DeliveryWire['error']): DeliveryWire {
    const message: DeliveryWire = { protocol: LOGGING_DELIVERY_PROTOCOL, version: LOGGING_DELIVERY_VERSION, nonce: this.nonce, type, id, op, value, ...(error ? { error } : {}) };
    readDeliveryWire(message, this.nonce); return message;
  }
}
