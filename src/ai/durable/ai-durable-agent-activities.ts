/**
 * ai-durable-agent-activities.ts
 *
 * Composes the focused trusted activities used by Torrent's durable AI-agent
 * graph. Scheduling, persistence, model decisions, and tool execution remain
 * in their dedicated collaborators.
 */

import { AIDurableAgentActivityRuntime } from './ai-durable-agent-activity-runtime';
import { AIDurableAgentCompletionActivities } from './ai-durable-agent-completion-activities';
import { AIDurableAgentModelActivity } from './ai-durable-agent-model-activity';
import { AIDurableAgentToolActivity } from './ai-durable-agent-tool-activity';
import type { AIDurableAgentRuntimeOptions } from './ai-durable-agent-types';

export const AI_DURABLE_ACTIVITY_VERSION = '1' as const;
export const AI_DURABLE_ACTIVITIES = Object.freeze({
  decide: 'zero.ai.durable.decide',
  recordApproval: 'zero.ai.durable.record-approval',
  executeTool: 'zero.ai.durable.execute-tool',
  assemble: 'zero.ai.durable.assemble',
  finalize: 'zero.ai.durable.finalize',
  exhaust: 'zero.ai.durable.exhaust',
});

/** Trusted activity bundle installed once into an app workflow registry. */
export class AIDurableAgentActivities<EXECUTION_CONTEXT = undefined, TServices = unknown> {
  readonly decide;
  readonly recordApproval;
  readonly executeTool;
  readonly assemble;
  readonly finalize;
  readonly exhaust;

  constructor(options: AIDurableAgentRuntimeOptions<EXECUTION_CONTEXT, TServices>) {
    const runtime = new AIDurableAgentActivityRuntime(options);
    const model = new AIDurableAgentModelActivity(runtime);
    const tools = new AIDurableAgentToolActivity(runtime);
    const completion = new AIDurableAgentCompletionActivities(runtime);
    this.decide = model.execute;
    this.recordApproval = completion.recordApproval;
    this.executeTool = tools.execute;
    this.assemble = completion.assemble;
    this.finalize = completion.finalize;
    this.exhaust = completion.exhaust;
  }
}
