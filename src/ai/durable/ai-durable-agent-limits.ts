/**
 * ai-durable-agent-limits.ts
 *
 * Defines the durable bridge's explicit private-state envelope. Torrent keeps
 * its conservative defaults for ordinary workflows; durable AI runs request
 * this larger, still platform-bounded policy per instance.
 */

import type { WorkflowMemoryLimits } from '../../workflows/workflow-memory-policy';

/** Maximum canonical JSON bytes held by any one chunked durable value. */
export const AI_DURABLE_AGENT_MAX_PRIVATE_VALUE_BYTES = 10 * 1024 * 1024;

/** Maximum exact SQLite JSON-value bytes available to durable private state. */
export const AI_DURABLE_AGENT_MAX_PRIVATE_STATE_BYTES = 14 * 1024 * 1024;

/** Maximum private rows available before Torrent's scoped ceiling is reached. */
export const AI_DURABLE_AGENT_MAX_PRIVATE_STATE_ENTRIES = 3_584;

/**
 * Definition-time envelope for context plus cumulative tool-result payloads.
 * Remaining private capacity is reserved for prompts, model turns, manifests,
 * approvals, and bounded control metadata.
 */
export const AI_DURABLE_AGENT_MAX_CONTEXT_AND_TOOL_BYTES = 8 * 1024 * 1024;

/** Persisted per-run Torrent policy. Global workflow defaults remain unchanged. */
export const AI_DURABLE_AGENT_WORKFLOW_MEMORY_LIMITS: Readonly<WorkflowMemoryLimits> =
  Object.freeze({
    maxKeyBytes: 256,
    maxValueBytes: 64 * 1024,
    maxEntries: 4_096,
    maxTotalBytes: 16 * 1024 * 1024,
  });
