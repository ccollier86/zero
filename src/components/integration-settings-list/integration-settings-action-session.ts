/** Local single-flight/lifetime fence for callbacks; it does not perform transport or auth. */

export const INTEGRATION_SETTINGS_ACTION_ERROR = 'Unable to complete this action. Please try again.';
export interface IntegrationSettingsActionSnapshot {
  readonly pending: boolean;
  readonly error: string | null;
}
const IDLE: IntegrationSettingsActionSnapshot = Object.freeze({ pending: false, error: null });
export type IntegrationSettingsActionOutcome = 'completed' | 'failed' | 'retired' | 'blocked';

/** Own one row/header action until its current target/capability or mount is retired. */
export class IntegrationSettingsActionSession {
  private active = false;
  private epoch = 0;
  private pending: AbortController | null = null;
  private snapshot = IDLE;
  private readonly listeners = new Set<() => void>();

  activate(): void { this.active = true; this.epoch += 1; }
  retire(): void {
    this.active = false; this.epoch += 1;
    this.pending?.abort(); this.pending = null; this.publish(IDLE);
  }
  /** Retire changed capabilities without making this mounted session unusable. */
  invalidate(): void {
    this.epoch += 1; this.pending?.abort(); this.pending = null; this.publish(IDLE);
  }
  getSnapshot = (): IntegrationSettingsActionSnapshot => this.snapshot;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener); return () => { this.listeners.delete(listener); };
  };

  /** Lock synchronously; every callback/result is checked against current scope and target. */
  async run(input: {
    readonly isCurrent: () => boolean;
    readonly onSelect: (signal: AbortSignal) => void | Promise<void>;
    readonly onCompleted?: () => void;
    readonly onFailed: (error: unknown) => void;
  }): Promise<IntegrationSettingsActionOutcome> {
    if (!this.active || this.pending || !input.isCurrent()) return 'blocked';
    const controller = new AbortController(), epoch = this.epoch;
    this.pending = controller;
    this.publish(Object.freeze({ pending: true, error: null }));
    const current = () => this.active && this.epoch === epoch && this.pending === controller
      && !controller.signal.aborted && input.isCurrent();
    try {
      await Promise.resolve();
      if (!current()) { controller.abort(); return 'retired'; }
      await input.onSelect(controller.signal);
      if (!current()) { controller.abort(); return 'retired'; }
      input.onCompleted?.();
      return 'completed';
    } catch (cause) {
      if (!current()) { controller.abort(); return 'retired'; }
      this.publish(Object.freeze({ pending: false, error: INTEGRATION_SETTINGS_ACTION_ERROR }));
      input.onFailed(cause);
      return 'failed';
    } finally {
      if (this.pending === controller) {
        this.pending = null;
        if (this.snapshot.pending) {
          this.publish(Object.freeze({ ...this.snapshot, pending: false }));
        }
      }
    }
  }

  private publish(snapshot: IntegrationSettingsActionSnapshot): void {
    this.snapshot = snapshot;
    for (const listener of this.listeners) listener();
  }
}
