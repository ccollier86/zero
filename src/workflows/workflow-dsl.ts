/**
 * workflow-dsl.ts
 *
 * Provides the small code-authoring vocabulary compiled into WorkflowGraphIR.
 * Builders create inert serializable descriptors; they do not execute handlers
 * or hide runtime closures in persisted definitions.
 */

import type { TSchema } from 'elysia';
import type { WorkflowExpression } from './workflow-expression';
import type {
  WorkflowActivityInvocation,
  WorkflowActivityReference,
  WorkflowEachErrorPolicy,
  WorkflowEachInvalidItemPolicy,
  WorkflowEachVisibility,
  WorkflowJsonValue,
} from './workflow-ir';
import { WORKFLOW_COMPILER_ID_PREFIX } from './workflow-ir';
import { WorkflowError } from './workflow-error';

export interface WorkflowFlow {
  kind: 'flow';
  nodes: readonly WorkflowDslNode[];
}

export interface WorkflowStepOptions {
  label?: string;
  version?: string;
  input?: WorkflowExpression;
  retries?: number;
  backoffMs?: number;
  timeoutMs?: number;
}

export interface WorkflowStepDsl {
  kind: 'step';
  id: string;
  activity: WorkflowActivityReference;
  options: Readonly<WorkflowStepOptions>;
}

export interface WorkflowWaitOptions {
  label?: string;
  timeoutMs?: number;
  inputSchema?: TSchema | WorkflowJsonValue;
}

export interface WorkflowWaitDsl {
  kind: 'waitFor';
  id: string;
  event: string;
  options: Readonly<WorkflowWaitOptions>;
}

export interface WorkflowRequestAndWaitOptions extends WorkflowWaitOptions {
  delivery?: readonly (
    | string
    | WorkflowActivityReference
    | WorkflowActivityInvocation
  )[];
  validator?: string | WorkflowActivityReference;
  maxRejections?: number;
  request?: WorkflowJsonValue | WorkflowExpression;
}

export interface WorkflowRequestAndWaitDsl {
  kind: 'requestAndWait';
  id: string;
  event: string;
  options: Readonly<WorkflowRequestAndWaitOptions>;
}

export interface WorkflowWhenDsl {
  kind: 'when';
  condition: WorkflowExpression;
  body: WorkflowFlow;
}

export interface WorkflowOtherwiseDsl {
  kind: 'otherwise';
  body: WorkflowFlow;
}

export interface WorkflowChooseOptions {
  label?: string;
}

export interface WorkflowChooseDsl {
  kind: 'choose';
  id: string;
  label?: string;
  branches: readonly (WorkflowWhenDsl | WorkflowOtherwiseDsl)[];
}

export interface WorkflowParallelDsl {
  kind: 'parallel';
  id: string;
  label?: string;
  branches: Readonly<Record<string, WorkflowFlow>>;
}

export interface WorkflowEachOptions {
  label?: string;
  itemSchema?: TSchema | WorkflowJsonValue;
  itemKey?: WorkflowExpression;
  concurrency?: number;
  onInvalid?: WorkflowEachInvalidItemPolicy;
  onError?: WorkflowEachErrorPolicy;
  /** `private` retains fan-out payloads only in server-owned underscore tables. */
  visibility?: WorkflowEachVisibility;
}

export interface WorkflowEachDsl {
  kind: 'each';
  id: string;
  source: WorkflowExpression;
  body: WorkflowFlow;
  options: Readonly<WorkflowEachOptions>;
}

/** Nodes accepted inside a code-authored flow. */
export type WorkflowDslNode =
  | WorkflowStepDsl
  | WorkflowWaitDsl
  | WorkflowRequestAndWaitDsl
  | WorkflowChooseDsl
  | WorkflowParallelDsl
  | WorkflowEachDsl;

/** Define an ordered flow. Nested arrays are deliberately unsupported. */
export function flow(...nodes: readonly WorkflowDslNode[]): WorkflowFlow {
  return Object.freeze({ kind: 'flow', nodes: Object.freeze([...nodes]) });
}

