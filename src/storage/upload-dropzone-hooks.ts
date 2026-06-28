/**
 * upload-dropzone-hooks.ts
 *
 * Composes react-dropzone with Zero's storage upload queue. This file owns
 * drag/drop upload coordination only; storage auth, multipart transport, and
 * backend authorization stay inside the SDK-backed storage hooks and routes.
 */

import { useCallback } from 'react';
import {
  useDropzone,
  type Accept,
  type DropEvent,
  type DropzoneOptions,
  type DropzoneState,
  type FileRejection,
} from 'react-dropzone';
import { OBS_CODES } from '../observability/codes';
import { emitFrontendCode } from '../frontend/client/observability';
import type { FileInfo } from './types';
import { useUploadQueue, type UploadQueueFilesOptions, type UseUploadQueueReturn } from './upload-queue-hooks';
import { joinStorageObjectPath } from './storage-paths';

export interface UseUploadDropzoneOptions {
  driveId: string | null;
  path?: string | null;
  accept?: Accept;
  minSize?: number;
  maxSize?: number;
  maxFiles?: number;
  multiple?: boolean;
  disabled?: boolean;
  noClick?: boolean;
  noKeyboard?: boolean;
  overwrite?: boolean;
  public?: boolean;
  metadata?: Record<string, unknown>;
  onUploaded?: (files: FileInfo[]) => void;
  onRejected?: (rejections: FileRejection[]) => void;
  onError?: (error: Error) => void;
}

export interface UseUploadDropzoneReturn {
  dropzone: DropzoneState;
  queue: UseUploadQueueReturn;
  disabled: boolean;
  uploadFiles: (files: File[] | FileList, options?: UploadQueueFilesOptions) => Promise<FileInfo[]>;
}

function toUploadError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}

/**
 * Return react-dropzone bindings wired to Zero storage uploads.
 *
 * Accepted files upload immediately to `path/file.name` when a drive is
 * available. Rejections stay in react-dropzone state and can be mirrored to
 * app UI with `onRejected`.
 */
export function useUploadDropzone(options: UseUploadDropzoneOptions): UseUploadDropzoneReturn {
  const queue = useUploadQueue();
  const disabled = options.disabled === true || !options.driveId;

  const uploadFiles = useCallback(
    async (files: File[] | FileList, uploadOptions: UploadQueueFilesOptions = {}) => {
      if (!options.driveId) return [];

      try {
        const result = await queue.uploadFiles(options.driveId, files, {
          overwrite: options.overwrite,
          public: options.public,
          metadata: options.metadata,
          ...uploadOptions,
          resolvePath: (file) =>
            uploadOptions.resolvePath?.(file)
            ?? joinStorageObjectPath(options.path, file.name),
        });
        options.onUploaded?.(result);
        return result;
      } catch (err) {
        const error = toUploadError(err);
        emitFrontendCode(OBS_CODES.FRONTEND_STORAGE_ACTION_FAILED, {
          error,
          metadata: { action: 'dropzoneUpload', driveId: options.driveId, path: options.path },
        });
        options.onError?.(error);
        throw error;
      }
    },
    [options, queue],
  );

  const onDrop = useCallback<NonNullable<DropzoneOptions['onDrop']>>(
    (acceptedFiles: File[], fileRejections: FileRejection[], event: DropEvent) => {
      if (fileRejections.length > 0) options.onRejected?.(fileRejections);
      if (acceptedFiles.length === 0 || disabled) return;
      void uploadFiles(acceptedFiles);
    },
    [disabled, options, uploadFiles],
  );

  const dropzone = useDropzone({
    accept: options.accept,
    minSize: options.minSize,
    maxSize: options.maxSize,
    maxFiles: options.maxFiles,
    multiple: options.multiple,
    disabled,
    noClick: options.noClick,
    noKeyboard: options.noKeyboard,
    onDrop,
    onError: options.onError,
  });

  return {
    dropzone,
    queue,
    disabled,
    uploadFiles,
  };
}
