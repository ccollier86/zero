/**
 * ai-errors.ts
 *
 * Defines domain errors for Zero's internal AI layer. This file owns stable
 * machine-readable AI error codes only; it does not call providers, inspect
 * environment variables, or register HTTP routes.
 */

/** Machine-readable AI error codes returned by the AI service and plugin. */
export type AIErrorCode =
  | 'AI_DISABLED'
  | 'AI_PROVIDER_NOT_CONFIGURED'
  | 'AI_PROVIDER_NOT_ACTIVE'
  | 'AI_MODEL_NOT_CONFIGURED'
  | 'AI_MODEL_INVALID'
  | 'AI_CAPABILITY_NOT_SUPPORTED'
  | 'AI_TOOL_INVALID'
  | 'AI_REQUEST_FAILED';

/** Structured error for platform AI operations. */
export class AIError extends Error {
  /**
   * Create an AI domain error with a stable code and HTTP-shaped status.
   *
   * The status is used by the optional AI status/plugin routes; framework-free
   * service callers can inspect `code` instead.
   */
  constructor(
    message: string,
    public readonly code: AIErrorCode,
    public readonly status = 500
  ) {
    super(message);
    this.name = 'AIError';
  }
}
