/** Framework-neutral attachment state; presentation never determines execution completion. */
import type { VectorVisualizationAdapter, VectorVisualizationSnapshot, VectorVisualizationSearchInput, VectorVisualizationIngestInput } from '../../vector/visualization-types';

export interface VectorVisualizationObservation {
  readonly status: 'idle' | 'loading' | 'ready' | 'unavailable' | 'error';
  readonly snapshot: VectorVisualizationSnapshot | null;
  readonly error: string | null;
}
const EMPTY: VectorVisualizationObservation = Object.freeze({ status: 'idle', snapshot: null, error: null });
export class VectorVisualizationController {
  private state = EMPTY;
  private readonly listeners = new Set<() => void>();
  private generation = 0;
  private unsubscribe: (() => void) | null = null;
  private request: AbortController | null = null;
  private disposed = false;
  constructor(private readonly adapter: VectorVisualizationAdapter) {}
  getSnapshot = (): VectorVisualizationObservation => this.state;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  /** Observe a tool/chat/agent operation that already exists; never starts it again. */
  attach(id: string | null): void {
    this.observe(id);
  }
  /** Only a still-current attachment may seed the accepted HTTP snapshot. */
  private observe(id: string | null): number | null {
    const generation = this.retire(); if (this.disposed) return null;
    if (!id) { this.publish(EMPTY); return null; }
    this.publish({ status: 'loading', snapshot: null, error: null });
    const accept = (snapshot: VectorVisualizationSnapshot | null, baseline = false) => {
      if (generation !== this.generation || this.disposed) return;
      if (snapshot && snapshot.id !== id) { this.failure(generation); return; }
      if (snapshot && this.state.snapshot && snapshot.revision <= this.state.snapshot.revision) return;
      // A late absent HTTP baseline must not erase a newer live revision.
      if (!snapshot && baseline && this.state.snapshot) return;
      if (!snapshot && !baseline) { this.retire(); this.publish({ status: 'unavailable', snapshot: null, error: null }); return; }
      this.publish({ status: snapshot ? 'ready' : 'unavailable', snapshot, error: null });
    };
    try { const remove = this.adapter.subscribe(id, value => accept(value), () => this.failure(generation));
      if (generation !== this.generation || this.disposed) { remove(); return null; } this.unsubscribe = remove; }
    catch { this.failure(generation); return null; }
    this.request = new AbortController(); const signal = this.request.signal;
    // External adapters can throw before returning a promise as well as reject it.
    try {
      void Promise.resolve(this.adapter.get(id, signal)).then(value => accept(value, true))
        .catch(() => { if (!signal.aborted) this.failure(generation); });
    } catch { this.failure(generation); return null; }
    return generation;
  }
  async search(input: VectorVisualizationSearchInput): Promise<VectorVisualizationSnapshot> {
    if (!this.adapter.search) throw new Error('This visualization adapter cannot start searches.');
    return this.start(signal => this.adapter.search!(input, signal));
  }
  async ingest(input: VectorVisualizationIngestInput): Promise<VectorVisualizationSnapshot> {
    if (!this.adapter.ingest) throw new Error('This visualization adapter cannot start ingestion.');
    return this.start(signal => this.adapter.ingest!(input, signal));
  }
  async cancel(): Promise<VectorVisualizationSnapshot | null> {
    const id = this.state.snapshot?.id, generation = this.generation;
    if (!id || !this.adapter.cancel || this.disposed) return null;
    const next = await this.adapter.cancel(id);
    if (next && next.id !== id) throw new Error('Visualization cancellation identity mismatch.');
    if (generation === this.generation && next && next.revision > (this.state.snapshot?.revision ?? 0)) this.publish({ status: 'ready', snapshot: next, error: null });
    return next;
  }
  /** Detach is not backend cancel: observers can unmount without killing someone else's operation. */
  dispose(): void { if (this.disposed) return; this.disposed = true; this.retire(); this.listeners.clear(); this.state = EMPTY; }
  private async start(run: (signal: AbortSignal) => Promise<VectorVisualizationSnapshot>) {
    if (this.disposed) throw new DOMException('Visualization controller is disposed.', 'AbortError');
    const generation = this.retire(); this.request = new AbortController(); const signal = this.request.signal;
    this.publish({ status: 'loading', snapshot: null, error: null });
    try { const accepted = await run(signal);
      if (signal.aborted || generation !== this.generation || this.disposed) throw new DOMException('Visualization selection changed.', 'AbortError');
      const attached = this.observe(accepted.id);
      if (attached === null || attached !== this.generation || this.disposed) {
        throw new DOMException('Visualization could not be attached to the current authority.', 'AbortError');
      }
      if (!this.state.snapshot || accepted.revision > this.state.snapshot.revision) this.publish({ status: 'ready', snapshot: accepted, error: null }); return accepted;
    } catch (error) { if (!signal.aborted) this.failure(generation); throw error; }
  }
  private retire(): number {
    // Fence before calling external cleanup, which can synchronously deliver one last value.
    const generation = ++this.generation, request = this.request, unsubscribe = this.unsubscribe;
    this.request = null; this.unsubscribe = null; request?.abort();
    try { unsubscribe?.(); } catch { /* Detachment must still retire data if adapter cleanup fails. */ }
    return generation;
  }
  private failure(generation: number) { if (generation !== this.generation || this.disposed) return; this.retire(); this.publish({ status: 'error', snapshot: null, error: 'Visualization could not be observed. Reattach to retry the read.' }); }
  private publish(state: VectorVisualizationObservation) { this.state = Object.freeze(state); for (const listener of this.listeners) listener(); }
}
