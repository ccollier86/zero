/**
 * workflow-definition-canonical.ts
 *
 * Canonicalizes immutable workflow-definition content and produces its
 * durable fingerprint. This server-side helper does not persist definitions
 * or decide which version is active.
 */

import { createHash } from 'node:crypto';

export interface WorkflowDefinitionFingerprintInput {
  graph: unknown;
  graphFormat: string;
  schemaVersion: number;
  inputSchema?: unknown;
  accessPolicy?: unknown;
}

export interface CanonicalWorkflowDefinitionContent {
  graphJson: string;
  inputSchemaJson: string | null;
  accessPolicyJson: string | null;
  fingerprint: string;
}

/** Upper bound for the complete immutable definition payload accepted by storage. */
export const MAX_WORKFLOW_DEFINITION_BYTES = 2 * 1024 * 1024;
const MAX_CANONICAL_DEPTH = 128;
const UNSAFE_OBJECT_KEYS = new Set(['__proto__', 'prototype']);

/** Error raised when definition content is not finite, acyclic JSON data. */
export class WorkflowDefinitionCanonicalError extends TypeError {
  constructor(message: string) {
    super(message);
    this.name = 'WorkflowDefinitionCanonicalError';
  }
}

/** Convert JSON-compatible data to a stable string with sorted object keys. */
export function canonicalWorkflowJson(value: unknown): string {
  const ancestors = new Set<object>();
  return serialize(value, '$', ancestors, 0);
}

/** Canonicalize every immutable field and return its SHA-256 fingerprint. */
export function canonicalizeWorkflowDefinition(
  input: WorkflowDefinitionFingerprintInput,
): CanonicalWorkflowDefinitionContent {
  if (!Number.isSafeInteger(input.schemaVersion) || input.schemaVersion < 0) {
    throw new WorkflowDefinitionCanonicalError(
      'Workflow graph schemaVersion must be a non-negative safe integer',
    );
  }
  if (!input.graphFormat.trim()) {
    throw new WorkflowDefinitionCanonicalError('Workflow graphFormat must not be empty');
  }

  const graphJson = canonicalWorkflowJson(input.graph);
  const inputSchemaJson = input.inputSchema === undefined || input.inputSchema === null
    ? null
    : canonicalWorkflowJson(input.inputSchema);
  const accessPolicyJson = input.accessPolicy === undefined || input.accessPolicy === null
    ? null
    : canonicalWorkflowJson(input.accessPolicy);
  const envelope = {
    accessPolicy: accessPolicyJson === null ? null : JSON.parse(accessPolicyJson),
    graph: JSON.parse(graphJson),
    graphFormat: input.graphFormat,
    inputSchema: inputSchemaJson === null ? null : JSON.parse(inputSchemaJson),
    schemaVersion: input.schemaVersion,
  };
  const envelopeJson = canonicalWorkflowJson(envelope);
  if (Buffer.byteLength(envelopeJson, 'utf8') > MAX_WORKFLOW_DEFINITION_BYTES) {
    throw new WorkflowDefinitionCanonicalError(
      `Workflow definition exceeds ${MAX_WORKFLOW_DEFINITION_BYTES} bytes`,
    );
  }
  const fingerprint = createHash('sha256')
    .update(envelopeJson)
    .digest('hex');

  return {
    graphJson,
    inputSchemaJson,
    accessPolicyJson,
    fingerprint,
  };
}

/** Recompute a fingerprint from stored JSON, rejecting malformed history. */
export function fingerprintStoredWorkflowDefinition(input: {
  graphJson: string;
  graphFormat: string;
  schemaVersion: number;
  inputSchemaJson: string | null;
  accessPolicyJson: string | null;
}): CanonicalWorkflowDefinitionContent {
  return canonicalizeWorkflowDefinition({
    graph: parseStoredJson(input.graphJson, 'graph_json'),
    graphFormat: input.graphFormat,
    schemaVersion: input.schemaVersion,
    inputSchema: input.inputSchemaJson === null
      ? null
      : parseStoredJson(input.inputSchemaJson, 'input_schema_json'),
    accessPolicy: input.accessPolicyJson === null
      ? null
      : parseStoredJson(input.accessPolicyJson, 'access_policy_json'),
  });
}

function parseStoredJson(value: string, field: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    throw new WorkflowDefinitionCanonicalError(
      `Stored workflow ${field} is not valid JSON`,
    );
  }
}

function serialize(
  value: unknown,
  path: string,
  ancestors: Set<object>,
  depth: number,
): string {
  if (depth > MAX_CANONICAL_DEPTH) {
    throw new WorkflowDefinitionCanonicalError(
      `${path} exceeds the maximum workflow definition depth`,
    );
  }
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new WorkflowDefinitionCanonicalError(`${path} contains a non-finite number`);
    }
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (typeof value !== 'object') {
    throw new WorkflowDefinitionCanonicalError(`${path} is not JSON-serializable`);
  }
  if (ancestors.has(value)) {
    throw new WorkflowDefinitionCanonicalError(`${path} contains a circular reference`);
  }

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const entries: string[] = [];
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.prototype.hasOwnProperty.call(value, index)) {
          throw new WorkflowDefinitionCanonicalError(`${path} contains a sparse array`);
        }
        entries.push(serialize(value[index], `${path}[${index}]`, ancestors, depth + 1));
      }
      return `[${entries.join(',')}]`;
    }

    const record = value as Record<string, unknown>;
    const prototype = Object.getPrototypeOf(record);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new WorkflowDefinitionCanonicalError(`${path} must be a plain JSON object`);
    }
    if (Object.getOwnPropertySymbols(record).length > 0) {
      throw new WorkflowDefinitionCanonicalError(`${path} contains symbol keys`);
    }
    const descriptors = Object.getOwnPropertyDescriptors(record);
    return `{${Object.keys(record).sort().map((key) => {
      const descriptor = descriptors[key];
      if (UNSAFE_OBJECT_KEYS.has(key) || !descriptor || !('value' in descriptor)) {
        throw new WorkflowDefinitionCanonicalError(`${path}.${key} is not a safe data property`);
      }
      if (descriptor.value === undefined) {
        throw new WorkflowDefinitionCanonicalError(`${path}.${key} is undefined`);
      }
      return `${JSON.stringify(key)}:${serialize(
        descriptor.value,
        `${path}.${key}`,
        ancestors,
        depth + 1,
      )}`;
    }).join(',')}}`;
  } finally {
    ancestors.delete(value);
  }
}
