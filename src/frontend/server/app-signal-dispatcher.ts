export type AppShutdownSignal = 'SIGINT' | 'SIGTERM';
export type AppStopCallback = () => unknown | Promise<unknown>;

export interface AppSignalHost {
  on(signal: AppShutdownSignal, listener: () => void): void;
  off(signal: AppShutdownSignal, listener: () => void): void;
  exit(code: number): void;
}

export interface AppSignalDispatcherOptions {
  host: AppSignalHost;
  onSignal?: (signal: AppShutdownSignal) => void;
  onFailure?: (error: unknown) => void;
}

/** Process-shared signal fan-out that joins every registered app before exit. */
export class AppSignalDispatcher {
  private readonly stops = new Set<AppStopCallback>();
  private attached = false;
  private shuttingDown = false;
  private shutdown: Promise<void> | null = null;
  private readonly sigint = () => { void this.dispatch('SIGINT'); };
  private readonly sigterm = () => { void this.dispatch('SIGTERM'); };

  constructor(private readonly options: AppSignalDispatcherOptions) {}

  register(stop: AppStopCallback): () => void {
    if (this.shuttingDown) {
      throw new Error('[app] Cannot register a new app during process shutdown.');
    }
    this.stops.add(stop);
    this.attach();
    let registered = true;
    return () => {
      if (!registered) return;
      registered = false;
      this.stops.delete(stop);
      if (this.stops.size === 0 && !this.shuttingDown) this.detach();
    };
  }

  dispatch(signal: AppShutdownSignal): Promise<void> {
    if (this.shutdown) return this.shutdown;
    this.shuttingDown = true;
    try { this.options.onSignal?.(signal); } catch { /* shutdown must continue */ }
    this.shutdown = this.stopAllAndExit();
    return this.shutdown;
  }

  private async stopAllAndExit(): Promise<void> {
    let failed = false;
    while (this.stops.size > 0) {
      const batch = [...this.stops];
      for (const stop of batch) this.stops.delete(stop);
      const results = await Promise.allSettled(
        batch.map((stop) => Promise.resolve().then(stop))
      );
      for (const result of results) {
        if (result.status !== 'rejected') continue;
        failed = true;
        try { this.options.onFailure?.(result.reason); } catch { /* keep joining */ }
      }
    }
    this.detach();
    this.options.host.exit(failed ? 1 : 0);
  }

  private attach(): void {
    if (this.attached) return;
    this.attached = true;
    this.options.host.on('SIGINT', this.sigint);
    this.options.host.on('SIGTERM', this.sigterm);
  }

  private detach(): void {
    if (!this.attached) return;
    this.attached = false;
    this.options.host.off('SIGINT', this.sigint);
    this.options.host.off('SIGTERM', this.sigterm);
  }
}
