/** Managed delivery subprocess supervisor and fixed-capability broker. Source scheduling, source retries and event batching run in the child. */
import { databaseActorFactoryLaunch, type SubprocessDatabaseExecutorFactory } from '../databases/subprocess-database-executor-factory';
import { SubprocessDatabaseWorkingDirectory } from '../databases/subprocess-database-working-directory';
import type { ResolvedLoggingConfig } from './logging-config';
import type { LoggingEvent, LoggingReceipt, LoggingStream } from './logging-contracts';
import type { LoggingAppendResult } from './logging-fabric-store';
import { LoggingError } from './logging-error';
import { LoggingDeliveryChannel } from './logging-delivery-channel';
import { deliveryIdentity, LOGGING_DELIVERY_FLAG, LOGGING_DELIVERY_MAX_SOURCES, readDeliveryAppend, readDeliveryProbe,
  type DeliverySourcePort, type DeliverySourceRegistration, type DeliverySourceState } from './logging-delivery-protocol';
import { LOGGING_MAX_BATCH, LOGGING_MAX_BATCH_BYTES, loggingArray, loggingByteLength, loggingCanonical, loggingChoice, loggingId, loggingRecord, normalizeLoggingEvent } from './logging-validation';

interface SourceGrant { identity: string; body: string; confirmed: boolean; event: LoggingEvent }
interface RegisteredSource { readonly port: DeliverySourcePort; state: DeliverySourceState; baseFailures: number; closing: boolean; busy: boolean; readonly grants: Map<string, SourceGrant> }
interface Session { readonly child: ReturnType<typeof Bun.spawn>; readonly channel: LoggingDeliveryChannel; readonly directory: SubprocessDatabaseWorkingDirectory }
const emptySource = (): DeliverySourceState => Object.freeze({ queued: 0, bytes: 0, failed: 0, pending: true, active: false });

/** One dedicated delivery process per logging owner; sink/source SQLite capabilities stay with their existing owners. */
export class LoggingDeliveryProcess {
  private readonly sources = new Map<string, RegisteredSource>();
  private readonly exposed = new Map<string, Set<SourceGrant>>();
  private readonly direct = new Map<string, Map<string, { count: number; event: LoggingEvent }>>();
  private readonly heldSources = new Set<RegisteredSource>();
  private readonly pending = new Set<Promise<unknown>>();
  private readonly credits = { audit: { count: 0, bytes: 0, acknowledged: 0, duplicates: 0, failed: 0 }, operational: { count: 0, bytes: 0, acknowledged: 0, duplicates: 0, failed: 0 } };
  private sourcePending = { audit: { count: 0, bytes: 0 }, operational: { count: 0, bytes: 0 } };
  private session: Session | null = null;
  private starting: Promise<void> | null = null;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private closeTask: Promise<void> | null = null;
  private closing = false;
  private restarts = 0;
  private generation = 0;
  private ready = false;
  private failures = 0;
  private lastReadyAt = 0;
  private readonly wakes = new Set<string>();
  private wakeQueued = false;

  private constructor(private readonly factory: SubprocessDatabaseExecutorFactory, private readonly queue: ResolvedLoggingConfig['queue'],
    private readonly append: (stream: LoggingStream, events: readonly LoggingEvent[]) => Promise<LoggingAppendResult>, private readonly onFailure: () => void) {}

