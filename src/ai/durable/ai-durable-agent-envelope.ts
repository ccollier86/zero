/** Safe parsing for the payload-free public durable-agent workflow envelope. */

import { AIError } from '../ai-errors';
import type { AIDurableAgentPublicEnvelope } from './ai-durable-agent-types';
import { AI_DURABLE_AGENT_STATE_VERSION } from './ai-durable-agent-types';

export function readAIDurablePublicEnvelope(
  value: string | null,
): AIDurableAgentPublicEnvelope | null {
  let parsed: unknown;
  try {
    parsed = value === null ? null : JSON.parse(value);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  const agent = record.agent;
  if (record.kind !== 'zero.ai.durable-agent'
    || record.stateVersion !== AI_DURABLE_AGENT_STATE_VERSION
    || !agent || typeof agent !== 'object' || Array.isArray(agent)
    || typeof (agent as Record<string, unknown>).name !== 'string'
    || typeof (agent as Record<string, unknown>).version !== 'string') return null;
  return record as unknown as AIDurableAgentPublicEnvelope;
}

export function requireAIDurablePublicEnvelope(
  value: string | null,
): AIDurableAgentPublicEnvelope {
  const envelope = readAIDurablePublicEnvelope(value);
  if (envelope) return envelope;
  throw new AIError(
    'Durable AI agent run state is invalid.',
    'AI_AGENT_EXECUTION_FAILED',
    500,
  );
}
