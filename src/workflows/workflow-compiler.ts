/**
 * workflow-compiler.ts
 *
 * Compiles legacy definitions, the code DSL, and raw graph definitions into
 * one canonical, fingerprinted WorkflowGraphIR. Compilation is deterministic
 * and contains no runtime execution or persistence behavior.
 */

import type { TSchema } from 'elysia';
import type {
  WorkflowDefinition,
  WorkflowDefinitionAccessPolicy,
  StepDefinition,
} from './types';
import type { WorkflowFlow } from './workflow-dsl';
import {
  WORKFLOW_GRAPH_SCHEMA_VERSION,
  type WorkflowActivityReference,
  type WorkflowGraphIR,
  type WorkflowIRNode,
  type WorkflowJsonValue,
} from './workflow-ir';
import {
  canonicalizeWorkflowDefinition,
  canonicalWorkflowJson,
} from './workflow-definition-canonical';
import { validateWorkflowGraphIR } from './workflow-ir-validator';
import { WorkflowError } from './workflow-error';
import { compileWorkflowFlowGraph } from './workflow-dsl-compiler';
import { normalizeWorkflowSchemaSnapshot } from './workflow-schema-snapshot';

interface WorkflowDefinitionBase {
  name: string;
  /** Optional explicit publication version. */
  version?: number;
  /** Activate the published version immediately (default true). */
  activate?: boolean;
  inputSchema?: TSchema | WorkflowJsonValue;
  access?: WorkflowDefinitionAccessPolicy;
}

/** Code-authored graph input. Mutually exclusive with legacy steps and raw graph. */
export interface WorkflowFlowDefinition extends WorkflowDefinitionBase {
  flow: WorkflowFlow;
  steps?: never;
  graph?: never;
}

/** Canonical graph input, including definitions loaded from a database/API. */
export interface WorkflowGraphDefinition extends WorkflowDefinitionBase {
  graph: WorkflowGraphIR;
  steps?: never;
  flow?: never;
}

/** Every authoring format accepted by WorkflowRegistry. */
export type WorkflowDefinitionInput =
  | WorkflowDefinition
  | WorkflowFlowDefinition
  | WorkflowGraphDefinition;

export type WorkflowDefinitionFormat = 'legacy' | 'flow' | 'graph';
export type WorkflowDefinitionAuthoringSource = 'code' | 'database';

/** Canonical result consumed by version persistence and the graph runtime. */
export interface CompiledWorkflowDefinition {
  name: string;
  format: WorkflowDefinitionFormat;
  authoringSource: WorkflowDefinitionAuthoringSource;
  graph: WorkflowGraphIR;
  graphJson: string;
  fingerprint: string;
  version?: number;
  activate: boolean;
  inputSchema?: WorkflowJsonValue;
  access?: WorkflowDefinitionAccessPolicy;
  /** Exact legacy steps retained for the 1.3 sequential runtime bridge. */
  legacySteps?: readonly StepDefinition[];
}

export interface CompileWorkflowDefinitionOptions {
  authoringSource?: WorkflowDefinitionAuthoringSource;
  /** Resolve and pin every trusted activity reference before fingerprinting. */
  resolveActivity?: (reference: WorkflowActivityReference) => WorkflowActivityReference;
}

