/**
 * storage.plugin.ts
 *
 * Elysia controller for storage HTTP routes. This plugin owns route
 * validation, auth dependency declaration, and HTTP streaming concerns;
 * storage permissions and metadata mutations live in StorageService.
 */

import { Elysia, t } from 'elysia';
import type { ReactiveDB } from '../sync/reactive-db';
import { LocalStorageAdapter } from './local-adapter';
import { StorageService, StorageError, defineStorageTables } from './storage-service';
import { createPresignedToken, verifyPresignedToken } from './presigned';
import { verifyUploadGrantToken } from './upload-grant';
import type {
  DriveRecord,
  DriveRecordWithAccess,
  StorageAccessCapabilities,
  StorageAdapter,
  StoragePluginConfig,
  PermissionLevel,
} from './types';
import { AuthError } from '../auth/types';
import { createAuthMiddleware } from '../auth/auth.middleware';
import { getAuthStore, getTokenService } from '../auth/auth.plugin';
import { OBS_CODES } from '../observability/codes';
import { emitPlatformCode } from '../observability/sink';

// ─── MIME types safe to serve inline (no script execution risk) ──────────

const INLINE_SAFE_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif',
  'image/bmp', 'image/x-icon',
  'application/pdf',
  'audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/flac', 'audio/mp4',
  'video/mp4', 'video/webm', 'video/quicktime',
  'text/plain',
]);

function contentDisposition(mimeType: string, fileName: string): string {
  const encoded = encodeURIComponent(fileName);
  // Only serve inline for types that can't execute scripts
  const disposition = INLINE_SAFE_TYPES.has(mimeType) ? 'inline' : 'attachment';
  return `${disposition}; filename="${encoded}"`;
}

// ─── Module-Level Singleton ──────────────────────────────────────────────

let _storageService: StorageService | null = null;
let _signingSecret: string = '';
let _defaultTTL = 3600;

/**
 * Get the StorageService singleton initialized by the storage plugin.
 *
 * Returns null before plugin startup or after shutdown; consumers should treat
 * null as storage not available in the current app lifecycle.
 */
export function getStorageService(): StorageService | null {
  return _storageService;
}

// ─── Plugin ──────────────────────────────────────────────────────────────

/**
 * Create the storage Elysia plugin.
 *
 * The plugin declares auth middleware internally so `authContext` and
 * `requireAuth()` are typed in isolated route handlers. Mount after
 * `createAuthPlugin({ db })` when using the plugin standalone.
 */