  static async open(factory: SubprocessDatabaseExecutorFactory, queue: ResolvedLoggingConfig['queue'],
    append: (stream: LoggingStream, events: readonly LoggingEvent[]) => Promise<LoggingAppendResult>, onFailure: () => void = () => {}): Promise<LoggingDeliveryProcess> {
    const owner = new LoggingDeliveryProcess(factory, queue, append, onFailure);
    try { await owner.start(); return owner; }
    catch (error) {
      try { await owner.close(); }
      catch (cleanup) { throw new AggregateError([error, cleanup], 'Logging delivery startup and cleanup failed.'); }
      throw error;
    }
  }
  write(input: LoggingEvent): Promise<LoggingReceipt> {
    const event = normalizeLoggingEvent(input);
    const credit = this.credits[event.stream], bytes = loggingByteLength(event);
    if (this.closing) return Promise.reject(new LoggingError('LOGGING_CLOSED', 'Delivery intake is closed.'));
    if (!this.ready || !this.session) return Promise.reject(new LoggingError('LOGGING_NOT_READY', 'Delivery worker is recovering.'));
    if (credit.count >= this.queue.maxEvents || credit.bytes + bytes > this.queue.maxBytes) return Promise.reject(new LoggingError('LOGGING_BACKPRESSURE', 'Delivery intake capacity is exhausted.'));
    const identity = deliveryIdentity(event), body = loggingCanonical(event); let bodies = this.direct.get(identity); if (!bodies) this.direct.set(identity, bodies = new Map());
    const prior = bodies.get(body); bodies.set(body, { count: (prior?.count ?? 0) + 1, event });
    credit.count++; credit.bytes += bytes;
    const task = this.session.channel.call('write', event).then(raw => {
      const result = readDeliveryAppend({ receipts: [raw], sequence: { seq: 0 } }, [event]); return result.receipts[0]!;
    }).finally(() => {
      credit.count--; credit.bytes -= bytes; this.pending.delete(task);
      const admission = bodies!.get(body)!; admission.count--; if (!admission.count) bodies!.delete(body); if (!bodies!.size) this.direct.delete(identity);
    });
    this.pending.add(task); return task;
  }
  /** Fresh bounded child responsiveness, without flushing unrelated sources or creating audit events/receipts. */
  probe(nonce: string): Promise<void> {
    const input = readDeliveryProbe({ nonce });
    if (this.closing) return Promise.reject(new LoggingError('LOGGING_CLOSED', 'Delivery intake is closed.'));
    const session = this.session;
    if (!this.ready || !session) return Promise.reject(new LoggingError('LOGGING_NOT_READY', 'Delivery worker is recovering.'));
    const task = session.channel.call('probe', input, 5000).then(raw => {
      try {
        if (readDeliveryProbe(raw).nonce !== nonce) throw new LoggingError('LOGGING_RESPONSE_INVALID', 'Delivery worker challenge mismatch.');
      } catch (error) { this.failSession(session); throw error; }
      if (this.closing || !this.ready || this.session !== session) throw new LoggingError('LOGGING_NOT_READY', 'Delivery worker generation changed.');
    }).finally(() => { this.pending.delete(task); });
    this.pending.add(task); return task;
  }
  /** Register only a server-owned source port. Child requests cannot select a path, table or tenant. */
  registerSource(port: DeliverySourcePort): DeliverySourceRegistration {
    if (this.closing || this.sources.size >= LOGGING_DELIVERY_MAX_SOURCES) throw new LoggingError('LOGGING_BACKPRESSURE', 'Delivery source admission is unavailable.');
    const id = crypto.randomUUID(); const source: RegisteredSource = { port, state: emptySource(), baseFailures: 0, closing: false, busy: false, grants: new Map() };
    this.sources.set(id, source);
    if (this.ready) { const session = this.session!; void session.channel.call('source.add', [id]).catch(() => { this.failSession(session); }); }
    return Object.freeze({ id, wake: () => this.wake(id), flush: () => this.flushSources([id]), close: () => this.closeSources([id]), diagnostics: () => source.state });
  }
  async flushSources(ids: readonly string[]): Promise<void> {
    await this.start(); await this.session!.channel.call('source.flush', ids, 60000);
  }
  async closeSources(ids: readonly string[]): Promise<void> {
    const present = ids.filter(id => this.sources.has(id)); for (const id of present) this.sources.get(id)!.closing = true;
    if (!present.length) return;
    try { await this.start(); await this.session!.channel.call('source.close', present, 30000); }
    finally {
      // A dead worker has no right to acknowledge anything further. Join any
      // already admitted broker operation before disposing the source owner.
      await this.session?.channel.settled();
      for (const id of present) { const source = this.sources.get(id); if (source) { this.clearGrants(source); source.state = Object.freeze({ ...source.state, active: false }); } this.sources.delete(id); this.wakes.delete(id); }
    }
  }
  async flush(): Promise<void> { await this.start(); await this.session!.channel.call('flush', null, 60000); }
  diagnostics(stream: LoggingStream) {
    const credit = this.credits[stream];
    return Object.freeze({ state: this.closing ? 'closed' : 'open', pendingEvents: credit.count + this.sourcePending[stream].count, pendingBytes: credit.bytes + this.sourcePending[stream].bytes,
      acknowledged: credit.acknowledged, duplicates: credit.duplicates, failed: credit.failed });
  }
  workerDiagnostics() { return Object.freeze({ state: this.closing ? 'closed' : this.ready ? 'ready' : 'recovering', pid: this.ready ? this.session?.child.pid ?? null : null, generation: this.generation, restarts: this.restarts, failures: this.failures }); }
  close(): Promise<void> {
    if (this.closeTask) return this.closeTask;
    this.closing = true; if (this.restartTimer) clearTimeout(this.restartTimer); this.restartTimer = null;
    this.closeTask = (async () => {
      const admitted = await Promise.allSettled([...this.pending]);
      await this.starting?.catch(() => {});
      const session = this.session; let failure: unknown;
      if (session) {
        try { if (this.ready) await session.channel.call('stop', null, 20000); }
        catch (error) { failure = error; }
        finally { await this.terminate(session); }
      }
      this.ready = false; this.session = null;
      if (failure || admitted.some(r => r.status === 'rejected')) throw new LoggingError('LOGGING_OUTCOME_UNKNOWN', 'Delivery worker closed with unresolved admissions.', 'unknown');
    })();
    return this.closeTask;
  }
  private wake(id: string): void {
    const source = this.sources.get(id); if (!source || source.closing || this.closing) return;
    source.state = Object.freeze({ ...source.state, pending: true }); this.wakes.add(id);
    if (this.wakeQueued) return; this.wakeQueued = true;
    queueMicrotask(() => {
      this.wakeQueued = false; const ids = [...this.wakes]; this.wakes.clear();
      if (this.ready && ids.length) this.session!.channel.signal('source.wake', ids);
    });
  }
  private start(): Promise<void> {
    if (this.ready) return Promise.resolve(); if (this.starting) return this.starting;
    if (this.closing) return Promise.reject(new LoggingError('LOGGING_CLOSED', 'Delivery worker is closing.'));
    if (this.restartTimer) { clearTimeout(this.restartTimer); this.restartTimer = null; }
    this.starting = this.startOnce().finally(() => { this.starting = null; }); return this.starting;
  }
  private async startOnce(): Promise<void> {
    const launch = databaseActorFactoryLaunch(this.factory);
    if (!launch) throw new LoggingError('LOGGING_CONFIG_INVALID', 'Delivery worker requires a validated Fabric launch.');
    const directory = new SubprocessDatabaseWorkingDirectory(); let session: Session | null = null;
    try {
      const nonce = crypto.randomUUID(); this.generation++;
      const channel = new LoggingDeliveryChannel(nonce, message => { session!.child.send(message); },
        (op, value) => this.broker(session!, op, value), (op, value) => this.signal(session!, op, value), () => this.failSession(session),
        this.queue.maxEvents * 2 + 32, 16);
      const child = Bun.spawn({ cmd: [...launch.prefix, LOGGING_DELIVERY_FLAG, 'writer', '0'], env: { ...launch.env }, cwd: directory.prepare(),
        stdin: 'ignore', stdout: 'ignore', stderr: 'ignore', detached: true, serialization: 'advanced',
        ipc: message => channel.receive(message), onDisconnect: () => { if (!this.closing) this.failSession(session); else session?.channel.close(); },
        onExit: () => { if (session) void this.exited(session); } });
      session = { child, channel, directory }; this.session = session;
      const result = loggingRecord(await channel.call('init', { queue: this.queue }, 10000), ['pid']);
      if (result.pid !== child.pid) throw new LoggingError('LOGGING_RESPONSE_INVALID', 'Delivery worker identity mismatch.');
      for (const source of this.sources.values()) { source.baseFailures = source.state.failed; this.clearGrants(source); source.state = Object.freeze({ ...source.state, pending: true, active: false }); }
      if (this.sources.size) await channel.call('source.add', [...this.sources.keys()]);
      this.ready = true; this.lastReadyAt = Date.now();
    } catch (error) {
      const safe = error instanceof LoggingError ? error : new LoggingError('LOGGING_NOT_READY', 'Logging delivery worker could not start.');
      try { if (session) await this.terminate(session); else { const cleanup = directory.release(); if (cleanup) throw cleanup; } }
      catch (cleanup) { throw new AggregateError([safe, cleanup], 'Logging delivery launch cleanup failed.'); }
      finally { if (this.session === session) this.session = null; }
      throw safe;
    }
  }
  private failSession(session: Session | null): void { if (session && this.session === session) { this.ready = false; session.channel.close(); try { session.child.kill('SIGKILL'); } catch { /* Exit callback owns settlement. */ } } }
  private async exited(session: Session): Promise<void> {
    session.channel.close(); await session.channel.settled(); session.directory.release();
    if (this.session !== session) return;
    this.session = null; this.ready = false;
    this.sourcePending = { audit: { count: 0, bytes: 0 }, operational: { count: 0, bytes: 0 } };
    for (const source of this.sources.values()) { this.clearGrants(source); source.state = Object.freeze({ ...source.state, pending: true, active: false }); }
    if (!this.closing) {
      try { this.onFailure(); } catch { /* A diagnostic sink cannot discard source evidence or stop recovery. */ }
      this.failures++; this.restarts = Date.now() - this.lastReadyAt > 30000 ? 1 : this.restarts + 1;
      this.restartTimer = setTimeout(() => { this.restartTimer = null; void this.start().catch(() => { if (!this.session && !this.closing) this.scheduleFailedStart(); }); }, Math.min(30000, 1000 * 2 ** Math.min(5, this.restarts - 1)));
      this.restartTimer.unref?.();
    }
  }
  private scheduleFailedStart(): void {
    if (this.restartTimer || this.closing) return; this.restarts++; this.failures++;
    this.restartTimer = setTimeout(() => { this.restartTimer = null; void this.start().catch(() => this.scheduleFailedStart()); }, Math.min(30000, 1000 * 2 ** Math.min(5, this.restarts - 1))); this.restartTimer.unref?.();
  }
  private async terminate(session: Session): Promise<void> {
    session.channel.close();
    if (session.child.exitCode === null) {
      const graceful = await Promise.race([session.child.exited.then(() => true), Bun.sleep(1000).then(() => false)]);
      if (!graceful) { try { session.child.kill('SIGTERM'); } catch {} }
      const exited = await Promise.race([session.child.exited.then(() => true), Bun.sleep(1000).then(() => false)]);
      if (!exited) { try { session.child.kill('SIGKILL'); } catch {} }
      await session.child.exited;
    }
    await session.channel.settled(); const error = session.directory.release(); if (error) throw error;
  }
  private async broker(session: Session, op: string, value: unknown): Promise<unknown> {
    if (this.session !== session) throw new LoggingError('LOGGING_CLOSED', 'Stale delivery worker generation.');
    if (op === 'source.page') {
      const input = loggingRecord(value, ['id', 'acknowledge']), source = this.sources.get(loggingId(input.id)!);
      if (!source || source.busy) throw new LoggingError('LOGGING_FORBIDDEN', 'Delivery source capability is unavailable.');
      if (!this.heldSources.has(source) && this.heldSources.size >= 3) throw new LoggingError('LOGGING_BACKPRESSURE', 'Delivery source-page capacity is exhausted.');
      const ids = loggingArray(input.acknowledge, 256).map(id => loggingId(id)!);
      if (new Set(ids).size !== ids.length || ids.some(id => !source.grants.get(id)?.confirmed)) throw new LoggingError('LOGGING_FORBIDDEN', 'Source acknowledgment has no matching committed sink receipt.');
      source.busy = true; this.heldSources.add(source);
      try {
        // The fixed origin port has already validated and frozen every event
        // at its database boundary. Do not repeat full envelope reconstruction
        // on the app thread; the worker revalidates its received page as well.
        const page = await source.port.page(ids); this.clearGrants(source);
        if (this.session !== session) throw new LoggingError('LOGGING_CLOSED', 'Stale delivery worker generation.');
        if (page.rows.length > 256 || page.queued < page.rows.length || page.bytes < 0) throw new LoggingError('LOGGING_RESPONSE_INVALID', 'Invalid fixed source page.');
        if (page.rows.length) this.heldSources.add(source);
        for (const row of page.rows) {
          const grant = { identity: deliveryIdentity(row.event), body: loggingCanonical(row.event), confirmed: false, event: row.event };
          source.grants.set(row.id, grant); let grants = this.exposed.get(grant.identity); if (!grants) this.exposed.set(grant.identity, grants = new Set()); grants.add(grant);
        }
        return page;
      } finally { source.busy = false; if (!source.grants.size) this.heldSources.delete(source); }
    }
    if (op === 'sink.append') {
      const input = loggingRecord(value, ['stream', 'events']), stream = loggingChoice(input.stream, ['audit', 'operational'] as const);
      const bindings = loggingArray(input.events, LOGGING_MAX_BATCH).map(raw => {
        const row = loggingRecord(raw), identity = deliveryIdentity({ id: loggingId(row.id)!, sourceId: loggingId(row.sourceId)! }), body = loggingCanonical(row);
        const event = this.direct.get(identity)?.get(body)?.event ?? [...(this.exposed.get(identity) ?? [])].find(grant => grant.body === body)?.event;
        if (!event) throw new LoggingError('LOGGING_FORBIDDEN', 'Delivery batch has no matching source or direct admission.');
        return { event, identity, body };
      });
      const events = bindings.map(binding => binding.event);
      if (!events.length || loggingByteLength(events) > LOGGING_MAX_BATCH_BYTES || events.some(event => event.stream !== stream)) throw new LoggingError('LOGGING_EVENT_INVALID', 'Invalid delivery batch.');
      let result: LoggingAppendResult;
      try { result = readDeliveryAppend(await this.append(stream, events), events); }
      catch (error) { this.credits[stream].failed += events.length; throw error; }
      this.credits[stream].acknowledged += result.receipts.length; this.credits[stream].duplicates += result.receipts.filter(r => r.duplicate).length;
      for (const binding of bindings) {
        const grants = this.exposed.get(binding.identity); if (!grants) continue;
        for (const grant of grants) if (grant.body === binding.body) grant.confirmed = true;
      }
      return result;
    }
    throw new LoggingError('LOGGING_FORBIDDEN', 'Unknown delivery broker operation.');
  }
  private signal(session: Session, op: string, value: unknown): void {
    if (this.session !== session) return;
    if (op === 'pending') {
      const states = loggingRecord(value, ['audit', 'operational']);
      for (const stream of ['audit', 'operational'] as const) {
        const state = loggingRecord(states[stream], ['count', 'bytes']);
        if (![state.count, state.bytes].every(n => Number.isSafeInteger(n) && Number(n) >= 0) || Number(state.count) > 768 || Number(state.bytes) > 3 * 256 * 1024)
          throw new LoggingError('LOGGING_RESPONSE_INVALID', 'Invalid delivery queue counters.');
        this.sourcePending[stream] = { count: Number(state.count), bytes: Number(state.bytes) };
      }
      return;
    }
    const input = loggingRecord(value, ['id', 'state']), source = this.sources.get(loggingId(input.id)!); if (!source) return;
    if (op === 'source.failed') { try { source.port.failed(); } catch {} return; }
    if (op !== 'source.state') throw new LoggingError('LOGGING_RESPONSE_INVALID', 'Invalid delivery signal.');
    const state = loggingRecord(input.state, ['queued', 'bytes', 'failed', 'pending', 'active']);
    if (![state.queued, state.bytes, state.failed].every(n => Number.isSafeInteger(n) && Number(n) >= 0) || typeof state.pending !== 'boolean' || typeof state.active !== 'boolean') throw new LoggingError('LOGGING_RESPONSE_INVALID', 'Invalid delivery state.');
    source.state = Object.freeze({ queued: Number(state.queued), bytes: Number(state.bytes), failed: source.baseFailures + Number(state.failed), pending: state.pending, active: state.active });
    if (!state.active && !source.busy) this.clearGrants(source);
  }
  private clearGrants(source: RegisteredSource): void {
    for (const grant of source.grants.values()) { const entries = this.exposed.get(grant.identity); entries?.delete(grant); if (!entries?.size) this.exposed.delete(grant.identity); }
    source.grants.clear();
    this.heldSources.delete(source);
  }
}
