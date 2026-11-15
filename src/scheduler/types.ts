// ─── Scheduler Types ─────────────────────────────────────────────────────────

export interface JobDefinition {
  /** Unique job name. */
  name: string;
  /** Cron expression (6-field with seconds, or @daily/@hourly/etc). */
  pattern: string;
  /** The work to run. Capture app-local dependencies; honor the signal for cooperative shutdown. */
  run: (context: SchedulerRunContext) => void | Promise<void>;
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

/** One local invocation, not durable execution authority or a database lease. */
export interface SchedulerRunContext { readonly signal: AbortSignal }

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
