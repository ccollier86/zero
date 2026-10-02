/**
 * workflow-activity-catalog.ts
 *
 * Owns the trusted, versioned activity boundary used by workflow graphs.
 * Database-authored graphs may reference only activities explicitly opted in
 * by application code; this catalog does not persist or execute definitions.
 */

import type { TSchema } from 'elysia';
import { Value } from '@sinclair/typebox/value';
import {
  WORKFLOW_GRAPH_LIMITS,
  type WorkflowActivityReference,
} from './workflow-ir';
import type { StepHandler } from './types';
import { WorkflowError } from './workflow-error';

/** Capabilities are descriptive and can be enforced by a later execution policy. */
export type WorkflowActivityCapability =
  | 'ai'
  | 'database'
  | 'email'
  | 'network'
  | 'notifications'
  | 'rooms'
  | 'secrets'
  | 'storage'
  | (string & {});

export interface WorkflowActivityDefinition {
  name: string;
  /** Defaults to `1`; references should pin a version once persisted. */
  version?: string;
  description?: string;
  handler: StepHandler;
  inputSchema?: TSchema;
  outputSchema?: TSchema;
  capabilities?: readonly WorkflowActivityCapability[];
  /** Required for definitions accepted from a database/API/visual editor. */
  databaseCallable?: boolean;
  /** Select this version when an author omits the version. */
  default?: boolean;
}

export interface RegisteredWorkflowActivity extends WorkflowActivityDefinition {
  version: string;
  capabilities: readonly WorkflowActivityCapability[];
  databaseCallable: boolean;
  default: boolean;
}

/** In-memory catalog for trusted workflow activity implementations. */
export class WorkflowActivityCatalog {
  private readonly byName = new Map<string, Map<string, RegisteredWorkflowActivity>>();
  private readonly defaults = new Map<string, string>();

  /** Register one immutable activity version. Duplicate name/version pairs fail closed. */
  register(definition: WorkflowActivityDefinition): RegisteredWorkflowActivity {
    validateDefinition(definition);
    const version = definition.version ?? '1';
    const versions = this.byName.get(definition.name) ?? new Map();
    if (versions.has(version)) {
      throw activityError(
        `Workflow activity "${definition.name}" version "${version}" is already registered`,
        'WORKFLOW_DEFINITION_INVALID',
        500,
      );
    }
    if (definition.default === true && this.defaults.has(definition.name)) {
      throw activityError(
        `Workflow activity "${definition.name}" already has a default version; use setDefault()`,
        'WORKFLOW_DEFINITION_INVALID',
        500,
      );
    }
    const registered = Object.freeze({
      ...definition,
      version,
      ...(definition.inputSchema === undefined
        ? {}
        : { inputSchema: deepFreeze(definition.inputSchema) }),
      ...(definition.outputSchema === undefined
        ? {}
        : { outputSchema: deepFreeze(definition.outputSchema) }),
      capabilities: Object.freeze([...new Set(definition.capabilities ?? [])]),
      databaseCallable: definition.databaseCallable === true,
      default: definition.default === true,
    });
    versions.set(version, registered);
    this.byName.set(definition.name, versions);
    if (registered.default) this.defaults.set(definition.name, version);
    return this.present(registered);
  }

  /** Select the version used by future unpinned definitions. Existing graphs stay pinned. */
  setDefault(name: string, version: string): void {
    if (!this.byName.get(name)?.has(version)) {
      throw activityError(
        `Workflow activity "${name}" version "${version}" is not registered`,
        'WORKFLOW_ACTIVITY_NOT_REGISTERED',
        500,
      );
    }
    this.defaults.set(name, version);
  }

  /** Return an exact activity version without throwing. */
  get(name: string, version: string): RegisteredWorkflowActivity | undefined {
    const activity = this.byName.get(name)?.get(version);
    return activity ? this.present(activity) : undefined;
  }

  /** Resolve an explicit version or the deterministic default/latest version. */
  resolve(reference: WorkflowActivityReference): RegisteredWorkflowActivity {
    const versions = this.byName.get(reference.name);
    if (!versions || versions.size === 0) {
      throw activityError(
        `Workflow activity "${reference.name}" is not registered`,
        'WORKFLOW_ACTIVITY_NOT_REGISTERED',
        500,
      );
    }
    if (reference.version !== undefined) {
      const exact = versions.get(reference.version);
      if (!exact) {
        throw activityError(
          `Workflow activity "${reference.name}" version "${reference.version}" is not registered`,
          'WORKFLOW_ACTIVITY_NOT_REGISTERED',
          500,
        );
      }
      return this.present(exact);
    }
    const selected = this.defaults.get(reference.name)
      ?? [...versions.keys()].sort(compareVersions).at(-1)!;
    return this.present(versions.get(selected)!);
  }

  /** Resolve and enforce the explicit database-authoring trust boundary. */
  resolveDatabaseCallable(reference: WorkflowActivityReference): RegisteredWorkflowActivity {
    const activity = this.resolve(reference);
    if (!activity.databaseCallable) {
      throw activityError(
        `Workflow activity "${activity.name}" version "${activity.version}" is not allowed in database-authored workflows`,
        'WORKFLOW_ACTIVITY_NOT_ALLOWED',
        403,
      );
    }
    return activity;
  }

  /** Validate one activity input against its optional TypeBox schema. */
  validateInput(reference: WorkflowActivityReference, value: unknown): RegisteredWorkflowActivity {
    const activity = this.resolve(reference);
    if (!schemaMatches(activity.inputSchema, value)) {
      throw activityError(
        `Input does not match workflow activity "${activity.name}"`,
        'WORKFLOW_ACTIVITY_INPUT_INVALID',
        422,
      );
    }
    return activity;
  }

