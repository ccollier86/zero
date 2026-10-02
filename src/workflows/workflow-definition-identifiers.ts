/** Bounded identifiers shared by code, HTTP, and durable workflow catalogs. */

export const MAX_WORKFLOW_DEFINITION_NAME_LENGTH = 200;

export function validWorkflowDefinitionName(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_WORKFLOW_DEFINITION_NAME_LENGTH
    && value === value.trim();
}
