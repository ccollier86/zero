/**
 * upload-grant.ts
 *
 * Scoped public-upload capability tokens for storage. Upload grants allow
 * app-owned backend code to accept unauthenticated uploads into private
 * drives without making a drive or folder publicly writable.
 */

import type {
  CreateUploadGrantParams,
  StorageUploadGrant,
  StorageUploadGrantResource,
} from './types';
import { createSignedStorageToken, verifySignedStorageToken } from './storage-token';

const UPLOAD_GRANT_KIND = 'storage-upload-grant';

interface UploadGrantPayload extends Record<string, unknown> {
  k: typeof UPLOAD_GRANT_KIND;
  g: string; // grant id
  d: string; // drive id
  p: string; // object path
  e: number; // expires at unix ms
  s?: number; // max upload size
  c?: string[]; // allowed request content types
  o?: 1; // overwrite existing file
  u?: 1; // public object visibility
  m?: Record<string, unknown>; // object metadata
  f?: string; // app flow tag
  rt?: string; // linked resource type
  ri?: string; // linked resource id
  n?: number; // managed drive generation
}

export interface CreateUploadGrantTokenOptions extends CreateUploadGrantParams {
  driveId: string;
  expiresIn: number;
  secret: string;
  grantId?: string;
  /** Captured Storage Studio generation for managed drives. */
  generation?: number;
}

export interface VerifiedUploadGrant {
  grantId: string;
  driveId: string;
  path: string;
  /** Absolute authenticated expiry, rechecked at final storage publication. */
  expiresAt: number;
  maxSize?: number;
  contentTypes?: string[];
  overwrite: boolean;
  public: boolean;
  metadata?: Record<string, unknown>;
  flow?: string;
  resource?: StorageUploadGrantResource;
  generation?: number;
}

/**
 * Create a signed upload grant token and public record for callers.
 */
export async function createUploadGrantToken(
  opts: CreateUploadGrantTokenOptions
): Promise<StorageUploadGrant> {
  const grantId = opts.grantId ?? `sug_${crypto.randomUUID()}`;
  const expiresAt = Date.now() + opts.expiresIn * 1000;
  const contentTypes = normalizeContentTypes(opts);
  const metadata = normalizeMetadata(opts.metadata);

  const payload: UploadGrantPayload = {
    k: UPLOAD_GRANT_KIND,
    g: grantId,
    d: opts.driveId,
    p: opts.path,
    e: expiresAt,
  };
  if (opts.maxSize) payload.s = opts.maxSize;
  if (contentTypes?.length) payload.c = contentTypes;
  if (opts.overwrite) payload.o = 1;
  if (opts.public) payload.u = 1;
  if (metadata) payload.m = metadata;
  if (opts.flow) payload.f = opts.flow;
  if (opts.resource) {
    payload.rt = opts.resource.type;
    payload.ri = opts.resource.id;
  }
  if (opts.generation !== undefined) payload.n = opts.generation;

  const token = await createSignedStorageToken(payload, opts.secret);
  return {
    token,
    grantId,
    driveId: opts.driveId,
    path: opts.path,
    expiresIn: opts.expiresIn,
    expiresAt,
    maxSize: opts.maxSize,
    contentTypes,
    overwrite: Boolean(opts.overwrite),
    public: Boolean(opts.public),
    metadata,
    flow: opts.flow,
    resource: opts.resource,
  };
}

/**
 * Verify, decode, and normalize an upload grant token.
 */
export async function verifyUploadGrantToken(
  tokenString: string,
  secret: string
): Promise<VerifiedUploadGrant | null> {
  const payload = await verifySignedStorageToken<UploadGrantPayload>(tokenString, secret);
  if (!payload) return null;
  if (payload.k !== UPLOAD_GRANT_KIND) return null;
  if (!Number.isSafeInteger(payload.e) || payload.e <= Date.now()) return null;
  if (!payload.g || !payload.d || !payload.p) return null;

  return {
    grantId: payload.g,
    driveId: payload.d,
    path: payload.p,
    expiresAt: payload.e,
    maxSize: typeof payload.s === 'number' ? payload.s : undefined,
    contentTypes: Array.isArray(payload.c) ? payload.c : undefined,
    overwrite: payload.o === 1,
    public: payload.u === 1,
    metadata: isRecord(payload.m) ? payload.m : undefined,
    flow: typeof payload.f === 'string' ? payload.f : undefined,
    resource: typeof payload.rt === 'string' && typeof payload.ri === 'string'
      ? { type: payload.rt, id: payload.ri }
      : undefined,
    generation: typeof payload.n === 'number' ? payload.n : undefined,
  };
}

function normalizeContentTypes(opts: CreateUploadGrantParams): string[] | undefined {
  const values = [
    ...(opts.contentType ? [opts.contentType] : []),
    ...(opts.contentTypes ?? []),
  ]
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

  return values.length ? Array.from(new Set(values)) : undefined;
}

function normalizeMetadata(
  metadata: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (!metadata || Object.keys(metadata).length === 0) return undefined;
  return metadata;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