/** Compile one mutually exclusive definition input into canonical graph state. */
export function compileWorkflowDefinition(
  definition: WorkflowDefinitionInput,
  options: CompileWorkflowDefinitionOptions = {},
): CompiledWorkflowDefinition {
  if (options.authoringSource !== undefined
    && options.authoringSource !== 'code'
    && options.authoringSource !== 'database') {
    invalid('Workflow authoringSource must be "code" or "database"');
  }
  validateDefinitionEnvelope(definition);
  const hasSteps = Object.prototype.hasOwnProperty.call(definition, 'steps');
  const hasFlow = Object.prototype.hasOwnProperty.call(definition, 'flow');
  const hasGraph = Object.prototype.hasOwnProperty.call(definition, 'graph');
  if (Number(hasSteps) + Number(hasFlow) + Number(hasGraph) !== 1) {
    invalid(`Workflow "${definition.name}" must define exactly one of steps, flow, or graph`);
  }

  let format: WorkflowDefinitionFormat;
  let graph: WorkflowGraphIR;
  let legacySteps: readonly StepDefinition[] | undefined;
  if (hasSteps) {
    format = 'legacy';
    legacySteps = Object.freeze((definition as WorkflowDefinition).steps.map((step) => Object.freeze({ ...step })));
    graph = canonicalizeWorkflowGraphIR(compileLegacySteps(legacySteps), {
      allowLegacyCompatibility: true,
    });
  } else if (hasFlow) {
    format = 'flow';
    graph = compileFlow((definition as WorkflowFlowDefinition).flow);
  } else {
    format = 'graph';
    graph = canonicalizeWorkflowGraphIR((definition as WorkflowGraphDefinition).graph);
  }
  if (options.resolveActivity) {
    graph = canonicalizeWorkflowGraphIR(
      resolveGraphActivities(graph, options.resolveActivity),
      { allowLegacyCompatibility: format === 'legacy' },
    );
  }

  const graphJson = stableWorkflowStringify(graph);
  let inputSchema: WorkflowJsonValue | undefined;
  try {
    inputSchema = definition.inputSchema === undefined
      ? undefined
      : normalizeWorkflowSchemaSnapshot(definition.inputSchema);
  } catch (error) {
    // The 1.3 service historically reports a malformed legacy input schema at
    // start, before persistence. Preserve that rollout contract; new graph
    // definitions fail registration because their immutable version cannot be
    // fingerprinted safely.
    if (format !== 'legacy') throw error;
    inputSchema = undefined;
  }
  const access = definition.access === undefined
    ? undefined
    : deepFreeze(cloneJson(definition.access));
  if (inputSchema !== undefined) deepFreeze(inputSchema);
  const fingerprint = fingerprintWorkflowDefinitionContent(
    graph,
    inputSchema,
    access,
    format,
  );
  return Object.freeze({
    name: definition.name,
    format,
    authoringSource: options.authoringSource ?? 'code',
    graph,
    graphJson,
    fingerprint,
    ...(definition.version === undefined ? {} : { version: definition.version }),
    activate: definition.activate ?? true,
    ...(inputSchema === undefined ? {} : { inputSchema }),
    ...(access === undefined ? {} : { access }),
    ...(legacySteps === undefined ? {} : { legacySteps }),
  });
}

function resolveGraphActivities(
  graph: WorkflowGraphIR,
  resolve: (reference: WorkflowActivityReference) => WorkflowActivityReference,
): WorkflowGraphIR {
  return {
    ...graph,
    nodes: graph.nodes.map((node) => {
      if (node.kind === 'activity') return { ...node, activity: resolve(node.activity) };
      if (node.kind === 'each') {
        return { ...node, body: resolveGraphActivities(node.body, resolve) };
      }
      if (node.kind === 'wait' && node.interaction) {
        const delivery = node.interaction.delivery?.map((invocation) => ({
          ...invocation,
          activity: resolve(invocation.activity),
        }));
        const validator = node.interaction.validator
          ? resolve(node.interaction.validator)
          : undefined;
        return {
          ...node,
          interaction: {
            ...node.interaction,
            ...(delivery === undefined ? {} : { delivery }),
            ...(validator === undefined ? {} : { validator }),
          },
        };
      }
      return node;
    }),
  };
}

/** Compile an ordered DSL flow into the canonical graph representation. */
export function compileFlow(flowValue: WorkflowFlow): WorkflowGraphIR {
  return canonicalizeWorkflowGraphIR(compileWorkflowFlowGraph(flowValue));
}

/** Validate, clone, sort, and deeply freeze a graph for stable persistence. */
export function canonicalizeWorkflowGraphIR(
  graph: WorkflowGraphIR,
  options: { allowLegacyCompatibility?: boolean } = {},
): WorkflowGraphIR {
  validateWorkflowGraphIR(graph, options);
  const clone = cloneJson(graph) as unknown as WorkflowGraphIR;
  return deepFreeze(canonicalizeClonedGraph(clone));
}

function canonicalizeClonedGraph(graph: WorkflowGraphIR): WorkflowGraphIR {
  const nodes = graph.nodes.map((node) => node.kind === 'each'
    ? { ...node, body: canonicalizeClonedGraph(node.body) }
    : node).sort((left, right) => compareCodeUnits(left.id, right.id));
  const edges = [...graph.edges].sort((left, right) => compareCodeUnits(left.id, right.id));
  return {
    schemaVersion: WORKFLOW_GRAPH_SCHEMA_VERSION,
    entry: graph.entry,
    nodes,
    edges,
  };
}

