/** One browser activity tracker per SDK client, not per avatar/component. */
export interface PresenceActivityEnvironment {
  target: EventTarget;
  visibility: EventTarget;
  isVisible(): boolean;
  now(): number;
  schedule(callback: () => void, delay: number): ReturnType<typeof setInterval>;
  cancel(timer: ReturnType<typeof setInterval>): void;
}
const HUMAN_EVENTS = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'] as const;

/** Reports observations only through a non-buffering transport. Heartbeats are not activity. */
export class GuardianPresenceActivity {
  private timer: ReturnType<typeof setInterval> | null = null;
  private sequence = 0;
  private cadence = 0;
  private lastHumanAt = -Infinity;
  private dirtyActivity = false;
  private running = false;
  constructor(private readonly send: (value: { sequence: number; activity: boolean; visible: boolean }) => boolean,
    private readonly environment: PresenceActivityEnvironment | null = browserPresenceActivityEnvironment()) {}
  start(cadence: number): void {
    if (!this.environment || this.running && this.cadence === cadence) return;
    this.stop(); this.running = true; this.cadence = cadence; this.sequence = 0;
    for (const event of HUMAN_EVENTS) this.environment.target.addEventListener(event, this.activity, { passive: true });
    this.environment.visibility.addEventListener('visibilitychange', this.visibility);
    this.report();
    this.timer = this.environment.schedule(() => this.report(), cadence);
  }
  stop(): void {
    if (!this.environment) return;
    if (this.timer !== null) this.environment.cancel(this.timer);
    this.timer = null; this.running = false; this.sequence = 0; this.dirtyActivity = false;
    this.lastHumanAt = -Infinity;
    for (const event of HUMAN_EVENTS) this.environment.target.removeEventListener(event, this.activity);
    this.environment.visibility.removeEventListener('visibilitychange', this.visibility);
  }
  private readonly activity = (): void => {
    if (!this.running || !this.environment?.isVisible()) return;
    this.lastHumanAt = this.environment.now(); this.dirtyActivity = true;
  };
  private readonly visibility = (): void => { this.report(); };
  private report(): void {
    const environment = this.environment;
    if (!this.running || !environment) return;
    const visible = environment.isVisible();
    // Drop old observations instead of replaying activity after a baseline/reconnect delay.
    const activity = visible && this.dirtyActivity && environment.now() - this.lastHumanAt <= this.cadence * 2;
    const sent = this.send({ sequence: ++this.sequence, activity, visible });
    if (sent || !activity) this.dirtyActivity = false;
  }
}

export function browserPresenceActivityEnvironment(): PresenceActivityEnvironment | null {
  if (typeof window === 'undefined' || typeof document === 'undefined') return null;
  return { target: window, visibility: document, isVisible: () => document.visibilityState !== 'hidden',
    now: Date.now, schedule: (callback, delay) => setInterval(callback, delay), cancel: timer => clearInterval(timer) };
}
