/**
 * pdf-storage-writer.ts
 *
 * Adapts Zero's storage service to the narrow writer contract consumed by
 * PdfService. This file performs no rendering and defines no HTTP routes.
 */

import { posix } from 'node:path';

import { getStorageService } from '../storage';
import { PdfError } from './pdf-error';
import type { PdfStorageWriter, PdfStorageWriteInput } from './pdf-types';

/** Storage service getter accepted for tests and alternate runtime composition. */
export type PdfStorageServiceGetter = typeof getStorageService;

/** Write generated PDFs through the platform storage metadata/blob boundary. */
export class ZeroPdfStorageWriter implements PdfStorageWriter {
  constructor(private readonly getStorage: PdfStorageServiceGetter = getStorageService) {}

  /** Store PDF bytes at one drive/path and return canonical object metadata. */
  async write(input: PdfStorageWriteInput) {
    const storage = this.getStorage();
    if (!storage) {
      throw new PdfError(
        'Platform storage is unavailable. Enable auth/storage or inject a custom PdfStorageWriter.',
        'PDF_STORAGE_UNAVAILABLE'
      );
    }

    const fileName = posix.basename(input.path.trim());
    if (!fileName || fileName === '.' || fileName === '/') {
      throw new PdfError('PDF storage path must include a file name.', 'PDF_INPUT_INVALID', {
        field: 'storage.path',
      });
    }

    return storage.objects.upload(
      input.driveId,
      input.path,
      input.bytes,
      fileName,
      input.createdBy ?? null,
      {
        overwrite: input.overwrite ?? false,
        public: input.public ?? false,
        metadata: {
          ...input.metadata,
          zeroPdfRenderer: input.renderer,
        },
      }
    );
  }
}
