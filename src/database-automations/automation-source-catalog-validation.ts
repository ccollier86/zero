/**
 * automation-source-catalog-validation.ts
 *
 * Canonicalizes trusted source-catalog inputs at the system-plane boundary.
 * It owns validation only; persistence and authority derivation stay with
 * their respective routing and store layers.
 */

import { DatabaseError } from '../databases/database-error';
import {
  DATABASE_AUTOMATION_SOURCE_CATALOG_DEFAULT_PAGE_SIZE,
  DATABASE_AUTOMATION_SOURCE_CATALOG_MAX_PAGE_SIZE,
  DATABASE_AUTOMATION_SOURCE_CATALOG_MAX_SOURCES,
  DEFAULT_DATABASE_AUTOMATION_SOURCE_CATALOG_LIMITS,
  type DatabaseAutomationSourceAuthority,
  type DatabaseAutomationSourceCatalogLimits,
  type DatabaseAutomationSourceRegistration,
  type DatabaseAutomationSourceScanCursor,
  type DatabaseAutomationSourceScanRequest,
  type DatabaseAutomationSourceStatus,
  type DatabaseAutomationSourceStatusFilter,
  type DatabaseAutomationSourceStatusTransition,
} from './automation-source-catalog-contract';

const SOURCE_REF_PATTERN = /^[a-f0-9]{64}$/u;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;
const textEncoder = new TextEncoder();

interface NormalizedScanRequest {
  readonly status: DatabaseAutomationSourceStatusFilter;
  readonly limit: number;
  readonly cursor: DatabaseAutomationSourceScanCursor | null;
}

/** Validate and detach one trusted source registration. */
export function normalizeDatabaseAutomationSourceRegistration(
  input: DatabaseAutomationSourceRegistration,
): DatabaseAutomationSourceRegistration {
  const record = exactRecord(input, [
    'sourceRef',
    'sourceKind',
    'logicalSourceId',
    'authority',
  ]);
  const sourceRef = requireSourceRef(record.sourceRef);
  const sourceKind = record.sourceKind;
  if (sourceKind !== 'application'
    && sourceKind !== 'tenant'
    && sourceKind !== 'named') throw invalidInput();
  const logicalSourceId = requireLogicalId(record.logicalSourceId);
  const authority = normalizeAuthority(record.authority);

  if (sourceKind === 'application') {
    if (logicalSourceId !== 'application'
      || authority.scopeKind !== 'application') throw invalidInput();
    return Object.freeze({
      sourceRef,
      sourceKind,
      logicalSourceId: 'application',
      authority,
    });
  }
  if (sourceKind === 'named') {
    if (authority.scopeKind !== 'application') throw invalidInput();
    return Object.freeze({ sourceRef, sourceKind, logicalSourceId, authority });
  }
  if (authority.scopeKind !== 'tenant'
    || authority.tenantId !== logicalSourceId
    || authority.scopeId !== logicalSourceId) throw invalidInput();
  return Object.freeze({ sourceRef, sourceKind, logicalSourceId, authority });
}

/** Validate and detach an optimistic source lifecycle transition. */
export function normalizeDatabaseAutomationSourceStatusTransition(
  input: DatabaseAutomationSourceStatusTransition,
): DatabaseAutomationSourceStatusTransition {
  const record = exactRecord(input, ['sourceRef', 'expectedRevision', 'status']);
  const expectedRevision = record.expectedRevision;
  if (!Number.isSafeInteger(expectedRevision) || (expectedRevision as number) < 1) {
    throw invalidInput();
  }
  return Object.freeze({
    sourceRef: requireSourceRef(record.sourceRef),
    expectedRevision: expectedRevision as number,
    status: requireStatus(record.status),
  });
}

/** Validate a source reference received at an internal recovery boundary. */
export function requireDatabaseAutomationSourceRef(value: unknown): string {
  return requireSourceRef(value);
}

/** Validate a bounded, snapshot-fenced recovery scan request. */
export function normalizeDatabaseAutomationSourceScanRequest(
  input: DatabaseAutomationSourceScanRequest = {},
): NormalizedScanRequest {
  const record = optionalExactRecord(input, ['status', 'limit', 'cursor']);
  const status = record.status === undefined ? 'active' : requireStatusFilter(record.status);
  const limit = record.limit === undefined
    ? DATABASE_AUTOMATION_SOURCE_CATALOG_DEFAULT_PAGE_SIZE
    : record.limit;
  if (!Number.isSafeInteger(limit)
    || (limit as number) < 1
    || (limit as number) > DATABASE_AUTOMATION_SOURCE_CATALOG_MAX_PAGE_SIZE) {
    throw invalidInput();
  }
  const cursor = record.cursor === undefined || record.cursor === null
    ? null
    : normalizeCursor(record.cursor);
  if (cursor && cursor.status !== status) throw invalidInput();
  return Object.freeze({ status, limit: limit as number, cursor });
}

/** Enforce that test/embedding limits only lower the permanent hard ceiling. */
export function normalizeDatabaseAutomationSourceCatalogLimits(
  input: DatabaseAutomationSourceCatalogLimits =
    DEFAULT_DATABASE_AUTOMATION_SOURCE_CATALOG_LIMITS,
): DatabaseAutomationSourceCatalogLimits {
  const record = exactRecord(input, ['maxSources']);
  if (!Number.isSafeInteger(record.maxSources)
    || (record.maxSources as number) < 1
    || (record.maxSources as number)
      > DATABASE_AUTOMATION_SOURCE_CATALOG_MAX_SOURCES) throw invalidConfig();
  return Object.freeze({ maxSources: record.maxSources as number });
}

