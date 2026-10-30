/** Core logging capture presets and bounded writer policy. No services start and no existing audit is disabled. */
import { LOGGING_FAMILIES, LOGGING_LEVELS, LOGGING_PRESETS, type LoggingEvent, type LoggingFamily, type LoggingLevel, type LoggingPreset } from './logging-contracts';
import { invalid, loggingChoice, loggingRecord, LOGGING_MAX_BATCH } from './logging-validation';
import type { LoggingResourcePolicies } from './logging-activity-contracts';
import { normalizeLoggingResourcePolicies } from './logging-resource-policy';

export interface LoggingConfig {
  readonly preset?: LoggingPreset;
  readonly minimumLevel?: LoggingLevel;
  readonly capture?: Partial<Readonly<Record<LoggingFamily, boolean>>>;
  /** Technical HTTP stages are optional diagnostics, never record activity. Default: false. */
  readonly diagnostics?: Readonly<{ http?: boolean }>;
  /** Native table labels and explicitly approved field differences. Unknown values remain redacted. */
  readonly resources?: LoggingResourcePolicies;
  /** Static route-pattern labels. Never include dynamic record values, names, or raw URLs. */
  readonly pages?: Readonly<Record<string, string>>;
  /** Per-session/scope intake limits. Raise deliberately for fast reactive display histories, never to unbounded. */
  readonly browser?: Readonly<{ observationsPerMinute?: number; selectionsPerMinute?: number }>;
  readonly queue?: { readonly maxEvents?: number; readonly maxBytes?: number; readonly batchSize?: number };
}
export interface ResolvedLoggingConfig {
  readonly enabled: boolean;
  readonly preset: LoggingPreset;
  readonly minimumLevel: LoggingLevel;
  readonly capture: Readonly<Record<LoggingFamily, boolean>>;
  readonly diagnostics: Readonly<{ http: boolean }>;
  readonly resources: LoggingResourcePolicies;
  readonly pages: Readonly<Record<string, string>>;
  readonly browser: Readonly<{ observationsPerMinute: number; selectionsPerMinute: number }>;
  readonly queue: Readonly<{ maxEvents: number; maxBytes: number; batchSize: number }>;
  /** The managed composition must qualify durable sources, custody, admission and private evidence owners. */
  readonly complianceRequested: boolean;
}

const BASE = new Set<LoggingFamily>(['operational', 'security']);
const ACTIVITY = new Set<LoggingFamily>([...BASE, 'records', 'views', 'transfers', 'workflow', 'communications', 'ai', 'investigations', 'navigation']);

/** Resolve and detach capture policy. Omission preserves the existing platform runtime without enabling new storage. */
export function resolveLoggingConfig(value?: boolean | LoggingConfig): ResolvedLoggingConfig {
  try {
    const input = typeof value === 'boolean' || value === undefined ? {} : loggingRecord(value, ['preset', 'minimumLevel', 'capture', 'diagnostics', 'resources', 'pages', 'browser', 'queue'], 'LOGGING_CONFIG_INVALID');
    const preset = input.preset === undefined ? 'basic' : loggingChoice(input.preset, LOGGING_PRESETS);
    // Compliance adds guarantees, not indiscriminate browser surveillance.
    // Owned result views contain identity/duration only; clipboard/printing remain opt-in.
    const capture = Object.fromEntries(LOGGING_FAMILIES.map(family => [family, preset === 'detailed' || (preset === 'basic' ? BASE : ACTIVITY).has(family)])) as Record<LoggingFamily, boolean>;
    if (input.capture !== undefined) for (const [family, enabled] of Object.entries(loggingRecord(input.capture, LOGGING_FAMILIES, 'LOGGING_CONFIG_INVALID'))) {
      if (typeof enabled !== 'boolean' || preset === 'compliance' && family === 'security' && !enabled) invalid('LOGGING_CONFIG_INVALID');
      capture[family as LoggingFamily] = enabled;
    }
    const diagnostics = input.diagnostics === undefined ? {} : loggingRecord(input.diagnostics, ['http'], 'LOGGING_CONFIG_INVALID');
    const pages = input.pages === undefined ? {} : loggingRecord(input.pages, undefined, 'LOGGING_CONFIG_INVALID');
    if (Object.keys(pages).length > 4096 || Object.entries(pages).some(([pattern, label]) => !pattern.startsWith('/') || pattern.length > 1024 || /[?#\u0000-\u001f\u007f]/.test(pattern)
      || typeof label !== 'string' || !label || label.length > 120 || /[\u0000-\u001f\u007f]/.test(label))) invalid('LOGGING_CONFIG_INVALID');
    if (diagnostics.http !== undefined && typeof diagnostics.http !== 'boolean') invalid('LOGGING_CONFIG_INVALID');
    const queue = input.queue === undefined ? {} : loggingRecord(input.queue, ['maxEvents', 'maxBytes', 'batchSize'], 'LOGGING_CONFIG_INVALID');
    const browser = input.browser === undefined ? {} : loggingRecord(input.browser, ['observationsPerMinute', 'selectionsPerMinute'], 'LOGGING_CONFIG_INVALID');
    const observationsPerMinute = bound(browser.observationsPerMinute === undefined ? 240 : browser.observationsPerMinute, 1, 10000), selectionsPerMinute = bound(browser.selectionsPerMinute === undefined ? 240 : browser.selectionsPerMinute, 1, 10000);
    const maxEvents = bound(queue.maxEvents === undefined ? 1024 : queue.maxEvents, 1, 100_000);
    const maxBytes = bound(queue.maxBytes === undefined ? 8 * 1024 * 1024 : queue.maxBytes, 16_384, 64 * 1024 * 1024);
    const batchSize = bound(queue.batchSize === undefined ? Math.min(LOGGING_MAX_BATCH, maxEvents) : queue.batchSize, 1, Math.min(LOGGING_MAX_BATCH, maxEvents));
    return Object.freeze({ enabled: value !== undefined && value !== false, preset,
      minimumLevel: input.minimumLevel === undefined ? 'info' : loggingChoice(input.minimumLevel, LOGGING_LEVELS),
      capture: Object.freeze(capture), diagnostics: Object.freeze({ http: diagnostics.http === true }), resources: normalizeLoggingResourcePolicies(input.resources), pages: Object.freeze(pages as Record<string, string>),
      browser: Object.freeze({ observationsPerMinute, selectionsPerMinute }),
      queue: Object.freeze({ maxEvents, maxBytes, batchSize }), complianceRequested: preset === 'compliance' });
  } catch { return invalid('LOGGING_CONFIG_INVALID'); }
}

/** Only optional operational severity is filtered; required audit outcomes are not discarded as low-severity logs. */
export function loggingCaptures(config: ResolvedLoggingConfig, event: LoggingEvent): boolean {
  return config.enabled && config.capture[event.family]
    && (event.stream === 'audit' || LOGGING_LEVELS.indexOf(event.level) >= LOGGING_LEVELS.indexOf(config.minimumLevel));
}
function bound(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) invalid('LOGGING_CONFIG_INVALID');
  return value;
}
