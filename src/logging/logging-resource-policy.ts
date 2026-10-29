/** Descriptor-safe capture policy. Values require an explicit finite vocabulary; credentials can never opt in. */
import type { LoggingFieldPolicy, LoggingResourcePolicies, LoggingResourcePolicy } from './logging-activity-contracts';
import type { LoggingScalar } from './logging-contracts';
import { invalid, loggingArray, loggingByteLength, loggingRecord } from './logging-validation';
import { isLoggingApprovedScalar, LOGGING_SENSITIVE_FIELD } from './logging-activity-values';

export { isLoggingApprovedScalar, LOGGING_SENSITIVE_FIELD } from './logging-activity-values';

export function normalizeLoggingResourcePolicies(value: unknown): LoggingResourcePolicies {
  if (value === undefined) return Object.freeze({});
  const resources = loggingRecord(value, undefined, 'LOGGING_CONFIG_INVALID');
  if (Object.keys(resources).length > 1000) invalid('LOGGING_CONFIG_INVALID');
  const output: Record<string, LoggingResourcePolicy> = Object.create(null);
  for (const [table, raw] of Object.entries(resources)) {
    if (!safeName(table, 1024)) invalid('LOGGING_CONFIG_INVALID');
    const resource = loggingRecord(raw, ['label', 'fields'], 'LOGGING_CONFIG_INVALID');
    if (resource.label !== undefined && (typeof resource.label !== 'string' || !safeName(resource.label, 120))) invalid('LOGGING_CONFIG_INVALID');
    const fields = resource.fields === undefined ? {} : loggingRecord(resource.fields, undefined, 'LOGGING_CONFIG_INVALID');
    if (Object.keys(fields).length > 256) invalid('LOGGING_CONFIG_INVALID');
    const policies: Record<string, LoggingFieldPolicy> = Object.create(null);
    for (const [field, policy] of Object.entries(fields)) {
      if (!safeName(field, 256)) invalid('LOGGING_CONFIG_INVALID');
      if (policy === 'omit' || policy === 'redact') policies[field] = policy;
      else {
        if (LOGGING_SENSITIVE_FIELD.test(field)) invalid('LOGGING_CONFIG_INVALID');
        const record = loggingRecord(policy, ['values'], 'LOGGING_CONFIG_INVALID');
        const values = loggingArray(record.values, 64);
        if (!values.length || values.some(value => !isLoggingApprovedScalar(value))) invalid('LOGGING_CONFIG_INVALID');
        policies[field] = Object.freeze({ values: Object.freeze(values as LoggingScalar[]) });
      }
    }
    output[table] = Object.freeze({ ...(resource.label === undefined ? {} : { label: resource.label as string }), fields: Object.freeze(policies) });
  }
  if (loggingByteLength(output) > 65536) invalid('LOGGING_CONFIG_INVALID');
  return Object.freeze(output);
}

function safeName(value: string, maximum: number): boolean {
  return value.length > 0 && value.length <= maximum && value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value);
}