/** Invoke one registered workflow activity. */
export function step(
  id: string,
  activity: string | WorkflowActivityReference,
  options: WorkflowStepOptions = {},
): WorkflowStepDsl {
  assertAuthorId(id);
  assertOptions(options, ['label', 'version', 'input', 'retries', 'backoffMs', 'timeoutMs'], 'step');
  const { version: _version, ...stepOptions } = options;
  return Object.freeze({
    kind: 'step',
    id,
    activity: freezeActivity(activity, options.version),
    options: Object.freeze(compact(stepOptions)),
  });
}

/** Wait for an event. The accepted event payload becomes the node output. */
export function waitFor(
  id: string,
  event: string,
  options: WorkflowWaitOptions = {},
): WorkflowWaitDsl {
  assertAuthorId(id);
  assertEvent(event);
  assertOptions(options, ['label', 'timeoutMs', 'inputSchema'], 'waitFor');
  return Object.freeze({
    kind: 'waitFor',
    id,
    event,
    options: Object.freeze(compact(options)),
  });
}

/**
 * Open an interaction, optionally invoke delivery and validation activities,
 * and wait for a response through any transport that emits the named event.
 */
export function requestAndWait(
  id: string,
  event: string,
  options: WorkflowRequestAndWaitOptions = {},
): WorkflowRequestAndWaitDsl {
  assertAuthorId(id);
  assertEvent(event);
  assertOptions(options, [
    'label', 'timeoutMs', 'inputSchema', 'delivery', 'validator', 'maxRejections', 'request',
  ], 'requestAndWait');
  if (options.delivery !== undefined && !Array.isArray(options.delivery)) {
    invalid('Workflow requestAndWait delivery must be an array');
  }
  return Object.freeze({
    kind: 'requestAndWait',
    id,
    event,
    options: Object.freeze(compact({
      ...options,
      delivery: options.delivery === undefined
        ? undefined
        : Object.freeze(options.delivery.map(freezeInvocation)),
      validator: options.validator === undefined
        ? undefined
        : freezeActivity(options.validator),
    })),
  });
}

/** Define a conditional branch used inside choose(). */
export function when(
  condition: WorkflowExpression,
  ...nodes: readonly WorkflowDslNode[]
): WorkflowWhenDsl {
  return Object.freeze({ kind: 'when', condition, body: flow(...nodes) });
}

/** Define the required fallback branch used inside choose(). */
export function otherwise(...nodes: readonly WorkflowDslNode[]): WorkflowOtherwiseDsl {
  return Object.freeze({ kind: 'otherwise', body: flow(...nodes) });
}

/** Select the first matching branch, or the required otherwise branch. */
export function choose(
  id: string,
  ...branches: readonly (WorkflowWhenDsl | WorkflowOtherwiseDsl)[]
): WorkflowChooseDsl;
export function choose(
  id: string,
  options: WorkflowChooseOptions,
  ...branches: readonly (WorkflowWhenDsl | WorkflowOtherwiseDsl)[]
): WorkflowChooseDsl;
export function choose(
  id: string,
  first?: WorkflowChooseOptions | WorkflowWhenDsl | WorkflowOtherwiseDsl,
  ...remaining: readonly (WorkflowWhenDsl | WorkflowOtherwiseDsl)[]
): WorkflowChooseDsl {
  assertAuthorId(id);
  if (first !== undefined && !isRecord(first)) {
    invalid('Workflow choose options and branches must be objects');
  }
  const hasOptions = first !== undefined && !('kind' in first);
  const options = hasOptions ? first as WorkflowChooseOptions : {};
  assertOptions(options, ['label'], 'choose');
  const branches = first === undefined
    ? remaining
    : hasOptions
      ? remaining
      : [first as unknown as WorkflowWhenDsl | WorkflowOtherwiseDsl, ...remaining];
  return Object.freeze(compact({
    kind: 'choose',
    id,
    label: options.label,
    branches: Object.freeze(branches),
  }) as unknown as WorkflowChooseDsl);
}

