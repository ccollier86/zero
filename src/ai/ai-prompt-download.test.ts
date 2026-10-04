import { describe, expect, test } from 'bun:test';

import { createAIPromptDownload } from './ai-prompt-download';

describe('AI prompt downloads', () => {
  test('leaves provider-supported URLs remote without resolving or fetching them', async () => {
    let lookups = 0;
    let fetches = 0;
    const download = createAIPromptDownload({
      lookup: async () => {
        lookups += 1;
        return [{ address: '8.8.8.8', family: 4 }];
      },
      fetch: async () => {
        fetches += 1;
        return new Response();
      },
    });

    const result = await download([{
      url: new URL('https://media.example.test/image.png'),
      isUrlSupportedByModel: true,
    }]);

    expect(result).toEqual([null]);
    expect({ lookups, fetches }).toEqual({ lookups: 0, fetches: 0 });
  });

  test('pins a validated public DNS result while retaining HTTP authority and TLS identity', async () => {
    let requestedUrl: URL | undefined;
    let requestedInit: RequestInit & { tls?: { serverName?: string } } = {};
    const download = createAIPromptDownload({
      lookup: async (hostname, port) => {
        expect({ hostname, port }).toEqual({ hostname: 'media.example.test', port: 443 });
        return [{ address: '8.8.8.8', family: 4 }];
      },
      fetch: async (input, init) => {
        requestedUrl = new URL(input.toString());
        requestedInit = init ?? {};
        return new Response(new Uint8Array([1, 2, 3]), {
          headers: { 'content-type': 'image/png' },
        });
      },
    });

    const [result] = await download([{
      url: new URL('https://media.example.test/assets/image.png?version=1'),
      isUrlSupportedByModel: false,
    }]);

    expect(requestedUrl?.toString()).toBe('https://8.8.8.8/assets/image.png?version=1');
    expect(new Headers(requestedInit.headers).get('host')).toBe('media.example.test');
    expect(requestedInit.tls?.serverName).toBe('media.example.test');
    expect(result).toEqual({
      data: new Uint8Array([1, 2, 3]),
      mediaType: 'image/png',
    });
  });

  test('rejects private literal and DNS addresses before opening a connection', async () => {
    let fetches = 0;
    const fetch = async () => {
      fetches += 1;
      return new Response();
    };
    const literal = createAIPromptDownload({ fetch });
    await expect(literal([{
      url: new URL('http://127.0.0.1/private'),
      isUrlSupportedByModel: false,
    }])).rejects.toMatchObject({ code: 'AI_REQUEST_INVALID', status: 400 });

    const resolved = createAIPromptDownload({
      fetch,
      lookup: async () => [
        { address: '8.8.8.8', family: 4 },
        { address: '169.254.169.254', family: 4 },
      ],
    });
    await expect(resolved([{
      url: new URL('https://rebinding.example.test/asset'),
      isUrlSupportedByModel: false,
    }])).rejects.toMatchObject({ code: 'AI_REQUEST_INVALID', status: 400 });
    expect(fetches).toBe(0);
  });

  test('validates every redirect target before issuing its request', async () => {
    let fetches = 0;
    const download = createAIPromptDownload({
      lookup: async () => [{ address: '8.8.8.8', family: 4 }],
      fetch: async () => {
        fetches += 1;
        return new Response(null, {
          status: 302,
          headers: { location: 'http://127.0.0.1/latest' },
        });
      },
    });

    await expect(download([{
      url: new URL('https://public.example.test/start'),
      isUrlSupportedByModel: false,
    }])).rejects.toMatchObject({ code: 'AI_REQUEST_INVALID', status: 400 });
    expect(fetches).toBe(1);
  });

  test('enforces the byte ceiling while streaming bodies without Content-Length', async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
        controller.enqueue(new Uint8Array([4, 5, 6]));
      },
      cancel() {
        cancelled = true;
      },
    });
    const download = createAIPromptDownload({
      maxBytes: 4,
      lookup: async () => [{ address: '8.8.8.8', family: 4 }],
      fetch: async () => new Response(body),
    });

    await expect(download([{
      url: new URL('https://large.example.test/asset'),
      isUrlSupportedByModel: false,
    }])).rejects.toMatchObject({ code: 'AI_REQUEST_LIMIT_EXCEEDED', status: 413 });
    expect(cancelled).toBe(true);
  });

  test('shares one byte budget across every downloaded asset in the request', async () => {
    let fetches = 0;
    const download = createAIPromptDownload({
      maxBytes: 5,
      lookup: async () => [{ address: '8.8.8.8', family: 4 }],
      fetch: async () => {
        fetches += 1;
        return new Response(new Uint8Array([1, 2, 3]));
      },
    });

    await expect(download([
      { url: new URL('https://one.example.test/a'), isUrlSupportedByModel: false },
      { url: new URL('https://two.example.test/b'), isUrlSupportedByModel: false },
    ])).rejects.toMatchObject({ code: 'AI_REQUEST_LIMIT_EXCEEDED', status: 413 });
    expect(fetches).toBe(2);
  });

  test('reports an exhausted exact aggregate budget as a request limit', async () => {
    const download = createAIPromptDownload({
      maxBytes: 3,
      lookup: async () => [{ address: '8.8.8.8', family: 4 }],
      fetch: async () => new Response(new Uint8Array([1, 2, 3])),
    });

    await expect(download([
      { url: new URL('https://one.example.test/a'), isUrlSupportedByModel: false },
      { url: new URL('https://two.example.test/b'), isUrlSupportedByModel: false },
    ])).rejects.toMatchObject({ code: 'AI_REQUEST_LIMIT_EXCEEDED', status: 413 });
  });

  test('maps request cancellation to the stable Zero abort error', async () => {
    const controller = new AbortController();
    controller.abort(new DOMException('cancelled', 'AbortError'));
    const download = createAIPromptDownload({
      abortSignal: controller.signal,
      lookup: async () => [{ address: '8.8.8.8', family: 4 }],
      fetch: async (_input, init) => {
        throw init?.signal?.reason ?? new DOMException('cancelled', 'AbortError');
      },
    });

    await expect(download([{
      url: new URL('https://media.example.test/asset'),
      isUrlSupportedByModel: false,
    }])).rejects.toMatchObject({ code: 'AI_REQUEST_ABORTED', status: 499 });
  });

  test('times out while DNS resolution is still pending', async () => {
    let fetches = 0;
    const download = createAIPromptDownload({
      timeout: { totalMs: 5 },
      lookup: () => new Promise(() => undefined),
      fetch: async () => {
        fetches += 1;
        return new Response();
      },
    });

    await expect(download([{
      url: new URL('https://slow-dns.example.test/asset'),
      isUrlSupportedByModel: false,
    }])).rejects.toMatchObject({ code: 'AI_REQUEST_TIMEOUT', status: 504 });
    expect(fetches).toBe(0);
  });

  test('times out and cancels a response body that stalls after headers', async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
    });
    const download = createAIPromptDownload({
      timeout: { totalMs: 5 },
      lookup: async () => [{ address: '8.8.8.8', family: 4 }],
      fetch: async () => new Response(body),
    });

    await expect(download([{
      url: new URL('https://slow-body.example.test/asset'),
      isUrlSupportedByModel: false,
    }])).rejects.toMatchObject({ code: 'AI_REQUEST_TIMEOUT', status: 504 });
    expect(cancelled).toBe(true);
  });
});
