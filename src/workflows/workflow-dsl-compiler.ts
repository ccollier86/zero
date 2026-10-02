/** Deterministic lowering from the code DSL into raw workflow graph IR. */

import type {
  WorkflowChooseDsl,
  WorkflowDslNode,
  WorkflowFlow,
  WorkflowParallelDsl,
} from './workflow-dsl';
import {
  WORKFLOW_COMPILER_ID_PREFIX,
  WORKFLOW_GRAPH_SCHEMA_VERSION,
  type WorkflowGraphIR,
  type WorkflowIREdge,
  type WorkflowIRNode,
} from './workflow-ir';
import { WorkflowError } from './workflow-error';
import { normalizeWorkflowSchemaSnapshot } from './workflow-schema-snapshot';

interface SequenceResult {
  entry: string | null;
  exits: string[];
}

/** Lower a flow without validating or freezing it; the public compiler owns that boundary. */
export function compileWorkflowFlowGraph(flowValue: WorkflowFlow): WorkflowGraphIR {
  if (!flowValue || flowValue.kind !== 'flow' || !Array.isArray(flowValue.nodes)) {
    invalid('Workflow flow must be created with flow()');
  }
  if (flowValue.nodes.length === 0) invalid('Workflow flow must define at least one node');
  const compiler = new FlowCompiler();
  const sequence = compiler.sequence(flowValue.nodes);
  if (!sequence.entry) invalid('Workflow flow must define at least one executable node');
  return {
    schemaVersion: WORKFLOW_GRAPH_SCHEMA_VERSION,
    entry: sequence.entry,
    nodes: compiler.nodes,
    edges: compiler.edges,
  };
}

class FlowCompiler {
  readonly nodes: WorkflowIRNode[] = [];
  readonly edges: WorkflowIREdge[] = [];
  private edgeIndex = 0;

  sequence(values: readonly WorkflowDslNode[]): SequenceResult {
    let result: SequenceResult = { entry: null, exits: [] };
    for (const value of values) {
      const next = this.node(value);
      if (result.entry === null) result.entry = next.entry;
      else for (const exit of result.exits) this.connect(exit, next.entry!);
      result.exits = next.exits;
    }
    return result;
  }

  private node(value: WorkflowDslNode): SequenceResult {
    if (!value || typeof value !== 'object') invalid('Workflow flow contains an invalid node');
    if (value.kind === 'step') {
      this.nodes.push(compact({
        id: value.id,
        kind: 'activity',
        label: value.options.label,
        activity: value.activity,
        input: value.options.input,
        retries: value.options.retries,
        backoffMs: value.options.backoffMs,
        timeoutMs: value.options.timeoutMs,
      }) as unknown as WorkflowIRNode);
      return { entry: value.id, exits: [value.id] };
    }
    if (value.kind === 'waitFor' || value.kind === 'requestAndWait') {
      const interaction = value.kind === 'requestAndWait' ? compact({
        delivery: value.options.delivery,
        validator: value.options.validator,
        maxRejections: value.options.maxRejections,
        request: value.options.request,
      }) : undefined;
      this.nodes.push(compact({
        id: value.id,
        kind: 'wait',
        label: value.options.label,
        event: value.event,
        timeoutMs: value.options.timeoutMs,
        inputSchema: serializableSchema(value.options.inputSchema),
        interaction,
      }) as unknown as WorkflowIRNode);
      return { entry: value.id, exits: [value.id] };
    }
    if (value.kind === 'choose') return this.choose(value);
    if (value.kind === 'parallel') return this.parallel(value);
    if (value.kind === 'each') {
      this.nodes.push(compact({
        id: value.id,
        kind: 'each',
        label: value.options.label,
        source: value.source,
        itemSchema: serializableSchema(value.options.itemSchema),
        itemKey: value.options.itemKey,
        concurrency: value.options.concurrency ?? 1,
        onInvalid: value.options.onInvalid ?? 'fail',
        onError: value.options.onError ?? 'fail',
        body: compileWorkflowFlowGraph(value.body),
      }) as unknown as WorkflowIRNode);
      return { entry: value.id, exits: [value.id] };
    }
    return invalid(`Unsupported workflow DSL node "${String((value as { kind?: unknown }).kind)}"`);
  }

  private choose(value: WorkflowChooseDsl): SequenceResult {
    const join = `${WORKFLOW_COMPILER_ID_PREFIX}${value.id}/join`;
    this.nodes.push(compact({
      id: value.id,
      kind: 'choice',
      label: value.label,
      join,
    }) as unknown as WorkflowIRNode);
    this.nodes.push({ id: join, kind: 'join', parent: value.id, strategy: 'all' });
    for (const [index, branch] of value.branches.entries()) {
      const compiled = this.sequence(branch.body.nodes);
      const target = compiled.entry ?? join;
      this.connect(value.id, target, compact({
        branch: branch.kind === 'otherwise' ? 'otherwise' : `when.${index}`,
        order: index,
        condition: branch.kind === 'when' ? branch.condition : undefined,
        default: branch.kind === 'otherwise' ? true : undefined,
      }));
      for (const exit of compiled.exits) this.connect(exit, join);
    }
    return { entry: value.id, exits: [join] };
  }

  private parallel(value: WorkflowParallelDsl): SequenceResult {
    const join = `${WORKFLOW_COMPILER_ID_PREFIX}${value.id}/join`;
    this.nodes.push(compact({ id: value.id, kind: 'parallel', label: value.label, join }) as unknown as WorkflowIRNode);
    this.nodes.push({ id: join, kind: 'join', parent: value.id, strategy: 'all' });
    for (const [name, branch] of Object.entries(value.branches)
      .sort(([left], [right]) => compareCodeUnits(left, right))) {
      const compiled = this.sequence(branch.nodes);
      if (!compiled.entry) invalid(`Workflow parallel branch "${name}" must not be empty`);
      this.connect(value.id, compiled.entry, { branch: name });
      for (const exit of compiled.exits) this.connect(exit, join);
    }
    return { entry: value.id, exits: [join] };
  }

  private connect(from: string, to: string, fields: Partial<WorkflowIREdge> = {}): void {
    const id = `edge.${String(this.edgeIndex).padStart(6, '0')}`;
    this.edgeIndex += 1;
    this.edges.push({ id, from, to, ...fields });
  }
}

function serializableSchema(value: unknown) {
  return value === undefined ? undefined : normalizeWorkflowSchemaSnapshot(value);
}

function compact<T extends Record<string, unknown>>(value: T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function invalid(message: string): never {
  throw new WorkflowError(message, 'WORKFLOW_GRAPH_INVALID', 422);
}
