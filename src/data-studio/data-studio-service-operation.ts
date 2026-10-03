/** Deterministic service-boundary identities and serializable payload helpers. */

import { createHash } from 'node:crypto';
import {
  cloneDatabaseSerializableValue,
  isDatabaseIdempotencyKey,
  type DatabaseSerializableValue,
} from '../databases/database-operations';
import { normalizeDataStudioValue } from './data-studio-codec';
import { DataStudioError } from './data-studio-error';
import {
  normalizeDataStudioTableKey,
} from './data-studio-operation-validation';
import type { DataStudioServiceActor } from './data-studio-service-contracts';

const SERVICE_ID_DOMAIN = 'zero.data-studio.entity.v1\0';
const SERVICE_RECEIPT_DOMAIN = 'zero.data-studio.receipt.v1\0';

export function dataStudioOperationIdentity(
  operationId: string,
  actor: DataStudioServiceActor,
  entity?: 'table' | 'row',
): { readonly receiptKey: string; readonly entityId: string } {
  if (!isDatabaseIdempotencyKey(operationId)) {
    throw new DataStudioError(
      'DATA_STUDIO_VALUE_INVALID',
      'Data Studio operation id is invalid.',
    );
  }
  const principal = `${actor.userId}\0${actor.membershipId}`;
  const receiptDigest = digest(
    `${SERVICE_RECEIPT_DOMAIN}${principal}\0${operationId}`,
  );
  const entityDigest = digest(
    `${SERVICE_ID_DOMAIN}${entity ?? 'mutation'}\0${principal}\0${operationId}`,
  );
  return Object.freeze({
    receiptKey: `data-studio:${receiptDigest.slice(0, 64)}`,
    entityId: `${entity === 'table' ? 'dst' : 'dsr'}_${entityDigest.slice(0, 32)}`,
  });
}

export function dataStudioRequestValues(
  values: Readonly<Record<string, unknown>>,
): DatabaseSerializableValue {
  const normalized = normalizeDataStudioValue(dataStudioOperationPayload(values));
  if (!normalized || typeof normalized !== 'object' || Array.isArray(normalized)) {
    throw new DataStudioError(
      'DATA_STUDIO_VALUE_INVALID',
      'Data Studio row values must be an object.',
    );
  }
  return cloneDatabaseSerializableValue(normalized);
}

export function dataStudioOperationPayload(value: unknown): DatabaseSerializableValue {
  try {
    return cloneDatabaseSerializableValue(value);
  } catch (cause) {
    throw new DataStudioError(
      'DATA_STUDIO_VALUE_INVALID',
      'Data Studio operation input is invalid.',
      { cause },
    );
  }
}

export function deriveDataStudioTableKey(name: string): string {
  const normalized = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '_')
    .replace(/^_+|_+$/gu, '')
    .slice(0, 64)
    .replace(/_+$/gu, '');
  return normalizeDataStudioTableKey(
    /^[a-z]/u.test(normalized) ? normalized : `table_${normalized || 'data'}`,
  );
}

function digest(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