export function createStoragePlugin(config: StoragePluginConfig) {
  const adapter: StorageAdapter = config.adapter ?? new LocalStorageAdapter(config.localDir);

  return new Elysia({ name: 'storage', prefix: '/storage' })

    .use(createAuthMiddleware(getTokenService))

    // ─── Lifecycle ─────────────────────────────────────
    .onStart(() => {
      defineStorageTables(config.db);
      _signingSecret = config.signingSecret ?? crypto.randomUUID();
      _defaultTTL = config.defaultPresignedTTL ?? 3600;
      _storageService = new StorageService(config.db, adapter, {
        uploadGrantSecret: _signingSecret,
        defaultPresignedTTL: _defaultTTL,
      });
      emitPlatformCode(OBS_CODES.STORAGE_STARTED, {
        metadata: { tablesDefined: true },
      });
    })

    .onStop(() => {
      _storageService = null;
      emitPlatformCode(OBS_CODES.STORAGE_STOPPED);
    })

    // ─── Error Handler ─────────────────────────────────
    .onError(({ error, set }) => {
      if (error instanceof StorageError) {
        set.status = error.status;
        return { error: error.message };
      }

      if (error instanceof AuthError) {
        set.status = error.status;
        return { error: error.message, code: error.code };
      }
    })

    // ─── Drives ────────────────────────────────────────

    // POST /storage/drives — create a drive
    .post(
      '/drives',
      ({ body, requireAuth }) => {
        const auth = requireAuth();
        const svc = requireStorage();
        return svc.createDrive(auth.userId, {
          name: body.name,
          maxSize: body.maxSize,
          maxFileSize: body.maxFileSize,
          allowedMimeTypes: body.allowedMimeTypes,
          public: body.public,
        });
      },
      {
        body: t.Object({
          name: t.String({ minLength: 1 }),
          maxSize: t.Optional(t.Number({ minimum: 0 })),
          maxFileSize: t.Optional(t.Number({ minimum: 0 })),
          allowedMimeTypes: t.Optional(t.Array(t.String())),
          public: t.Optional(t.Boolean()),
        }),
      }
    )

    // GET /storage/drives — list drives for current user
    .get('/drives', ({ authContext }) => {
      const svc = requireStorage();
      let drives: DriveRecord[];
      if (authContext?.userId) {
        const userProps = getUserProperties(authContext.userId);
        drives = svc.listDrivesForUser(authContext.userId, authContext.role, userProps);
      } else {
        drives = svc.listDrives().filter((d) => d.public === 1);
      }
      return drives.map((drive) => withDriveAccess(svc, drive, authContext));
    })

    // GET /storage/drives/:driveId — get drive info
    .get(
      '/drives/:driveId',
      ({ params, authContext }) => {
        const svc = requireStorage();
        const drive = svc.getDrive(params.driveId);
        if (!drive) throw new StorageError(404, 'Drive not found');
        requireDriveAccessFromContext(svc, params.driveId, authContext, 'read');
        return withDriveAccess(svc, drive, authContext);
      },
      { params: t.Object({ driveId: t.String() }) }
    )

    // GET /storage/drives/:driveId/capabilities — effective current-user access
    .get(
      '/drives/:driveId/capabilities',
      ({ params, query, authContext }) => {
        const svc = requireStorage();
        const drive = svc.getDrive(params.driveId);
        if (!drive) throw new StorageError(404, 'Drive not found');
        requireDriveAccessFromContext(svc, params.driveId, authContext, 'read', query.path);
        return resolveDriveAccess(svc, drive, authContext, query.path);
      },
      {
        params: t.Object({ driveId: t.String() }),
        query: t.Object({ path: t.Optional(t.String()) }),
      }
    )

    // PATCH /storage/drives/:driveId — update drive settings
    .patch(
      '/drives/:driveId',
      ({ params, body, requireAuth }) => {
        const auth = requireAuth();
        const svc = requireStorage();
        requireDriveAccess(svc, params.driveId, auth, 'admin');
        return svc.updateDrive(params.driveId, {
          name: body.name,
          max_size_bytes: body.maxSize,
          max_file_size_bytes: body.maxFileSize,
          allowed_mime_types: body.allowedMimeTypes?.join(','),
        });
      },
      {
        params: t.Object({ driveId: t.String() }),
        body: t.Object({
          name: t.Optional(t.String({ minLength: 1 })),
          maxSize: t.Optional(t.Number({ minimum: 0 })),
          maxFileSize: t.Optional(t.Number({ minimum: 0 })),
          allowedMimeTypes: t.Optional(t.Array(t.String())),
        }),
      }
    )

    // DELETE /storage/drives/:driveId — delete a drive (owner or admin only)
    .delete(
      '/drives/:driveId',
      ({ params, requireAuth }) => {
        const auth = requireAuth();
        const svc = requireStorage();
        const drive = svc.getDrive(params.driveId);
        if (!drive) throw new StorageError(404, 'Drive not found');
        requireDriveAccess(svc, params.driveId, auth, 'admin');
        svc.deleteDrive(params.driveId);
        return { ok: true };
      },
      { params: t.Object({ driveId: t.String() }) }
    )

    // GET /storage/drives/:driveId/usage — get drive usage stats
    .get(
      '/drives/:driveId/usage',
      ({ params, authContext }) => {
        const svc = requireStorage();
        requireDriveAccessFromContext(svc, params.driveId, authContext, 'read');
        return svc.getDriveUsage(params.driveId);
      },
      { params: t.Object({ driveId: t.String() }) }
    )

    // ─── Upload ────────────────────────────────────────

    // POST /storage/drives/:driveId/upload — multipart file upload
    .post(
      '/drives/:driveId/upload',
      async ({ params, body, requireAuth }) => {
        const auth = requireAuth();
        const svc = requireStorage();
        const file = body.file;
        const path = body.path || `/${file.name}`;
        requireDriveAccess(svc, params.driveId, auth, 'write', path);

        return await svc.upload(
          params.driveId,
          path,
          file.stream(),
          file.name,
          auth.userId,
          {
            overwrite: body.overwrite === 'true',
            public: body.public === 'true',
            metadata: body.metadata ? JSON.parse(body.metadata) : undefined,
          }
        );
      },
      {
        params: t.Object({ driveId: t.String() }),
        body: t.Object({
          file: t.File(),
          path: t.Optional(t.String()),
          overwrite: t.Optional(t.String()),
          public: t.Optional(t.String()),
          metadata: t.Optional(t.String()),
        }),
      }
    )

    // ─── Download ──────────────────────────────────────

    // GET /storage/drives/:driveId/files/* — stream file download with Range + ETag
    .get(
      '/drives/:driveId/files/*',
      async ({ params, request, set, authContext }) => {
        const svc = requireStorage();
        const filePath = '/' + (params as any)['*'];

        // Check access
        requireDriveAccessFromContext(svc, params.driveId, authContext, 'read', filePath);

        const fileInfo = svc.getFileInfo(params.driveId, filePath);
        if (!fileInfo) throw new StorageError(404, 'File not found');

        const mimeType = fileInfo.mimeType || 'application/octet-stream';

        // ETag — use checksum for HTTP 304 caching
        if (fileInfo.checksum) {
          const etag = `"${fileInfo.checksum}"`;
          const ifNoneMatch = request.headers.get('if-none-match');
          if (ifNoneMatch === etag) {
            set.status = 304;
            return '';
          }
          set.headers['etag'] = etag;
        }

        set.headers['content-type'] = mimeType;
        set.headers['content-disposition'] = contentDisposition(mimeType, fileInfo.name);
        set.headers['accept-ranges'] = 'bytes';

        // Range request support
        const rangeHeader = request.headers.get('range');
        if (rangeHeader && fileInfo.checksum) {
          const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
          if (match) {
            const start = parseInt(match[1], 10);
            const end = match[2] ? parseInt(match[2], 10) : fileInfo.sizeBytes - 1;

            if (start >= fileInfo.sizeBytes || end >= fileInfo.sizeBytes) {
              set.status = 416;
              set.headers['content-range'] = `bytes */${fileInfo.sizeBytes}`;
              return '';
            }

            const result = await svc.downloadRange(params.driveId, filePath, start, end);
            if (!result) throw new StorageError(404, 'File not found');

            set.status = 206;
            set.headers['content-range'] = `bytes ${start}-${end}/${fileInfo.sizeBytes}`;
            set.headers['content-length'] = String(end - start + 1);
            return result.stream;
          }
        }

        // Full file download
        const result = await svc.download(params.driveId, filePath);
        if (!result) throw new StorageError(404, 'File not found');

        set.headers['content-length'] = String(result.info.sizeBytes);
        return result.stream;
      }
    )

    // ─── Folder Operations ─────────────────────────────

    // GET /storage/drives/:driveId/list — list folder contents
    .get(
      '/drives/:driveId/list',
      ({ params, query, authContext }) => {
        const svc = requireStorage();
        requireDriveAccessFromContext(svc, params.driveId, authContext, 'read', query.path);
        return svc.listFolder(params.driveId, query.path || undefined, {
          limit: query.limit ? parseInt(query.limit, 10) : undefined,
          cursor: query.cursor || undefined,
          type: query.type as any,
          sortBy: query.sortBy as any,
          sortDir: query.sortDir as any,
        });
      },
      {
        params: t.Object({ driveId: t.String() }),
        query: t.Object({
          path: t.Optional(t.String()),
          limit: t.Optional(t.String()),
          cursor: t.Optional(t.String()),
          type: t.Optional(t.UnionEnum(['file', 'folder', 'all'])),
          sortBy: t.Optional(t.UnionEnum(['name', 'size', 'created_at', 'updated_at'])),
          sortDir: t.Optional(t.UnionEnum(['asc', 'desc'])),
        }),
      }
    )

    // POST /storage/drives/:driveId/folders — create a folder
    .post(
      '/drives/:driveId/folders',
      ({ params, body, requireAuth }) => {
        const auth = requireAuth();
        const svc = requireStorage();
        requireDriveAccess(svc, params.driveId, auth, 'write');
        return svc.createFolder(params.driveId, body.path, auth.userId, body.public);
      },
      {
        params: t.Object({ driveId: t.String() }),
        body: t.Object({
          path: t.String({ minLength: 1 }),
          public: t.Optional(t.Boolean()),
        }),
      }
    )

    // ─── File Management ───────────────────────────────

    // POST /storage/drives/:driveId/move — move/rename a file or folder
    .post(
      '/drives/:driveId/move',
      async ({ params, body, requireAuth }) => {
        const auth = requireAuth();
        const svc = requireStorage();
        requireDriveAccess(svc, params.driveId, auth, 'write', body.from);
        return await svc.moveObject(params.driveId, body.from, body.to);
      },
      {
        params: t.Object({ driveId: t.String() }),
        body: t.Object({
          from: t.String({ minLength: 1 }),
          to: t.String({ minLength: 1 }),
        }),
      }
    )

    // POST /storage/drives/:driveId/copy — copy a file
    .post(
      '/drives/:driveId/copy',
      async ({ params, body, requireAuth }) => {
        const auth = requireAuth();
        const svc = requireStorage();
        requireDriveAccess(svc, params.driveId, auth, 'read', body.from);
        requireDriveAccess(svc, params.driveId, auth, 'write', body.to);
        return await svc.copyObject(params.driveId, body.from, body.to);
      },
      {
        params: t.Object({ driveId: t.String() }),
        body: t.Object({
          from: t.String({ minLength: 1 }),
          to: t.String({ minLength: 1 }),
        }),
      }
    )

    // DELETE /storage/drives/:driveId/files/* — delete a file or folder
    .delete(
      '/drives/:driveId/files/*',
      async ({ params, requireAuth }) => {
        const auth = requireAuth();
        const svc = requireStorage();
        const filePath = '/' + (params as any)['*'];
        requireDriveAccess(svc, params.driveId, auth, 'write', filePath);
        const deleted = await svc.deleteObject(params.driveId, filePath);
        if (!deleted) throw new StorageError(404, 'Not found');
        return { ok: true };
      }
    )

    // ─── Visibility ────────────────────────────────────

    // PATCH /storage/drives/:driveId/visibility
    .patch(
      '/drives/:driveId/visibility',
      ({ params, body, requireAuth }) => {
        const auth = requireAuth();
        const svc = requireStorage();
        if (body.path) {
          requireDriveAccess(svc, params.driveId, auth, 'admin', body.path);
          return svc.setVisibility(params.driveId, body.path, body.public);
        }
        requireDriveAccess(svc, params.driveId, auth, 'admin');
        return svc.setDriveVisibility(params.driveId, body.public);
      },
      {
        params: t.Object({ driveId: t.String() }),
        body: t.Object({
          path: t.Optional(t.String()),
          public: t.Boolean(),
        }),
      }
    )

    // ─── Permissions ───────────────────────────────────

    // GET /storage/drives/:driveId/permissions — list permissions
    .get(
      '/drives/:driveId/permissions',
      ({ params, query, requireAuth }) => {
        const auth = requireAuth();
        const svc = requireStorage();
        requireDriveAccess(svc, params.driveId, auth, 'admin');
        return {
          permissions: svc.permissions.list(params.driveId, {
            objectPath: query.objectPath,
          }),
        };
      },
      {
        params: t.Object({ driveId: t.String() }),
        query: t.Object({ objectPath: t.Optional(t.String()) }),
      }
    )

    // POST /storage/drives/:driveId/permissions — grant a permission
    .post(
      '/drives/:driveId/permissions',
      ({ params, body, requireAuth }) => {
        const auth = requireAuth();
        const svc = requireStorage();
        requireDriveAccess(svc, params.driveId, auth, 'admin');
        return svc.grantPermission(params.driveId, {
          objectPath: body.objectPath,
          grantType: body.grantType as any,
          grantKey: body.grantKey,
          grantValue: body.grantValue,
          permission: body.permission as any,
        });
      },
      {
        params: t.Object({ driveId: t.String() }),
        body: t.Object({
          objectPath: t.Optional(t.String()),
          grantType: t.UnionEnum(['role', 'user', 'property']),
          grantKey: t.Optional(t.String()),
          grantValue: t.String({ minLength: 1 }),
          permission: t.UnionEnum(['read', 'write', 'admin']),
        }),
      }
    )

    // DELETE /storage/permissions/:permissionId — revoke a permission
    .delete(
      '/permissions/:permissionId',
      ({ params, requireAuth }) => {
        const auth = requireAuth();
        const svc = requireStorage();

        // Verify the permission exists and the user has admin access on its drive
        const perm = svc.getPermission(params.permissionId);
        if (!perm) throw new StorageError(404, 'Permission not found');
        requireDriveAccess(svc, perm.drive_id, auth, 'admin');

        svc.revokePermission(params.permissionId);
        return { ok: true };
      },
      { params: t.Object({ permissionId: t.String() }) }
    )

    // ─── Presigned URLs ────────────────────────────────

    // POST /storage/drives/:driveId/presign — create a presigned URL
    .post(
      '/drives/:driveId/presign',
      async ({ params, body, requireAuth }) => {
        const auth = requireAuth();
        const svc = requireStorage();
        const requiredLevel: PermissionLevel = body.method === 'upload' ? 'write' : 'read';
        requireDriveAccess(svc, params.driveId, auth, requiredLevel, body.path);

        const token = await createPresignedToken({
          driveId: params.driveId,
          path: body.path,
          method: body.method ?? 'download',
          expiresIn: body.expiresIn ?? _defaultTTL,
          secret: _signingSecret,
          maxSize: body.maxSize,
          contentType: body.contentType,
        });

        return { token, expiresIn: body.expiresIn ?? _defaultTTL };
      },
      {
        params: t.Object({ driveId: t.String() }),
        body: t.Object({
          path: t.String({ minLength: 1 }),
          method: t.Optional(t.UnionEnum(['upload', 'download'])),
          expiresIn: t.Optional(t.Number({ minimum: 1 })),
          maxSize: t.Optional(t.Number({ minimum: 1 })),
          contentType: t.Optional(t.String()),
        }),
      }
    )

    // POST /storage/drives/:driveId/upload-grants — create a scoped public upload grant
    .post(
      '/drives/:driveId/upload-grants',
      async ({ params, body, requireAuth }) => {
        const auth = requireAuth();
        const svc = requireStorage();
        requireDriveAccess(svc, params.driveId, auth, 'write', body.path);

        return svc.uploads.create(params.driveId, {
          path: body.path,
          expiresIn: body.expiresIn,
          maxSize: body.maxSize,
          contentType: body.contentType,
          contentTypes: body.contentTypes,
          overwrite: body.overwrite,
          public: body.public,
          metadata: body.metadata,
          flow: body.flow,
          resource: body.resource,
        });
      },
      {
        params: t.Object({ driveId: t.String() }),
        body: t.Object({
          path: t.String({ minLength: 1 }),
          expiresIn: t.Optional(t.Number({ minimum: 1 })),
          maxSize: t.Optional(t.Number({ minimum: 1 })),
          contentType: t.Optional(t.String({ minLength: 1 })),
          contentTypes: t.Optional(t.Array(t.String({ minLength: 1 }))),
          overwrite: t.Optional(t.Boolean()),
          public: t.Optional(t.Boolean()),
          metadata: t.Optional(t.Record(t.String(), t.Unknown())),
          flow: t.Optional(t.String({ minLength: 1 })),
          resource: t.Optional(t.Object({
            type: t.String({ minLength: 1 }),
            id: t.String({ minLength: 1 }),
          })),
        }),
      }
    )

    // GET /storage/presigned/:token — execute a presigned download
    .get(
      '/presigned/:token',
      async ({ params, set }) => {
        const svc = requireStorage();
        const verified = await verifyPresignedToken(params.token, _signingSecret);
        if (!verified) throw new StorageError(403, 'Invalid or expired presigned URL');
        if (verified.method !== 'GET') throw new StorageError(405, 'Presigned URL is for upload, not download');

        const result = await svc.download(verified.driveId, verified.path);
        if (!result) throw new StorageError(404, 'File not found');

        const mimeType = result.info.mimeType || 'application/octet-stream';
        set.headers['content-type'] = mimeType;
        set.headers['content-disposition'] = contentDisposition(mimeType, result.info.name);
        set.headers['content-length'] = String(result.info.sizeBytes);
        if (result.info.checksum) set.headers['etag'] = `"${result.info.checksum}"`;
        return result.stream;
      },
      { params: t.Object({ token: t.String() }) }
    )

    // PUT /storage/upload-grants/:token — execute a scoped public upload grant
    .put(
      '/upload-grants/:token',
      async ({ params, request, set }) => {
        const svc = requireStorage();
        const verified = await verifyUploadGrantToken(params.token, _signingSecret);
        if (!verified) throw new StorageError(403, 'Invalid or expired upload grant');

        // Pre-check Content-Length before reading body
        if (verified.maxSize) {
          const contentLength = request.headers.get('content-length');
          if (contentLength) {
            const declaredSize = parseInt(contentLength, 10);
            if (!isNaN(declaredSize) && declaredSize > verified.maxSize) {
              throw new StorageError(413, `File exceeds max size: ${verified.maxSize} bytes`);
            }
          }
        }

        if (verified.contentTypes?.length) {
          const ct = request.headers.get('content-type');
          if (!ct || !matchesAnyContentType(ct, verified.contentTypes)) {
            throw new StorageError(
              400,
              `Expected content type: ${verified.contentTypes.join(', ')}`
            );
          }
        }

        const body = request.body;
        if (!body) throw new StorageError(400, 'No body provided');

        const blob = await request.blob();

        // Double-check actual size after reading
        if (verified.maxSize && blob.size > verified.maxSize) {
          throw new StorageError(413, `File exceeds max size: ${verified.maxSize} bytes`);
        }

        const info = await svc.upload(
          verified.driveId,
          verified.path,
          blob,
          verified.path.split('/').pop() || 'upload',
          null,
          {
            overwrite: verified.overwrite,
            public: verified.public,
            metadata: {
              ...(verified.metadata ?? {}),
              storageUploadGrantId: verified.grantId,
              ...(verified.flow ? { storageUploadFlow: verified.flow } : {}),
              ...(verified.resource
                ? {
                    storageUploadResourceType: verified.resource.type,
                    storageUploadResourceId: verified.resource.id,
                  }
                : {}),
            },
          }
        );

        set.status = 201;
        return info;
      },
      { params: t.Object({ token: t.String() }) }
    )

    // PUT /storage/presigned/:token — execute a presigned upload
    .put(
      '/presigned/:token',
      async ({ params, request, set }) => {
        const svc = requireStorage();
        const verified = await verifyPresignedToken(params.token, _signingSecret);
        if (!verified) throw new StorageError(403, 'Invalid or expired presigned URL');
        if (verified.method !== 'PUT') throw new StorageError(405, 'Presigned URL is for download, not upload');

        // Pre-check Content-Length before reading body
        if (verified.maxSize) {
          const contentLength = request.headers.get('content-length');
          if (contentLength) {
            const declaredSize = parseInt(contentLength, 10);
            if (!isNaN(declaredSize) && declaredSize > verified.maxSize) {
              throw new StorageError(413, `File exceeds max size: ${verified.maxSize} bytes`);
            }
          }
        }

        // Validate content type if specified (parse MIME properly, strip params)
        if (verified.contentType) {
          const ct = request.headers.get('content-type');
          if (ct && !matchContentType(ct, verified.contentType)) {
            throw new StorageError(400, `Expected content type: ${verified.contentType}`);
          }
        }

        const body = request.body;
        if (!body) throw new StorageError(400, 'No body provided');

        const blob = await request.blob();

        // Double-check actual size after reading
        if (verified.maxSize && blob.size > verified.maxSize) {
          throw new StorageError(413, `File exceeds max size: ${verified.maxSize} bytes`);
        }

        const info = await svc.upload(
          verified.driveId,
          verified.path,
          blob,
          verified.path.split('/').pop() || 'upload',
          null, // No user context for presigned
          { overwrite: true }
        );

        set.status = 201;
        return info;
      },
      { params: t.Object({ token: t.String() }) }
    )

    // ─── File Info ─────────────────────────────────────

    // GET /storage/drives/:driveId/info/* — get file/folder info without downloading
    .get(
      '/drives/:driveId/info/*',
      ({ params, authContext }) => {
        const svc = requireStorage();
        const filePath = '/' + (params as any)['*'];
        requireDriveAccessFromContext(svc, params.driveId, authContext, 'read', filePath);
        const info = svc.getFileInfo(params.driveId, filePath);
        if (!info) throw new StorageError(404, 'Not found');
        return info;
      }
    );
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function requireStorage(): StorageService {
  if (!_storageService) throw new Error('Storage not initialized');
  return _storageService;
}

function getUserProperties(userId: string): Record<string, string> {
  const authStore = getAuthStore();
  return authStore ? authStore.getProperties(userId) : {};
}

type StorageAuthContext = { userId: string; role: string; email: string } | null;

function withDriveAccess(
  svc: StorageService,
  drive: DriveRecord,
  authContext: StorageAuthContext,
  path?: string,
): DriveRecordWithAccess {
  return {
    ...drive,
    access: resolveDriveAccess(svc, drive, authContext, path),
  };
}

function resolveDriveAccess(
  svc: StorageService,
  drive: DriveRecord,
  authContext: StorageAuthContext,
  path?: string,
): StorageAccessCapabilities {
  const userProperties = authContext?.userId
    ? getUserProperties(authContext.userId)
    : {};
  const userId = authContext?.userId ?? null;
  const role = authContext?.role ?? null;
  const normalizedPath = path ?? null;
  const canRead = svc.checkAccess(
    drive.drive_id,
    normalizedPath,
    userId,
    role,
    userProperties,
    'read',
  );
  const canWrite = svc.checkAccess(
    drive.drive_id,
    normalizedPath,
    userId,
    role,
    userProperties,
    'write',
  );
  const canAdmin = svc.checkAccess(
    drive.drive_id,
    normalizedPath,
    userId,
    role,
    userProperties,
    'admin',
  );
  const objectInfo = path ? svc.getFileInfo(drive.drive_id, path) : null;
  const effectiveAccess: PermissionLevel | null = canAdmin
    ? 'admin'
    : canWrite
      ? 'write'
      : canRead
        ? 'read'
        : null;

  return {
    effectiveAccess,
    canRead,
    canWrite,
    canAdmin,
    isOwner: Boolean(userId && drive.owner_id === userId),
    isPlatformAdmin: role === 'admin',
    isPublic: drive.public === 1 || objectInfo?.isPublic === true,
  };
}

/**
 * Throw StorageError if user lacks access. Use when auth context comes from requireAuth().
 */
function requireDriveAccess(
  svc: StorageService,
  driveId: string,
  auth: { userId: string; role: string; email: string },
  level: PermissionLevel,
  path?: string
): void {
  const userProperties = getUserProperties(auth.userId);
  const hasAccess = svc.checkAccess(
    driveId, path ?? null, auth.userId, auth.role, userProperties, level
  );
  if (!hasAccess) {
    throw new StorageError(403, 'Forbidden');
  }
}

/**
 * Throw StorageError if user lacks access. Use when auth context may be null (optional auth).
 */
function requireDriveAccessFromContext(
  svc: StorageService,
  driveId: string,
  authContext: StorageAuthContext,
  level: PermissionLevel,
  path?: string
): void {
  const userProperties = authContext?.userId
    ? getUserProperties(authContext.userId)
    : {};

  const hasAccess = svc.checkAccess(
    driveId, path ?? null,
    authContext?.userId ?? null,
    authContext?.role ?? null,
    userProperties, level
  );

  if (!hasAccess) {
    if (!authContext?.userId) throw new StorageError(401, 'Unauthorized');
    throw new StorageError(403, 'Forbidden');
  }
}

/**
 * Compare content types properly by stripping parameters (charset, boundary, etc.)
 */
function matchContentType(actual: string, expected: string): boolean {
  const actualType = actual.split(';')[0].trim().toLowerCase();
  const expectedType = expected.split(';')[0].trim().toLowerCase();
  if (expectedType === '*') return true;
  if (expectedType.endsWith('/*')) {
    const prefix = expectedType.slice(0, -2);
    return actualType.startsWith(`${prefix}/`);
  }
  return actualType === expectedType;
}

function matchesAnyContentType(actual: string, expected: string[]): boolean {
  return expected.some((item) => matchContentType(actual, item));
}
