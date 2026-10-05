// ─── Scheduler Types ─────────────────────────────────────────────────────────

export interface JobDefinition {
  /** Unique job name. */
  name: string;
  /** Cron expression (6-field with seconds, or @daily/@hourly/etc). */
  pattern: string;
  /** The work to run. Capture any required app-local dependencies in this callback. */
  run: () => void | Promise<void>;
  /** IANA timezone. Default: system timezone. */
  timezone?: string;
  /** Start paused — must be resumed manually or via API. */
  paused?: boolean;
  /** Prevent overlapping runs. Default: true. */
  protect?: boolean;
  /**
   * Catch and report callback errors. False reports, then rethrows to the
   * runtime. Default: true.
   */
  catchErrors?: boolean;
}

export interface JobStatus {
  name: string;
  pattern: string;
  running: boolean;
  paused: boolean;
  stopped: boolean;
  busy: boolean;
  nextRun: string | null;
  previousRun: string | null;
}

export interface SchedulerPluginConfig {
  /** Prefix for API routes. Default: '/scheduler' */
  prefix?: string;
}
