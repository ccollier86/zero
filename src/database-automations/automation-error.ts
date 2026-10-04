/**
 * automation-error.ts
 *
 * Defines the closed ReactiveDB automation definition-error contract. This
 * file owns bounded, privacy-safe validation failures only; it does not log,
 * execute handlers, or choose an HTTP response.
 */

/** Stable failures emitted while defining or composing database automations. */
export const AUTOMATION_ERROR_CODES = Object.freeze([
  'AUTOMATION_DEFINITION_INVALID',
  'AUTOMATION_FUNCTION_DUPLICATE',
  'AUTOMATION_TRIGGER_DUPLICATE',
  'AUTOMATION_TARGET_MISSING',
  'AUTOMATION_TABLE_MISSING',
  'AUTOMATION_TABLE_INVALID',
] as const);

export type AutomationErrorCode = (typeof AUTOMATION_ERROR_CODES)[number];

/** Scalar operational metadata safe to expose during startup validation. */
export type AutomationErrorDetailValue = string | number | boolean | null;
export type AutomationErrorDetails = Readonly<
  Record<string, AutomationErrorDetailValue>
>;

export interface AutomationErrorOptions extends ErrorOptions {
  readonly details?: AutomationErrorDetails;
}

const CODE_SET: ReadonlySet<string> = new Set(AUTOMATION_ERROR_CODES);
const DETAIL_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/u;
const BLOCKED_DETAIL_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const MAX_MESSAGE_LENGTH = 1_024;
const MAX_DETAIL_ENTRIES = 16;
const MAX_DETAIL_STRING_LENGTH = 256;

/** Closed, non-retryable failure raised before an automation runtime starts. */
export class AutomationError extends Error {
  readonly retryable = false;
  readonly details: AutomationErrorDetails;

  constructor(
    readonly code: AutomationErrorCode,
    message: string,
    options: AutomationErrorOptions = {},
  ) {
    if (!isAutomationErrorCode(code)) {
      throw new TypeError('ReactiveDB automation error code is not recognized.');
    }
    super(normalizeMessage(message), options.cause === undefined
      ? undefined
      : { cause: options.cause });
    this.name = 'AutomationError';
    this.details = sanitizeDetails(options.details);
  }
}

/** Return true only for a code in the public automation error contract. */
export function isAutomationErrorCode(value: unknown): value is AutomationErrorCode {
  return typeof value === 'string' && CODE_SET.has(value);
}

/** Recognize a canonical local automation error without inspecting hostile data. */
export function isAutomationError(value: unknown): value is AutomationError {
  try {
    return value instanceof AutomationError;
  } catch {
    return false;
  }
}

function normalizeMessage(message: string): string {
  if (typeof message !== 'string') return 'ReactiveDB automation validation failed.';
  return (message.trim() || 'ReactiveDB automation validation failed.')
    .slice(0, MAX_MESSAGE_LENGTH);
}

function sanitizeDetails(
  details: AutomationErrorDetails | undefined,
): AutomationErrorDetails {
  if (details === undefined) return Object.freeze({});
  const result: Record<string, AutomationErrorDetailValue> = {};
  let count = 0;
  for (const [key, value] of Object.entries(details)) {
    if (count >= MAX_DETAIL_ENTRIES) break;
    if (!DETAIL_KEY_PATTERN.test(key) || BLOCKED_DETAIL_KEYS.has(key)) continue;
    if (value === null || typeof value === 'boolean') {
      result[key] = value;
      count += 1;
      continue;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      result[key] = value;
      count += 1;
      continue;
    }
    if (typeof value === 'string') {
      result[key] = value.slice(0, MAX_DETAIL_STRING_LENGTH);
      count += 1;
    }
  }
  return Object.freeze(result);
}