/** Run named branches concurrently and join after every branch completes. */
export function parallel(
  id: string,
  branches: Readonly<Record<string, WorkflowFlow | readonly WorkflowDslNode[]>>,
  options: { label?: string } = {},
): WorkflowParallelDsl {
  assertAuthorId(id);
  assertOptions(options, ['label'], 'parallel');
  if (!isRecord(branches)) invalid('Workflow parallel branches must be an object');
  const normalized: Record<string, WorkflowFlow> = Object.create(null);
  for (const [name, branch] of Object.entries(branches)) {
    if (!name.trim() || name !== name.trim()) invalid('Parallel branch names must be non-empty and trimmed');
    if (['__proto__', 'prototype', 'constructor'].includes(name)) {
      invalid(`Parallel branch name "${name}" is reserved`);
    }
    normalized[name] = Array.isArray(branch) ? flow(...branch) : branch as WorkflowFlow;
  }
  return Object.freeze({
    kind: 'parallel',
    id,
    ...(options.label === undefined ? {} : { label: options.label }),
    branches: Object.freeze(normalized),
  });
}

/** Run a nested flow for each item in a durably snapshotted source array. */
export function each(
  id: string,
  source: WorkflowExpression,
  body: WorkflowFlow | readonly WorkflowDslNode[],
  options: WorkflowEachOptions = {},
): WorkflowEachDsl {
  assertAuthorId(id);
  assertOptions(options, [
    'label', 'itemSchema', 'itemKey', 'concurrency', 'onInvalid', 'onError', 'visibility',
  ], 'each');
  return Object.freeze({
    kind: 'each',
    id,
    source,
    body: Array.isArray(body) ? flow(...body) : body as WorkflowFlow,
    options: Object.freeze(compact(options)),
  });
}

function freezeActivity(
  value: string | WorkflowActivityReference,
  versionOverride?: string,
): WorkflowActivityReference {
  const activity = typeof value === 'string' ? { name: value } : value;
  if (!activity || typeof activity.name !== 'string' || !activity.name.trim()) {
    invalid('Workflow activity name is required');
  }
  if (activity.name !== activity.name.trim()) invalid('Workflow activity names must be trimmed');
  const version = versionOverride ?? activity.version;
  if (version !== undefined
    && (typeof version !== 'string' || !version.trim() || version !== version.trim())) {
    invalid('Workflow activity version must be a non-empty string');
  }
  return Object.freeze({ name: activity.name, ...(version === undefined ? {} : { version }) });
}

function freezeInvocation(
  value: string | WorkflowActivityReference | WorkflowActivityInvocation,
): WorkflowActivityInvocation {
  if (typeof value === 'string') {
    return Object.freeze({ activity: freezeActivity(value as string | WorkflowActivityReference) });
  }
  if (!isRecord(value)) invalid('Workflow delivery activity must be a reference or invocation');
  if ('name' in value) {
    return Object.freeze({ activity: freezeActivity(value as unknown as WorkflowActivityReference) });
  }
  assertOptions(value, ['activity', 'input'], 'delivery invocation');
  return Object.freeze({
    activity: freezeActivity(value.activity as WorkflowActivityReference),
    ...(value.input === undefined ? {} : { input: value.input as WorkflowExpression }),
  });
}

function assertOptions(
  value: unknown,
  allowed: readonly string[],
  label: string,
): void {
  if (!isRecord(value)) invalid(`Workflow ${label} options must be an object`);
  const accepted = new Set(allowed);
  const unknown = Object.keys(value).find((key) => !accepted.has(key));
  if (unknown) invalid(`Workflow ${label} option "${unknown}" is not supported`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function compact<T extends object>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  ) as T;
}

function assertAuthorId(id: string): void {
  if (typeof id !== 'string' || !id.trim() || id !== id.trim()) {
    invalid('Workflow node ids must be non-empty and trimmed');
  }
  if (id.startsWith(WORKFLOW_COMPILER_ID_PREFIX)) {
    invalid(`Workflow node ids beginning with "${WORKFLOW_COMPILER_ID_PREFIX}" are reserved`);
  }
}

function assertEvent(event: string): void {
  if (typeof event !== 'string' || !event.trim() || event !== event.trim()) {
    invalid('Workflow event names must be non-empty and trimmed');
  }
}

function invalid(message: string): never {
  throw new WorkflowError(message, 'WORKFLOW_GRAPH_INVALID', 422);
}
