/** Typed, versioned application actions with finite approved values, not free-form messages or bodies. */
import type { LoggingContext, LoggingEvent, LoggingFamily, LoggingOutcome, LoggingScalar } from './logging-contracts';
import { LOGGING_FAMILIES, LOGGING_OUTCOMES } from './logging-contracts';
import { captureLoggingEvent, loggingArray, loggingChoice, loggingCode, loggingId, loggingRecord, loggingTime, invalid } from './logging-validation';
import { isLoggingApprovedScalar, LOGGING_SENSITIVE_FIELD } from './logging-activity-values';

export type LoggingActionValues = Readonly<Record<string, readonly LoggingScalar[]>>;
export interface LoggingActionDefinition<T extends LoggingActionValues = LoggingActionValues> {
  readonly code: string;
  readonly version: string;
  readonly label: string;
  readonly family: LoggingFamily;
  readonly values: T;
}
export interface LoggingActionInput<T extends LoggingActionValues = LoggingActionValues> {
  readonly id: string;
  /** Keep this and id unchanged when reconciling an unknown append acknowledgment. */
  readonly occurredAt: number;
  readonly outcome: LoggingOutcome;
  readonly target?: Readonly<{ type: string; id: string }>;
  readonly values: Readonly<{ [K in keyof T]: T[K][number] }>;
}
/** Define once in trusted server code. Labels/vocabularies must be static and contain no private record content. */
export function defineLoggingAction<const T extends LoggingActionValues>(definition: LoggingActionDefinition<T>): LoggingActionDefinition<T> {
  const r = loggingRecord(definition, ['code', 'version', 'label', 'family', 'values']);
  const code = loggingCode(r.code), version = loggingId(r.version)!;
  if (!code.startsWith('app.') || typeof r.label !== 'string' || !r.label || r.label.length > 120 || /[\u0000-\u001f\u007f]/.test(r.label)) invalid();
  const raw = loggingRecord(r.values), values: Record<string, readonly LoggingScalar[]> = Object.create(null);
  if (Object.keys(raw).length > 30) invalid();
  for (const [key, vocabulary] of Object.entries(raw)) {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,55}$/.test(key) || LOGGING_SENSITIVE_FIELD.test(key)) invalid();
    const allowed = loggingArray(vocabulary, 64);
    if (!allowed.length || allowed.some(value => !isLoggingApprovedScalar(value)) || new Set(allowed).size !== allowed.length) invalid();
    values[key] = Object.freeze([...allowed]) as readonly LoggingScalar[];
  }
  return Object.freeze({ code, version, label: r.label, family: loggingChoice(r.family, LOGGING_FAMILIES), values: Object.freeze(values) }) as LoggingActionDefinition<T>;
}
export function captureLoggingAction(context: LoggingContext, rawDefinition: LoggingActionDefinition, input: LoggingActionInput): LoggingEvent {
  const definition = defineLoggingAction(rawDefinition), r = loggingRecord(input, ['id', 'occurredAt', 'outcome', 'target', 'values']);
  const supplied = loggingRecord(r.values, Object.keys(definition.values)), metadata: Record<string, LoggingScalar> = {
    actionName: definition.label, actionVersion: definition.version,
  };
  for (const [key, vocabulary] of Object.entries(definition.values)) {
    if (!Object.hasOwn(supplied, key) || !isLoggingApprovedScalar(supplied[key]) || !vocabulary.includes(supplied[key])) invalid();
    metadata['value_' + key] = supplied[key];
  }
  return captureLoggingEvent(context, { id: loggingId(r.id)!, family: definition.family, action: definition.code,
    occurredAt: loggingTime(r.occurredAt), outcome: loggingChoice(r.outcome, LOGGING_OUTCOMES), evidence: 'server-confirmed',
    ...(r.target === undefined ? {} : { target: r.target as LoggingActionInput['target'] }), metadata }, Object.keys(metadata));
}
