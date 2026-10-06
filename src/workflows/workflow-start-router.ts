/** Select graph/persisted execution without letting legacy starts ignore pins. */

import { WorkflowError } from './workflow-error';
import type { WorkflowAccessPrincipal } from './workflow-access';
import type { WorkflowGraphRuntime } from './workflow-graph-runtime';
import type { WorkflowRegistry } from './workflow-registry';
import type { WorkflowStartOptions } from './workflow-start-options';
import type { WorkflowPersistedExecutionAuthority } from './workflow-execution-authority';

interface WorkflowGraphStartInput {
  graph: WorkflowGraphRuntime;
  registry: WorkflowRegistry;
  name: string;
  workflowInput: unknown;
  startedBy: string | null;
  authority: WorkflowPersistedExecutionAuthority;
  principal: WorkflowAccessPrincipal;
  options: WorkflowStartOptions;
  assertCurrentAuthority?: () => void;
}

export async function tryStartWorkflowGraph(input: WorkflowGraphStartInput): Promise<string | null> {
  const instanceId = tryCreateWorkflowGraph(input);
  if (instanceId) await input.graph.advance(instanceId);
  return instanceId;
}

/** Select and create graph state without awaiting or executing application work. */
export function tryCreateWorkflowGraph(input: WorkflowGraphStartInput): string | null {
  const compiled = input.registry.getCompiledWorkflow(input.name);
  if (input.graph.hasPersistedDefinition(input.name, input.authority)) {
    return input.graph.createPersisted(
      input.name,
      input.workflowInput,
      input.startedBy,
      input.authority,
      input.principal,
      input.options,
      input.assertCurrentAuthority,
    );
  }
  if (compiled && compiled.format !== 'legacy') {
    return input.graph.createRegistered(
      compiled,
      input.workflowInput,
      input.startedBy,
      input.authority,
      input.principal,
      input.options,
      input.assertCurrentAuthority,
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
    return input.graph.createPersisted(
      input.name,
      input.workflowInput,
      input.startedBy,
      input.authority,
      input.principal,
      input.options,
      input.assertCurrentAuthority,
    );
  } catch (error) {
    if (!(error instanceof WorkflowError)
      || error.code !== 'WORKFLOW_VERSION_NOT_FOUND') throw error;
    return null;
  }
}