/**
 * Fingerprint the exact immutable definition-version content contract.
 * Persistence should call this function too, preventing compiler/store drift.
 */
export function fingerprintWorkflowDefinitionContent(
  graph: WorkflowGraphIR,
  inputSchema?: unknown,
  accessPolicy?: unknown,
  graphFormat: WorkflowDefinitionFormat = 'graph',
): string {
  try {
    const canonicalGraph = canonicalizeWorkflowGraphIR(graph, {
      allowLegacyCompatibility: graphFormat === 'legacy',
    });
    return canonicalizeWorkflowDefinition({
      schemaVersion: WORKFLOW_GRAPH_SCHEMA_VERSION,
      graph: canonicalGraph,
      graphFormat,
      inputSchema: inputSchema === undefined
        ? undefined
        : normalizeWorkflowSchemaSnapshot(inputSchema),
      accessPolicy: accessPolicy === undefined ? undefined : cloneJsonForFingerprint(accessPolicy),
    }).fingerprint;
  } catch (error) {
    if (error instanceof WorkflowError) throw error;
    return invalid(error instanceof Error ? error.message : 'Workflow definition is invalid');
  }
}

/** Stable JSON serialization with recursively sorted object keys. */
export function stableWorkflowStringify(value: unknown): string {
  try {
    return canonicalWorkflowJson(value);
  } catch {
    return invalid('Workflow definition value is not JSON-serializable');
  }
}

function compileLegacySteps(steps: readonly StepDefinition[]): WorkflowGraphIR {
  if (!Array.isArray(steps) || steps.length === 0) invalid('Legacy workflow must define at least one step');
  const nodes: WorkflowIRNode[] = steps.map((stepValue, index) => compact({
    id: `legacy.${index}`,
    kind: 'activity',
    label: stepValue.name,
    activity: { name: stepValue.handler },
    retries: stepValue.retries,
    backoffMs: stepValue.backoffMs,
    timeoutMs: stepValue.timeoutMs,
    legacyCondition: stepValue.condition,
    legacyWaitFor: stepValue.waitFor,
  }) as unknown as WorkflowIRNode);
  const edges = nodes.slice(1).map((node, index) => ({
    id: `edge.${String(index).padStart(6, '0')}`,
    from: nodes[index]!.id,
    to: node.id,
  }));
  return { schemaVersion: WORKFLOW_GRAPH_SCHEMA_VERSION, entry: nodes[0]!.id, nodes, edges };
}

function validateDefinitionEnvelope(definition: WorkflowDefinitionInput): void {
  if (!definition || typeof definition !== 'object') invalid('Workflow definition is required');
  if (typeof definition.name !== 'string'
    || !definition.name.trim()
    || definition.name !== definition.name.trim()) invalid('Workflow name must be non-empty and trimmed');
  if (definition.version !== undefined
    && (!Number.isSafeInteger(definition.version) || definition.version < 1)) {
    invalid(`Workflow "${definition.name}" version must be a positive safe integer`);
  }
  if (definition.activate !== undefined && typeof definition.activate !== 'boolean') {
    invalid(`Workflow "${definition.name}" activate must be a boolean`);
  }
  const allowed = new Set([
    'name', 'steps', 'flow', 'graph', 'version', 'activate', 'inputSchema', 'access',
  ]);
  const unknown = Object.keys(definition).find((key) => !allowed.has(key));
  if (unknown) invalid(`Workflow "${definition.name}" property "${unknown}" is not supported`);
}

function cloneJson<T>(value: T): T {
  return JSON.parse(stableWorkflowStringify(value)) as T;
}

function cloneJsonForFingerprint(value: unknown): unknown {
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) invalid('Workflow definition value is not JSON-serializable');
    return JSON.parse(serialized);
  } catch (error) {
    if (error instanceof WorkflowError) throw error;
    return invalid('Workflow definition value is not JSON-serializable');
  }
}

function compact<T extends Record<string, unknown>>(value: T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function deepFreeze<T>(value: T, seen = new Set<object>()): T {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  if (!Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child, seen);
    }
    Object.freeze(value);
  }
  return value;
}

function invalid(message: string): never {
  throw new WorkflowError(message, 'WORKFLOW_GRAPH_INVALID', 422);
}
