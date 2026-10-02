/** Select graph/persisted execution without letting legacy starts ignore pins. */

import { WorkflowError } from './workflow-error';
import type { WorkflowGraphRuntime } from './workflow-graph-runtime';
import type { WorkflowRegistry } from './workflow-registry';
import type { WorkflowStartOptions } from './workflow-start-options';

export async function tryStartWorkflowGraph(input: {
  graph: WorkflowGraphRuntime;
  registry: WorkflowRegistry;
  name: string;
  workflowInput: unknown;
  startedBy: string | null;
  options: WorkflowStartOptions;
}): Promise<string | null> {
  const compiled = input.registry.getCompiledWorkflow(input.name);
  if (compiled && compiled.format !== 'legacy') {
    return input.graph.startRegistered(
      compiled, input.workflowInput, input.startedBy, input.options,
    );
  }
  if (compiled && input.options.version !== undefined) {
    throw new WorkflowError(
      'Legacy workflow definitions do not support version-pinned starts',
      'WORKFLOW_VERSION_CONFLICT',
      409,
    );
  }
  if (compiled) return null;
  try {
    return await input.graph.startPersisted(
      input.name, input.workflowInput, input.startedBy, input.options,
    );
  } catch (error) {
    if (!(error instanceof WorkflowError)
      || error.code !== 'WORKFLOW_VERSION_NOT_FOUND') throw error;
    return null;
  }
}