/** Validate a deterministic millisecond timestamp before persistence. */
export function requireDatabaseAutomationCatalogTimestamp(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new DatabaseError(
      'DATABASE_EXECUTOR_FAILED',
      'Database automation source catalog clock is invalid.',
      { retryable: false, outcome: 'not-started' },
    );
  }
  return value as number;
}

/** Validate an identifier read back from private durable state. */
export function isValidDatabaseAutomationLogicalId(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.trim() === value
    && value.normalize('NFC') === value
    && !CONTROL_CHARACTER_PATTERN.test(value)
    && isWellFormedUnicode(value)
    && textEncoder.encode(value).byteLength <= 256;
}

/** Validate the opaque physical source reference without deriving it. */
export function isValidDatabaseAutomationSourceRef(value: unknown): value is string {
  return typeof value === 'string' && SOURCE_REF_PATTERN.test(value);
}

function normalizeAuthority(value: unknown): DatabaseAutomationSourceAuthority {
  const record = exactRecord(value, ['scopeKind', 'scopeId', 'tenantId']);
  if (record.scopeKind === 'application') {
    if (record.scopeId !== 'application' || record.tenantId !== null) {
      throw invalidInput();
    }
    return Object.freeze({
      scopeKind: 'application',
      scopeId: 'application',
      tenantId: null,
    });
  }
  if (record.scopeKind !== 'tenant') throw invalidInput();
  const scopeId = requireLogicalId(record.scopeId);
  const tenantId = requireLogicalId(record.tenantId);
  if (scopeId !== tenantId) throw invalidInput();
  return Object.freeze({ scopeKind: 'tenant', scopeId, tenantId });
}

function normalizeCursor(value: unknown): DatabaseAutomationSourceScanCursor {
  const record = exactRecord(value, [
    'version',
    'status',
    'afterOrdinal',
    'throughOrdinal',
    'catalogRevision',
  ]);
  if (record.version !== 1
    || !isCatalogCount(record.afterOrdinal)
    || !isCatalogCount(record.throughOrdinal)
    || !isCatalogRevision(record.catalogRevision)
    || (record.afterOrdinal as number) > (record.throughOrdinal as number)) {
    throw invalidInput();
  }
  return Object.freeze({
    version: 1,
    status: requireStatusFilter(record.status),
    afterOrdinal: record.afterOrdinal as number,
    throughOrdinal: record.throughOrdinal as number,
    catalogRevision: record.catalogRevision as number,
  });
}

function requireSourceRef(value: unknown): string {
  if (!isValidDatabaseAutomationSourceRef(value)) throw invalidInput();
  return value;
}

function requireLogicalId(value: unknown): string {
  if (!isValidDatabaseAutomationLogicalId(value)) throw invalidInput();
  return value;
}

function requireStatus(value: unknown): DatabaseAutomationSourceStatus {
  if (value !== 'active' && value !== 'disabled') throw invalidInput();
  return value;
}

function requireStatusFilter(value: unknown): DatabaseAutomationSourceStatusFilter {
  if (value !== 'active' && value !== 'disabled' && value !== 'all') {
    throw invalidInput();
  }
  return value;
}

function isCatalogCount(value: unknown): boolean {
  return Number.isSafeInteger(value)
    && (value as number) >= 0
    && (value as number) <= DATABASE_AUTOMATION_SOURCE_CATALOG_MAX_SOURCES;
}

function isCatalogRevision(value: unknown): boolean {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function optionalExactRecord(
  value: unknown,
  allowedKeys: readonly string[],
): Record<string, unknown> {
  const descriptors = dataDescriptors(value);
  if (!descriptors || Object.keys(descriptors).some((key) => !allowedKeys.includes(key))) {
    throw invalidInput();
  }
  return Object.fromEntries(
    Object.entries(descriptors).map(([key, descriptor]) => [key, descriptor.value]),
  );
}

function exactRecord(
  value: unknown,
  expectedKeys: readonly string[],
): Record<string, unknown> {
  const record = optionalExactRecord(value, expectedKeys);
  if (Object.keys(record).length !== expectedKeys.length
    || expectedKeys.some((key) => !Object.hasOwn(record, key))) throw invalidInput();
  return record;
}

function dataDescriptors(
  value: unknown,
): Record<string, PropertyDescriptor & { value: unknown }> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const descriptor of Object.values(descriptors)) {
      if (!Object.hasOwn(descriptor, 'value')) return null;
    }
    return descriptors as Record<string, PropertyDescriptor & { value: unknown }>;
  } catch {
    return null;
  }
}

function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function invalidInput(): DatabaseError {
  return new DatabaseError(
    'DATABASE_PAYLOAD_INVALID',
    'Database automation source catalog input is invalid.',
  );
}

function invalidConfig(): DatabaseError {
  return new DatabaseError(
    'DATABASE_CONFIG_INVALID',
    'Database automation source catalog limits are invalid.',
  );
}
