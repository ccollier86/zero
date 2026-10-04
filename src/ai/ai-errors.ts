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
  | 'AI_PROVIDER_CONFIG_INVALID'
  | 'AI_PROVIDER_INITIALIZATION_FAILED'
  | 'AI_PROVIDER_NOT_CONFIGURED'
  | 'AI_PROVIDER_NOT_ACTIVE'
  | 'AI_PROVIDER_RETIRED'
  | 'AI_MODEL_NOT_CONFIGURED'
  | 'AI_MODEL_INVALID'
  | 'AI_CAPABILITY_NOT_SUPPORTED'
  | 'AI_TOOL_INVALID'
  | 'AI_AGENT_DEFINITION_INVALID'
  | 'AI_AGENT_NOT_REGISTERED'
  | 'AI_AGENT_CONTEXT_INVALID'
  | 'AI_AGENT_APPROVAL_CONFIG_INVALID'
  | 'AI_AGENT_EXECUTION_LIMIT_EXCEEDED'
  | 'AI_AGENT_TOOL_EXECUTION_FAILED'
  | 'AI_AGENT_EXECUTION_TIMEOUT'
  | 'AI_AGENT_EXECUTION_CANCELLED'
  | 'AI_AGENT_EXECUTION_FAILED'
  | 'AI_REQUEST_INVALID'
  | 'AI_REQUEST_LIMIT_EXCEEDED'
  | 'AI_REQUEST_TIMEOUT'
  | 'AI_REQUEST_ABORTED'
  | 'AI_OUTPUT_INVALID'
  | 'AI_PROVIDER_RESPONSE_INVALID'
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
