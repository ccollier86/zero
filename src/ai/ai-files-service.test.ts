import { describe, expect, test } from 'bun:test';
import type {
  FilesV4,
  FilesV4UploadFileCallOptions,
  ProviderV4,
} from '@ai-sdk/provider';

import { OBS_CODES } from '../observability/codes';
import {
  getPlatformSink,
  setPlatformSink,
} from '../observability/sink';
import type { PlatformEvent } from '../observability/types';
import {
  executeAIHostedFileDelete,
  executeAIHostedFileDownload,
  executeAIHostedFileMetadata,
  executeAIHostedFileUpload,
} from './ai-files-service';
import { AI_DEFAULT_HOSTED_FILE_MAX_BYTES } from './ai-files-types';
import type { AIRegistry } from './ai-registry';
import type {
  AIProviderCapabilities,
  ResolvedAIProviderCapabilities,
  ResolvedAIProviderConfig,
} from './ai-types';

describe('provider-hosted AI files', () => {
  test('uploads bounded data and preserves Zero provider identity in the locator', async () => {
    let call: FilesV4UploadFileCallOptions | undefined;
    const providerOptions = { test: { purpose: 'assistants' } };
    const files = filesInterface({
      async uploadFile(options) {
        call = options;
        return {
          providerReference: { openai: 'file_123' },
          filename: options.filename,
          mediaType: options.mediaType,
          byteSize: (options.data as { data: Uint8Array }).data.byteLength,
          createdAt: new Date('2026-10-04T12:00:00.000Z'),
          warnings: [],
        };
      },
    });

    const result = await executeAIHostedFileUpload({
      data: { type: 'data', data: new Uint8Array([1, 2, 3]) },
      mediaType: 'application/pdf',
      filename: 'record.pdf',
      providerOptions,
    }, filesContext(files, { id: 'private-openai' }));

    expect(call?.data).toEqual({ type: 'data', data: new Uint8Array([1, 2, 3]) });
    expect(call?.providerOptions).toEqual({ test: { purpose: 'assistants' } });
    expect(call?.providerOptions).not.toBe(providerOptions);
    expect(Object.isFrozen(call?.providerOptions)).toBe(true);
    expect(Object.isFrozen(call?.providerOptions?.test)).toBe(true);
    expect(result.file).toEqual({
      version: 1,
      providerId: 'private-openai',
      providerReference: { openai: 'file_123' },
    });
    expect(result.byteSize).toBe(3);
    expect(result.createdAt?.toISOString()).toBe('2026-10-04T12:00:00.000Z');
  });

  test('rejects URL sources, unsafe filenames, and oversized fixed inputs before provider I/O', async () => {
    let calls = 0;
    const context = filesContext(filesInterface({
      async uploadFile() {
        calls += 1;
        return { providerReference: { test: 'unused' }, warnings: [] };
      },
    }));

    await expect(executeAIHostedFileUpload({
      data: { type: 'url', url: new URL('http://127.0.0.1/private') } as never,
      mediaType: 'application/pdf',
    }, context)).rejects.toMatchObject({ code: 'AI_REQUEST_INVALID', status: 400 });
    await expect(executeAIHostedFileUpload({
      data: { type: 'data', data: new Uint8Array([1]) },
      mediaType: 'application/pdf',
      filename: '../secret.pdf',
    }, context)).rejects.toMatchObject({ code: 'AI_REQUEST_INVALID', status: 400 });
    await expect(executeAIHostedFileUpload({
      data: { type: 'data', data: new Uint8Array([1, 2]) },
      mediaType: 'application/pdf',
      maxBytes: 1,
    }, context)).rejects.toMatchObject({ code: 'AI_REQUEST_LIMIT_EXCEEDED', status: 413 });
    await expect(executeAIHostedFileUpload({
      data: { type: 'data', data: new Uint8Array([1]) },
      mediaType: 'application/pdf',
      maxBytes: AI_DEFAULT_HOSTED_FILE_MAX_BYTES + 1,
    }, context)).rejects.toMatchObject({ code: 'AI_REQUEST_INVALID', status: 400 });
    expect(calls).toBe(0);
  });

  test('bounds streaming uploads and cancels their source on overflow', async () => {
    let cancelled = false;
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
        controller.enqueue(new Uint8Array([4, 5, 6]));
      },
      cancel() {
        cancelled = true;
      },
    });
    const context = filesContext(filesInterface({
      async uploadFile(options) {
        if (options.data.type !== 'stream') throw new Error('expected stream');
        const reader = options.data.stream.getReader();
        while (!(await reader.read()).done) {
          // Consume exactly as a streaming provider would.
        }
        return { providerReference: { test: 'never' }, warnings: [] };
      },
    }));

    await expect(executeAIHostedFileUpload({
      data: { type: 'stream', stream: source },
      mediaType: 'application/octet-stream',
      maxBytes: 4,
    }, context)).rejects.toMatchObject({ code: 'AI_REQUEST_LIMIT_EXCEEDED', status: 413 });
    expect(cancelled).toBe(true);
  });

  test('settles download telemetry only when the stream closes or is cancelled', async () => {
    const events: PlatformEvent[] = [];
    const previous = getPlatformSink();
    setPlatformSink({ emit(event) { events.push(event); } });
    try {
      const context = filesContext(filesInterface({
        async uploadFile() {
          return { providerReference: { test: 'unused' }, warnings: [] };
        },
        async downloadFile() {
          return {
            content: new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(new Uint8Array([1, 2, 3]));
                controller.close();
              },
            }),
            mediaType: 'application/octet-stream',
            warnings: [],
          };
        },
      }), { capabilities: { fileDownload: true } });
      const file = {
        version: 1 as const,
        providerId: 'files',
        providerReference: { test: 'file_1' },
      };
      const result = await executeAIHostedFileDownload({ file }, context);

      expect(events.filter((event) => event.code === OBS_CODES.AI_REQUEST_COMPLETED.code)).toHaveLength(0);
      expect(new Uint8Array(await new Response(result.content).arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
      expect(events.filter((event) => event.code === OBS_CODES.AI_REQUEST_COMPLETED.code)).toHaveLength(1);

      const cancelled = await executeAIHostedFileDownload({ file }, context);
      await cancelled.content.cancel('caller no longer needs it');
      expect(events.filter((event) => event.code === OBS_CODES.AI_REQUEST_FAILED.code)).toHaveLength(1);
    } finally {
      setPlatformSink(previous);
    }
  });

  test('aborts a pending provider stream after headers have been returned', async () => {
    const events: PlatformEvent[] = [];
    const previous = getPlatformSink();
    const controller = new AbortController();
    let sourceCancelled = false;
    setPlatformSink({ emit(event) { events.push(event); } });
    try {
      const context = filesContext(filesInterface({
        async uploadFile() {
          return { providerReference: { test: 'unused' }, warnings: [] };
        },
        async downloadFile() {
          return {
            content: new ReadableStream<Uint8Array>({
              cancel() {
                sourceCancelled = true;
              },
            }),
            mediaType: 'application/octet-stream',
            warnings: [],
          };
        },
      }), { capabilities: { fileDownload: true } });
      const result = await executeAIHostedFileDownload({
        file: {
          version: 1,
          providerId: 'files',
          providerReference: { test: 'file_1' },
        },
        abortSignal: controller.signal,
      }, context);

      const reader = result.content.getReader();
      const pending = reader.read();
      controller.abort();

      await expect(pending).rejects.toMatchObject({
        code: 'AI_REQUEST_ABORTED',
        status: 499,
      });
      expect(sourceCancelled).toBe(true);
      expect(events.filter((event) => event.code === OBS_CODES.AI_REQUEST_COMPLETED.code))
        .toHaveLength(0);
      expect(events.filter((event) => event.code === OBS_CODES.AI_REQUEST_FAILED.code))
        .toHaveLength(1);
    } finally {
      setPlatformSink(previous);
    }
  });

  test('enforces download byte limits during consumption', async () => {
    let sourceCancelled = false;
    const context = filesContext(filesInterface({
      async uploadFile() {
        return { providerReference: { test: 'unused' }, warnings: [] };
      },
      async downloadFile() {
        return {
          content: new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new Uint8Array([1, 2, 3]));
              controller.enqueue(new Uint8Array([4, 5, 6]));
            },
            cancel() {
              sourceCancelled = true;
            },
          }),
          warnings: [],
        };
      },
    }), { capabilities: { fileDownload: true } });
    const result = await executeAIHostedFileDownload({
      file: { version: 1, providerId: 'files', providerReference: { test: 'file_1' } },
      maxBytes: 4,
    }, context);
    const reader = result.content.getReader();
    expect((await reader.read()).value).toEqual(new Uint8Array([1, 2, 3]));
    await expect(reader.read()).rejects.toMatchObject({
      code: 'AI_REQUEST_LIMIT_EXCEEDED',
      status: 413,
    });
    expect(sourceCancelled).toBe(true);
  });

  test('gates optional metadata and delete operations and retains merged references', async () => {
    const unsupported = filesContext(filesInterface({
      async uploadFile() {
        return { providerReference: { test: 'unused' }, warnings: [] };
      },
    }));
    const file = { version: 1 as const, providerId: 'files', providerReference: { test: 'file_1' } };
    await expect(executeAIHostedFileMetadata({ file }, unsupported)).rejects.toMatchObject({
      code: 'AI_CAPABILITY_NOT_SUPPORTED',
    });

    const supported = filesContext(filesInterface({
      async uploadFile() {
        return { providerReference: { test: 'unused' }, warnings: [] };
      },
      async getFileMetadata() {
        return { providerReference: { mirror: 'file_2' }, byteSize: 8, warnings: [] };
      },
      async deleteFile() {
        return { providerReference: { mirror: 'file_2' }, deleted: true, warnings: [] };
      },
    }), { capabilities: { fileMetadata: true, fileDelete: true } });
    const metadata = await executeAIHostedFileMetadata({ file }, supported);
    expect(metadata.file.providerReference).toEqual({ test: 'file_1', mirror: 'file_2' });
    const deleted = await executeAIHostedFileDelete({ file }, supported);
    expect(deleted.deleted).toBe(true);
    expect(deleted.file.providerReference).toEqual({ test: 'file_1', mirror: 'file_2' });
  });
});

