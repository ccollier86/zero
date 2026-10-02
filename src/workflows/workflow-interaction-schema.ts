/**
 * workflow-interaction-schema.ts
 *
 * Rehydrates TypeBox's non-JSON markers for persisted response schemas and
 * performs default validation. Advanced validators remain service callbacks.
 */

import type { WorkflowJsonValue } from './workflow-json-value';
import { validateWorkflowSchemaValue } from './workflow-schema-snapshot';

/** Validate a response against a TypeBox schema after its JSON round trip. */
export function validatePersistedInteractionSchema(
  schema: WorkflowJsonValue,
  value: WorkflowJsonValue,
): boolean {
  return validateWorkflowSchemaValue(schema, value);
}