  /** Validate one activity output before it enters durable workflow state. */
  validateOutput(reference: WorkflowActivityReference, value: unknown): RegisteredWorkflowActivity {
    const activity = this.resolve(reference);
    if (!schemaMatches(activity.outputSchema, value)) {
      throw activityError(
        `Output does not match workflow activity "${activity.name}"`,
        'WORKFLOW_ACTIVITY_OUTPUT_INVALID',
        500,
      );
    }
    return activity;
  }

  /** List immutable activity metadata in deterministic name/version order. */
  list(): RegisteredWorkflowActivity[] {
    return [...this.byName.values()]
      .flatMap((versions) => [...versions.values()])
      .map((activity) => this.present(activity))
      .sort((left, right) => compareCodeUnits(left.name, right.name)
        || compareVersions(left.version, right.version));
  }

  private present(activity: RegisteredWorkflowActivity): RegisteredWorkflowActivity {
    return Object.freeze({
      ...activity,
      default: this.defaults.get(activity.name) === activity.version,
    });
  }
}

function validateDefinition(definition: WorkflowActivityDefinition): void {
  if (!definition || typeof definition !== 'object') {
    throw activityError('Workflow activity definition is required', 'WORKFLOW_DEFINITION_INVALID', 500);
  }
  if (typeof definition.name !== 'string'
    || !definition.name.trim()
    || definition.name !== definition.name.trim()
    || definition.name.length > WORKFLOW_GRAPH_LIMITS.maxActivityNameLength) {
    throw activityError('Workflow activity name must be non-empty and trimmed', 'WORKFLOW_DEFINITION_INVALID', 500);
  }
  const allowed = new Set([
    'name', 'version', 'description', 'handler', 'inputSchema', 'outputSchema',
    'capabilities', 'databaseCallable', 'default',
  ]);
  const unknown = Object.keys(definition).find((key) => !allowed.has(key));
  if (unknown) {
    throw activityError(
      `Workflow activity "${definition.name}" property "${unknown}" is not supported`,
      'WORKFLOW_DEFINITION_INVALID',
      500,
    );
  }
  const version = definition.version ?? '1';
  if (typeof version !== 'string'
    || !version.trim()
    || version !== version.trim()
    || version.length > WORKFLOW_GRAPH_LIMITS.maxActivityVersionLength) {
    throw activityError('Workflow activity version must be non-empty and trimmed', 'WORKFLOW_DEFINITION_INVALID', 500);
  }
  if (typeof definition.handler !== 'function') {
    throw activityError(`Workflow activity "${definition.name}" must have a handler`, 'WORKFLOW_DEFINITION_INVALID', 500);
  }
  if (definition.description !== undefined
    && (typeof definition.description !== 'string'
      || !definition.description.trim()
      || definition.description !== definition.description.trim()
      || definition.description.length > WORKFLOW_GRAPH_LIMITS.maxActivityDescriptionLength)) {
    throw activityError('Workflow activity description must be a non-empty string', 'WORKFLOW_DEFINITION_INVALID', 500);
  }
  if (definition.capabilities !== undefined
    && (!Array.isArray(definition.capabilities)
      || definition.capabilities.length > WORKFLOW_GRAPH_LIMITS.maxActivityCapabilities
      || definition.capabilities.some((value) => typeof value !== 'string'
        || !value.trim()
        || value.length > WORKFLOW_GRAPH_LIMITS.maxActivityCapabilityLength))) {
    throw activityError('Workflow activity capabilities must be non-empty strings', 'WORKFLOW_DEFINITION_INVALID', 500);
  }
  if (definition.capabilities?.some((value) => value !== value.trim())) {
    throw activityError('Workflow activity capabilities must be trimmed', 'WORKFLOW_DEFINITION_INVALID', 500);
  }
  if (definition.databaseCallable !== undefined
    && typeof definition.databaseCallable !== 'boolean') {
    throw activityError('Workflow activity databaseCallable must be a boolean', 'WORKFLOW_DEFINITION_INVALID', 500);
  }
  if (definition.default !== undefined && typeof definition.default !== 'boolean') {
    throw activityError('Workflow activity default must be a boolean', 'WORKFLOW_DEFINITION_INVALID', 500);
  }
}

function schemaMatches(schema: TSchema | undefined, value: unknown): boolean {
  if (!schema) return true;
  try {
    return Value.Check(schema, value);
  } catch {
    return false;
  }
}

function compareVersions(left: string, right: string): number {
  const leftParts = left.match(/\d+|\D+/g) ?? [];
  const rightParts = right.match(/\d+|\D+/g) ?? [];
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const leftPart = leftParts[index];
    const rightPart = rightParts[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    if (/^\d+$/.test(leftPart) && /^\d+$/.test(rightPart)) {
      const leftNumber = leftPart.replace(/^0+(?=\d)/, '');
      const rightNumber = rightPart.replace(/^0+(?=\d)/, '');
      if (leftNumber.length !== rightNumber.length) return leftNumber.length - rightNumber.length;
      const numeric = compareCodeUnits(leftNumber, rightNumber);
      if (numeric !== 0) return numeric;
    }
    const part = compareCodeUnits(leftPart, rightPart);
    if (part !== 0) return part;
  }
  return compareCodeUnits(left, right);
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function deepFreeze<T>(value: T, seen = new Set<object>()): T {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor && 'value' in descriptor) deepFreeze(descriptor.value, seen);
  }
  return Object.freeze(value);
}

function activityError(
  message: string,
  code: ConstructorParameters<typeof WorkflowError>[1],
  status: number,
): WorkflowError {
  return new WorkflowError(message, code, status);
}