function filesInterface(overrides: Pick<FilesV4, 'uploadFile'> & Partial<FilesV4>): FilesV4 {
  return {
    specificationVersion: 'v4',
    provider: 'canonical.files',
    ...overrides,
  };
}

function filesContext(
  files: FilesV4,
  options: {
    id?: string;
    capabilities?: Partial<AIProviderCapabilities>;
  } = {}
) {
  const id = options.id ?? 'files';
  const capabilities: ResolvedAIProviderCapabilities = {
    text: false,
    streaming: false,
    tools: false,
    vision: false,
    embeddings: false,
    images: false,
    transcription: false,
    speech: false,
    reranking: false,
    video: false,
    files: true,
    fileMetadata: false,
    fileDownload: false,
    fileDelete: false,
    skills: false,
    realtime: false,
    evaluation: false,
    batch: false,
    ...options.capabilities,
  };
  const provider: ResolvedAIProviderConfig = {
    id,
    type: 'custom',
    enabled: true,
    active: true,
    source: 'config',
    configuredBy: ['test'],
    capabilities,
    reason: null,
    adapter: {} as ProviderV4,
  };
  const registry: AIRegistry = {
    providers: { [id]: provider },
    providerInstances: { [id]: {} as ProviderV4 },
    registry: {
      files(providerId: string) {
        if (providerId !== id) throw new Error('unknown files provider');
        return files;
      },
    } as AIRegistry['registry'],
  };
  return { registry, defaultProvider: id };
}
