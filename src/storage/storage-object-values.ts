/**
 * storage-object-values.ts
 *
 * Converts persisted Storage object values into public records and evaluates
 * normalized MIME policies. It does not query or mutate persistence.
 */

import { parseStorageMetadata } from './storage-input';
import type { FileInfo, ObjectRecord } from './types';

/** Return whether a detected MIME type satisfies an exact or subtype policy. */
export function storageMimeTypeAllowed(
  mimeType: string,
  allowedMimeTypes: readonly string[],
): boolean {
  for (const pattern of allowedMimeTypes) {
    if (pattern === '*' || pattern === mimeType) return true;
    if (pattern.endsWith('/*') && mimeType.startsWith(`${pattern.slice(0, -2)}/`)) {
      return true;
    }
  }
  return false;
}

/** Convert one persisted object while failing safely on corrupt metadata. */
export function toStorageFileInfo(record: ObjectRecord): FileInfo {
  return {
    id: record.object_id,
    driveId: record.drive_id,
    name: record.name,
    path: record.path,
    type: record.type,
    mimeType: record.mime_type,
    sizeBytes: record.size_bytes,
    checksum: record.checksum,
    isPublic: record.public === 1,
    metadata: parseStorageMetadata(record.metadata),
    createdBy: record.created_by,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  };
}
