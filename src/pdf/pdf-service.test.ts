/**
 * pdf-service.test.ts
 *
 * Verifies orchestration, limits, storage composition, and queue pressure with
 * fake adapters. Browser fidelity is covered by the Chromium integration test.
 */

import { describe, expect, test } from 'bun:test';

import { resolvePdfConfig } from './pdf-config';
import { PdfError } from './pdf-error';
import { PdfService } from './pdf-service';
import type {
  PdfRenderer,
  PdfRendererResult,
  PdfStorageWriter,
  PdfStorageWriteInput,
  PreparedPdfRenderInput,
} from './pdf-types';

const validPdf = new TextEncoder().encode('%PDF-1.7\n%%EOF');

class FakeRenderer implements PdfRenderer {
  readonly name = 'fake';
  requests: PreparedPdfRenderInput[] = [];
  closed = false;

  constructor(
    private readonly output: Uint8Array = validPdf,
    private readonly beforeReturn?: () => Promise<void>
  ) {}

  async render(input: PreparedPdfRenderInput): Promise<PdfRendererResult> {
    this.requests.push(input);
    await this.beforeReturn?.();
    return { bytes: this.output, renderer: this.name };
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

class FakeStorageWriter implements PdfStorageWriter {
  writeInput: PdfStorageWriteInput | null = null;

  async write(input: PdfStorageWriteInput) {
    this.writeInput = input;
    return {
      id: 'object-1',
      driveId: input.driveId,
      name: 'consent.pdf',
      path: input.path,
      type: 'file' as const,
      mimeType: 'application/pdf',
      sizeBytes: input.bytes.byteLength,
      checksum: 'checksum',
      isPublic: false,
      metadata: input.metadata ?? {},
      createdBy: input.createdBy ?? null,
      createdAt: 1,
      updatedAt: 1,
    };
  }
}

describe('PdfService', () => {
  test('renders a wrapped document with normalized defaults', async () => {
    const renderer = new FakeRenderer();
    const service = createService(renderer);

    const result = await service.render({
      html: '<main>Intake</main>',
      css: '@page { size: A4; }',
      document: { title: 'Intake' },
    });

    expect(result.contentType).toBe('application/pdf');
    expect(result.renderer).toBe('fake');
    expect(renderer.requests[0]?.html).toContain('<!doctype html>');
    expect(renderer.requests[0]?.options.printBackground).toBe(true);
    await service.close();
    expect(renderer.closed).toBe(true);
  });

  test('renders directly into the narrow storage boundary', async () => {
    const renderer = new FakeRenderer();
    const storage = new FakeStorageWriter();
    const service = createService(renderer, storage);

    const result = await service.renderToStorage(
      { html: '<p>Consent</p>' },
      {
        driveId: 'patient-files',
        path: '/patient-1/consent.pdf',
        createdBy: 'user-1',
        metadata: { intakeId: 'intake-1' },
      }
    );

    expect(result.file.path).toBe('/patient-1/consent.pdf');
    expect(storage.writeInput?.bytes).toEqual(validPdf);
    expect(storage.writeInput?.metadata).toEqual({ intakeId: 'intake-1' });
  });

  test('normalizes storage adapter failures', async () => {
    const storage: PdfStorageWriter = {
      async write() {
        throw new Error('provider details');
      },
    };
    const service = createService(new FakeRenderer(), storage);

    await expect(service.renderToStorage(
      { html: '<p>Consent</p>' },
      { driveId: 'patient-files', path: '/patient-1/consent.pdf' }
    )).rejects.toMatchObject({
      code: 'PDF_STORAGE_FAILED',
      message: 'PDF storage failed.',
    });
  });

  test('enforces input and output limits', async () => {
    const config = resolvePdfConfig({
      limits: { maxHtmlBytes: 5, maxOutputBytes: 6 },
    }, {});
    if (config === false) throw new Error('Expected PDF config.');

    await expect(new PdfService(config, { renderer: new FakeRenderer() }).render({ html: '123456' }))
      .rejects.toMatchObject({ code: 'PDF_LIMIT_EXCEEDED' });
    await expect(new PdfService(config, { renderer: new FakeRenderer(validPdf) }).render({ html: 'ok' }))
      .rejects.toMatchObject({ code: 'PDF_LIMIT_EXCEEDED' });
  });

  test('includes print templates in HTML limits and validates metadata at runtime', async () => {
    const config = resolvePdfConfig({ limits: { maxHtmlBytes: 20 } }, {});
    if (config === false) throw new Error('Expected PDF config.');
    const service = new PdfService(config, { renderer: new FakeRenderer() });

    await expect(service.render({
      html: 'ok',
      options: { headerTemplate: 'x'.repeat(20) },
    })).rejects.toMatchObject({ code: 'PDF_LIMIT_EXCEEDED' });
    await expect(service.render({
      html: 'ok',
      document: { title: 123 as unknown as string },
    })).rejects.toMatchObject({ code: 'PDF_INPUT_INVALID' });
  });

  test('rejects additional work when concurrency and queue capacity are exhausted', async () => {
    let releaseFirst!: () => void;
    const blocked = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const renderer = new FakeRenderer(validPdf, () => blocked);
    const config = resolvePdfConfig({
      limits: { maxConcurrency: 1, maxQueue: 0, timeoutMs: 5_000 },
    }, {});
    if (config === false) throw new Error('Expected PDF config.');
    const service = new PdfService(config, { renderer });

    const first = service.render({ html: 'first' });
    while (service.status().active === 0) await Bun.sleep(1);
    await expect(service.render({ html: 'second' })).rejects.toMatchObject({ code: 'PDF_QUEUE_FULL' });
    releaseFirst();
    await first;
  });

  test('rejects renderer output without a PDF signature', async () => {
    const service = createService(new FakeRenderer(new TextEncoder().encode('not-pdf')));
    const result = service.render({ html: 'test' });
    await expect(result).rejects.toBeInstanceOf(PdfError);
    await expect(result).rejects.toMatchObject({ code: 'PDF_OUTPUT_INVALID' });
  });
});

function createService(renderer: PdfRenderer, storage?: PdfStorageWriter): PdfService {
  const config = resolvePdfConfig({ renderer }, {});
  if (config === false) throw new Error('Expected PDF config.');
  return new PdfService(config, { renderer, storage });
}
