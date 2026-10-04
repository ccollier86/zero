/**
 * workflow-ir.ts
 *
 * Defines the JSON-safe, versioned intermediate representation shared by
 * code-authored and database-authored workflows. This module owns data
 * contracts only; compilation, validation, persistence, and execution live in
 * focused collaborators.
 */

import type { WorkflowExpression } from './workflow-expression';
import type { WorkflowJsonValue } from './workflow-json-value';
import { MAX_WORKFLOW_DEFINITION_BYTES } from './workflow-definition-canonical';

export type { WorkflowJsonValue } from './workflow-json-value';

/** Current persisted workflow graph format. Independent of definition versions. */
export const WORKFLOW_GRAPH_SCHEMA_VERSION = 1 as const;

/** A version-pinned reference to trusted application code. */
export interface WorkflowActivityReference {
  name: string;
  version?: string;
}

/** One activity invocation whose input is resolved without executable code. */
export interface WorkflowActivityInvocation {
  activity: WorkflowActivityReference;
  input?: WorkflowExpression;
}

interface WorkflowIRNodeBase {
  /** Stable identity used by persistence, visualization, and output references. */
  id: string;
  /** Optional human-facing label. */
  label?: string;
}

/** Execute one registered activity. */
export interface WorkflowActivityNode extends WorkflowIRNodeBase {
  kind: 'activity';
  activity: WorkflowActivityReference;
  /** Optional input binding; omitted means the deterministic predecessor output. */
  input?: WorkflowExpression;
  retries?: number;
  backoffMs?: number;
  timeoutMs?: number;
  /** Trusted-code compatibility only; new graph definitions cannot set this. */
  legacyCondition?: string;
  /** Trusted-code compatibility only; preserves the legacy event gate. */
  legacyWaitFor?: string;
}

/** A human or external-system interaction opened while the run is durable. */
export interface WorkflowInteractionDefinition {
  /** Activities invoked when the request opens, such as email or SMS delivery. */
  delivery?: readonly WorkflowActivityInvocation[];
  /** Optional activity that accepts or rejects each submitted response. */
  validator?: WorkflowActivityReference;
  /** Durable rejection ceiling before the interaction fails. */
  maxRejections?: number;
  /** JSON-safe metadata for UI, email, agent, or other delivery renderers. */
  request?: WorkflowJsonValue | WorkflowExpression;
}

/** Wait for a named event and expose the accepted payload as this node's output. */
export interface WorkflowWaitNode extends WorkflowIRNodeBase {
  kind: 'wait';
  event: string;
  timeoutMs?: number;
  /** TypeBox/JSON Schema serialized into the immutable definition version. */
  inputSchema?: WorkflowJsonValue;
  interaction?: WorkflowInteractionDefinition;
}

/** Select exactly one outgoing condition edge, including a required default. */
export interface WorkflowChoiceNode extends WorkflowIRNodeBase {
  kind: 'choice';
  join: string;
}

/** Start named branches which converge on the referenced all-branches join. */
export interface WorkflowParallelNode extends WorkflowIRNodeBase {
  kind: 'parallel';
  join: string;
}

/** A deterministic convergence point generated for a choice or parallel node. */
export interface WorkflowJoinNode extends WorkflowIRNodeBase {
  kind: 'join';
  parent: string;
  strategy: 'all';
}

export type WorkflowEachInvalidItemPolicy = 'fail' | 'skip';
export type WorkflowEachErrorPolicy = 'fail' | 'collect';
export type WorkflowEachVisibility = 'public' | 'private';

/** Execute a nested graph once for every item in a snapshotted array. */
export interface WorkflowEachNode extends WorkflowIRNodeBase {
  kind: 'each';
  source: WorkflowExpression;
  /** Optional JSON Schema checked against each snapshotted item. */
  itemSchema?: WorkflowJsonValue;
  itemKey?: WorkflowExpression;
  concurrency: number;
  onInvalid: WorkflowEachInvalidItemPolicy;
  onError: WorkflowEachErrorPolicy;
  /** Keep snapshotted item values and handler results out of public step rows. */
  visibility?: WorkflowEachVisibility;
  body: WorkflowGraphIR;
}

/** Every executable or control node in the canonical graph. */
export type WorkflowIRNode =
  | WorkflowActivityNode
  | WorkflowWaitNode
  | WorkflowChoiceNode
  | WorkflowParallelNode
  | WorkflowJoinNode
  | WorkflowEachNode;

/** A directed dependency edge. Conditions are legal only from choice nodes. */
export interface WorkflowIREdge {
  id: string;
  from: string;
  to: string;
  branch?: string;
  /** Deterministic first-match priority for choice edges (zero based). */
  order?: number;
  condition?: WorkflowExpression;
  default?: boolean;
}

/** Immutable workflow graph persisted on a definition version and run snapshot. */
export interface WorkflowGraphIR {
  schemaVersion: typeof WORKFLOW_GRAPH_SCHEMA_VERSION;
  entry: string;
  nodes: readonly WorkflowIRNode[];
  edges: readonly WorkflowIREdge[];
}

/** Limits keep hostile or accidental graphs bounded before they reach runtime. */
export const WORKFLOW_GRAPH_LIMITS = Object.freeze({
  maxNodes: 1_000,
  maxEdges: 4_000,
  maxDepth: 16,
  maxParallelBranches: 64,
  maxEachConcurrency: 100,
  maxActivityDeliveries: 32,
  maxInteractionRejections: 1_000,
  maxIdLength: 128,
  maxLabelLength: 240,
  maxEventLength: 200,
  maxActivityNameLength: 256,
  maxActivityVersionLength: 128,
  maxActivityDescriptionLength: 2_000,
  maxActivityCapabilities: 64,
  maxActivityCapabilityLength: 128,
  maxExpressionDepth: 32,
  maxExpressionNodes: 512,
  maxExpressionPathSegments: 64,
  maxExpressionPathSegmentLength: 256,
  maxJsonDepth: 128,
  maxJsonMembers: 100_000,
  maxJsonStringLength: 1_000_000,
  maxJsonCharacters: 2_000_000,
  maxDefinitionBytes: MAX_WORKFLOW_DEFINITION_BYTES,
});

/** Prefix reserved for deterministic compiler-owned control-node identities. */
export const WORKFLOW_COMPILER_ID_PREFIX = '@zero/';
