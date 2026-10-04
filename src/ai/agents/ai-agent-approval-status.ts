/**
 * ai-agent-approval-status.ts
 *
 * Validates declarative tool-approval statuses shared by tool and agent
 * definitions. It does not evaluate policies or sign approval requests.
 */

import type { ToolApprovalStatus } from 'ai';

import { AIError } from '../ai-errors';

const STATUS = new Set(['not-applicable', 'approved', 'denied', 'user-approval']);
const STATUS_KEYS = new Set(['type', 'reason']);

/** Return true for an object-form SDK approval status. */
export function isAIAgentApprovalStatusObject(value: unknown): value is Exclude<ToolApprovalStatus, string | undefined> {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.prototype.hasOwnProperty.call(value, 'type');
}

/** Reject malformed approval rules before they reach the model loop. */
export function assertAIAgentApprovalRule(value: unknown, label: string): void {
  if (value === undefined || typeof value === 'function') return;
  if (typeof value === 'string') {
    if (STATUS.has(value)) return;
    throw invalid(`${label} has an unknown approval status.`);
  }
  if (!isAIAgentApprovalStatusObject(value)) {
    throw invalid(`${label} must be an approval status or policy function.`);
  }

  const status = (value as { type?: unknown }).type;
  const reason = (value as { reason?: unknown }).reason;
  if (typeof status !== 'string' || !STATUS.has(status)) {
    throw invalid(`${label} has an unknown approval status.`);
  }
  if (reason !== undefined && (typeof reason !== 'string' || reason.length > 512)) {
    throw invalid(`${label} reason must be a string of at most 512 characters.`);
  }
  if (status === 'not-applicable' && reason !== undefined) {
    throw invalid(`${label} cannot attach a reason to not-applicable.`);
  }
  for (const key of Object.keys(value)) {
    if (!STATUS_KEYS.has(key)) throw invalid(`${label} contains an unknown field: ${key}.`);
  }
}

function invalid(message: string): AIError {
  return new AIError(message, 'AI_AGENT_DEFINITION_INVALID', 400);
}

