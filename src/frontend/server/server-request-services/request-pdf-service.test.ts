import { describe, expect, test } from 'bun:test';

import { resolvePdfConfig } from '../../../pdf/pdf-config';
import { PdfService } from '../../../pdf/pdf-service';
import type {
  PdfRenderer,
  PreparedPdfRenderInput,
} from '../../../pdf/pdf-types';
import type { FileInfo } from '../../../storage/types';
import { createRequestPdfService } from './request-pdf-service';
import type { ScopedStorageObjectApi } from './scoped-storage-contracts';

const PDF_BYTES = new TextEncoder().encode('%PDF-1.7\n%%EOF');

describe('request PDF authority projection', () => {
  test('fences in-memory rendering before and after asynchronous work', async () => {
    let revoked = false;
    let checks = 0;
    const service = createPdfService(async () => { revoked = true; });
    const scoped = createRequestPdfService(
      service,
      null,
      'actor',
      async () => {
        checks += 1;
        if (revoked) throw new Error('authority revoked');
      },
      () => {},
    );

    await expect(scoped.render({ html: '<p>private</p>' }))
      .rejects.toThrow('authority revoked');
    expect(checks).toBe(2);
  });

  test('does not report a committed scoped storage write as uncommitted after revocation', async () => {
    let revoked = false;
    let checks = 0;
    let capturedOptions: Parameters<ScopedStorageObjectApi['upload']>[4];
    const storage = {
      objects: {
        async upload(driveId, path, _data, fileName, options) {
          capturedOptions = options;
          revoked = true;
          return fileInfo(driveId, path, fileName, options?.metadata ?? {});
        },
      } satisfies Pick<ScopedStorageObjectApi, 'upload'>,
    };
    const scoped = createRequestPdfService(
      createPdfService(),
      storage,
      'actor',
      async () => {
        checks += 1;
        if (revoked) throw new Error('authority revoked');
      },
      () => {},
    );

    const result = await scoped.renderToStorage(
      { html: '<p>stored</p>' },
      {
        driveId: 'drive',
        path: '/reports/result.pdf',
        overwrite: true,
        metadata: { reportId: 'report-1' },
      },
    );

    expect(checks).toBe(1);
    expect(result.file.path).toBe('/reports/result.pdf');
    expect(capturedOptions).toMatchObject({
      overwrite: true,
      public: false,
      metadata: {
        reportId: 'report-1',
        zeroPdfRenderer: 'fake',
      },
    });
  });

  test('fences synchronous status reads', () => {
    let checks = 0;
    const scoped = createRequestPdfService(
      createPdfService(),
      null,
      null,
      async () => {},
      () => { checks += 1; },
    );

    expect(scoped.status().ready).toBeTrue();
    expect(checks).toBe(1);
  });
});

function createPdfService(beforeReturn?: () => Promise<void>): PdfService {
  const renderer: PdfRenderer = {
    name: 'fake',
    async render(_input: PreparedPdfRenderInput) {
      await beforeReturn?.();
      return { bytes: PDF_BYTES, renderer: 'fake' };
    },
    async close() {},
  };
  const config = resolvePdfConfig({ renderer }, {});
  if (config === false) throw new Error('Expected PDF configuration');
  return new PdfService(config, { renderer });
}

function fileInfo(
  driveId: string,
  path: string,
  name: string,
  metadata: Record<string, unknown>,
): FileInfo {
  return {
    id: 'object',
    driveId,
    name,
    path,
    type: 'file',
    mimeType: 'application/pdf',
    sizeBytes: PDF_BYTES.byteLength,
    checksum: 'checksum',
    isPublic: false,
    metadata,
    createdBy: 'actor',
    createdAt: 1,
    updatedAt: 1,
  };
}
