import { describe, expect, test } from 'bun:test';

import { resolveAIConfig } from './ai-env';
import { AIService } from './ai-service';
import type {
  AIProviderConfig,
  AIProviderInstanceSettings,
  AIProviderType,
} from './ai-types';

describe('current official AI SDK provider environment contracts', () => {
  test('activates the API-key providers from their documented variables', () => {
    for (const [id, envKey, capability] of [
      ['prodia', 'PRODIA_TOKEN', 'images'],
      ['klingai', 'KLINGAI_API_KEY', 'video'],
      ['cartesia', 'CARTESIA_API_KEY', 'speech'],
      ['gmicloud', 'GMI_CLOUD_APIKEY', 'text'],
      ['topaz', 'TOPAZ_API_KEY', 'images'],
    ] as const) {
      const config = resolveAIConfig(true, { [envKey]: 'zero-test-key' });
      expect(config).not.toBe(false);
      if (config === false) continue;

      expect(config.providers[id]).toMatchObject({
        active: true,
        reason: null,
        configuredBy: [envKey],
        capabilities: { [capability]: true },
      });
    }

    const prodia = resolveAIConfig(true, { PRODIA_TOKEN: 'zero-test-key' });
    expect(prodia).not.toBe(false);
    if (prodia !== false) {
      expect(prodia.providers.prodia.capabilities).toMatchObject({
        text: true,
        streaming: true,
        tools: false,
        vision: true,
        images: true,
        video: true,
      });
    }
  });

  test('supports both Claude Platform on AWS credential modes without mixing them', () => {
    const apiKey = resolveAIConfig(true, {
      ANTHROPIC_AWS_API_KEY: 'anthropic-aws-key',
      ANTHROPIC_AWS_WORKSPACE_ID: 'wrkspc_zero',
      AWS_REGION: 'us-east-1',
      AWS_ACCESS_KEY_ID: 'ambient-access-key',
      AWS_SECRET_ACCESS_KEY: 'ambient-secret-key',
    });
    const sigV4 = resolveAIConfig(true, {
      ANTHROPIC_AWS_WORKSPACE_ID: 'wrkspc_zero',
      AWS_REGION: 'us-west-2',
      AWS_ACCESS_KEY_ID: 'sigv4-access-key',
      AWS_SECRET_ACCESS_KEY: 'sigv4-secret-key',
      AWS_SESSION_TOKEN: 'sigv4-session-token',
    });

    expect(apiKey).not.toBe(false);
    expect(sigV4).not.toBe(false);
    if (apiKey === false || sigV4 === false) return;

    expect(apiKey.providers['anthropic-aws']).toMatchObject({
      active: true,
      apiKey: 'anthropic-aws-key',
      configuredBy: [
        'ANTHROPIC_AWS_API_KEY',
        'ANTHROPIC_AWS_WORKSPACE_ID',
        'AWS_REGION',
      ],
      settings: { workspaceId: 'wrkspc_zero', region: 'us-east-1' },
    });
    expect(apiKey.providers['anthropic-aws'].settings).not.toHaveProperty('accessKeyId');
    expect(sigV4.providers['anthropic-aws']).toMatchObject({
      active: true,
      apiKey: undefined,
      configuredBy: [
        'ANTHROPIC_AWS_WORKSPACE_ID',
        'AWS_REGION',
        'AWS_ACCESS_KEY_ID',
        'AWS_SECRET_ACCESS_KEY',
        'AWS_SESSION_TOKEN',
      ],
      settings: {
        workspaceId: 'wrkspc_zero',
        region: 'us-west-2',
        accessKeyId: 'sigv4-access-key',
        secretAccessKey: 'sigv4-secret-key',
        sessionToken: 'sigv4-session-token',
      },
    });
  });

  test('supports Kling legacy credentials while preferring an API key', () => {
    const legacy = resolveAIConfig(true, {
      KLINGAI_ACCESS_KEY: 'legacy-access',
      KLINGAI_SECRET_KEY: 'legacy-secret',
    });
    const apiKey = resolveAIConfig(true, {
      KLINGAI_API_KEY: 'modern-key',
      KLINGAI_ACCESS_KEY: 'ignored-access',
      KLINGAI_SECRET_KEY: 'ignored-secret',
    });

    expect(legacy).not.toBe(false);
    expect(apiKey).not.toBe(false);
    if (legacy === false || apiKey === false) return;

    expect(legacy.providers.klingai).toMatchObject({
      active: true,
      configuredBy: ['KLINGAI_ACCESS_KEY', 'KLINGAI_SECRET_KEY'],
      settings: { accessKey: 'legacy-access', secretKey: 'legacy-secret' },
    });
    expect(apiKey.providers.klingai).toMatchObject({
      active: true,
      apiKey: 'modern-key',
      configuredBy: ['KLINGAI_API_KEY'],
    });
    expect(apiKey.providers.klingai.settings).toBeUndefined();
  });

  test('reports incomplete cloud credentials without constructing a client', () => {
    const cases: Array<{
      providers: Record<string, AIProviderConfig>;
      reason: string;
    }> = [
      {
        providers: {
          aws: {
            type: 'anthropic-aws' as const,
            apiKey: 'key',
            settings: { region: 'us-east-1' },
          },
        },
        reason: 'missing_workspace_id',
      },
      {
        providers: {
          aws: {
            type: 'anthropic-aws' as const,
            settings: {
              workspaceId: 'wrkspc_zero',
              region: 'us-east-1',
              accessKeyId: 'access-only',
            },
          },
        },
        reason: 'partial_aws_credentials',
      },
      {
        providers: {
          kling: {
            type: 'klingai' as const,
            settings: { accessKey: 'access-only' },
          },
        },
        reason: 'partial_klingai_credentials',
      },
    ];

    for (const testCase of cases) {
      const config = resolveAIConfig({
        autoDetect: false,
        providers: testCase.providers,
      }, {});
      expect(config).not.toBe(false);
      if (config === false) continue;
      expect(Object.values(config.providers)[0]).toMatchObject({
        active: false,
        reason: testCase.reason,
      });
    }
  });

  test('rejects ambiguous explicit cloud credential modes', () => {
    expect(() => resolveAIConfig({
      autoDetect: false,
      providers: {
        aws: {
          type: 'anthropic-aws',
          apiKey: 'api-key',
          settings: {
            workspaceId: 'wrkspc_zero',
            region: 'us-east-1',
            accessKeyId: 'access-key',
            secretAccessKey: 'secret-key',
          },
        },
      },
    }, {})).toThrow('cannot configure both apiKey and SigV4 credentials');

    expect(() => resolveAIConfig({
      autoDetect: false,
      providers: {
        kling: {
          type: 'klingai',
          apiKey: 'api-key',
          settings: { accessKey: 'access-key', secretKey: 'secret-key' },
        },
      },
    }, {})).toThrow('cannot configure both apiKey and legacy access-key credentials');
  });

  test('normalizes provider-specific settings and rejects unusable constructors', () => {
    class TestWebSocket {}
    const testWebSocket = TestWebSocket as unknown as NonNullable<
      AIProviderInstanceSettings['webSocket']
    >;
    const config = resolveAIConfig({
      autoDetect: false,
      providers: {
        cartesia: {
          type: 'cartesia',
          apiKey: 'cartesia-key',
          settings: {
            version: ' 2025-04-16 ',
            webSocket: testWebSocket,
          },
        },
        kling: {
          type: 'klingai',
          settings: { accessKey: ' legacy-access ', secretKey: ' legacy-secret ' },
        },
      },
    }, {});

    expect(config).not.toBe(false);
    if (config === false) return;
    expect(config.providers.cartesia.settings?.version).toBe('2025-04-16');
    expect(config.providers.cartesia.settings?.webSocket).toBe(testWebSocket);
    expect(config.providers.kling.settings).toEqual({
      accessKey: 'legacy-access',
      secretKey: 'legacy-secret',
    });

    expect(() => resolveAIConfig({
      autoDetect: false,
      providers: {
        cartesia: {
          type: 'cartesia',
          apiKey: 'cartesia-key',
          settings: { webSocket: (() => undefined) as never },
        },
      },
    }, {})).toThrow('settings.webSocket must be a constructable function');
  });
});

describe('current official adapters through Zero public operations', () => {
  test('routes text, image, video, speech, and transcription calls to each adapter', async () => {
    await expectProviderRequest('anthropic-aws', {
      settings: { workspaceId: 'wrkspc_zero', region: 'us-east-1' },
      capability: 'text',
      model: 'claude-sonnet-4-5',
      invoke: (service, model) => service.generateText({
        model,
        prompt: 'Hello.',
        maxRetries: 0,
      }),
      expectedHeader: ['x-api-key', 'zero-test-key'],
    });
    await expectProviderRequest('anthropic-aws', {
      apiKey: null,
      settings: {
        workspaceId: 'wrkspc_zero',
        region: 'us-east-1',
        accessKeyId: 'AKIAZEROFAKE00000000',
        secretAccessKey: 'zero-test-secret-never-send',
      },
      capability: 'text',
      model: 'claude-sonnet-4-5',
      invoke: (service, model) => service.generateText({
        model,
        prompt: 'Hello.',
        maxRetries: 0,
      }),
      expectedHeader: ['authorization', /^AWS4-HMAC-SHA256 Credential=AKIAZEROFAKE00000000\//],
    });
    await expectProviderRequest('gmicloud', {
      capability: 'text',
      model: 'deepseek-ai/DeepSeek-V4-Flash-0731',
      invoke: (service, model) => service.generateText({
        model,
        prompt: 'Hello.',
        maxRetries: 0,
      }),
      expectedHeader: ['authorization', 'Bearer zero-test-key'],
    });
    await expectProviderRequest('prodia', {
      capability: 'text',
      model: 'inference.nano-banana.img2img.v2',
      invoke: (service, model) => service.generateConversation({
        model,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: 'Turn this into a watercolor.' },
            {
              type: 'file',
              data: new Uint8Array([137, 80, 78, 71]),
              mediaType: 'image/png',
            },
          ],
        }],
        maxRetries: 0,
      }),
      expectedHeader: ['authorization', 'Bearer zero-test-key'],
    });
    await expectProviderRequest('prodia', {
      capability: 'text',
      model: 'inference.nano-banana.img2img.v2',
      invoke: async (service, model) => {
        const result = service.streamConversation({
          model,
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: 'Turn this into a watercolor.' },
              {
                type: 'file',
                data: new Uint8Array([137, 80, 78, 71]),
                mediaType: 'image/png',
              },
            ],
          }],
          maxRetries: 0,
        });
        await result.text;
      },
      expectedHeader: ['authorization', 'Bearer zero-test-key'],
    });
    await expectProviderRequest('prodia', {
      capability: 'image',
      model: 'inference.flux-fast.schnell.txt2img.v2',
      invoke: (service, model) => service.generateImage({
        model,
        prompt: 'A quiet lake.',
        maxRetries: 0,
      }),
      expectedHeader: ['authorization', 'Bearer zero-test-key'],
    });
    await expectProviderRequest('prodia', {
      capability: 'video',
      model: 'inference.wan2-2.lightning.txt2vid.v0',
      invoke: (service, model) => service.video.generate({
        model,
        prompt: 'A quiet lake at sunrise.',
        maxRetries: 0,
      }),
      expectedHeader: ['authorization', 'Bearer zero-test-key'],
    });
    await expectProviderRequest('klingai', {
      capability: 'video',
      model: 'kling-v3.0-t2v',
      invoke: (service, model) => service.video.generate({
        model,
        prompt: 'A quiet lake.',
        maxRetries: 0,
      }),
      expectedHeader: ['authorization', 'Bearer zero-test-key'],
    });
    await expectProviderRequest('klingai', {
      apiKey: null,
      settings: { accessKey: 'legacy-access', secretKey: 'legacy-secret' },
      capability: 'video',
      model: 'kling-v3.0-t2v',
      invoke: (service, model) => service.video.generate({
        model,
        prompt: 'A quiet lake.',
        maxRetries: 0,
      }),
      expectedHeader: ['authorization', /^Bearer [^.]+\.[^.]+\.[^.]+$/],
    });
    await expectProviderRequest('cartesia', {
      baseURL: 'https://cartesia-proxy.example.test/edge',
      capability: 'speech',
      model: 'sonic-3.5',
      invoke: (service, model) => service.generateSpeech({
        model,
        text: 'Hello.',
        voice: 'zero-test-voice',
        maxRetries: 0,
      }),
      expectedHeader: ['authorization', 'Bearer zero-test-key'],
      expectedURLPrefix: 'https://cartesia-proxy.example.test/edge/',
    });
    await expectProviderRequest('cartesia', {
      capability: 'transcription',
      model: 'ink-whisper',
      invoke: (service, model) => service.transcribe({
        model,
        audio: new Uint8Array([1, 2, 3, 4]),
        maxRetries: 0,
      }),
      expectedHeader: ['authorization', 'Bearer zero-test-key'],
    });
    await expectProviderRequest('topaz', {
      capability: 'image',
      model: 'wonder-3.5',
      invoke: (service, model) => service.generateImage({
        model,
        prompt: { images: [new Uint8Array([1, 2, 3, 4])] },
        size: '1024x1024',
        maxRetries: 0,
      }),
      expectedHeader: ['x-api-key', 'zero-test-key'],
    });
  });
});

interface ProviderRequestCase {
  apiKey?: string | null;
  baseURL?: string;
  settings?: AIProviderInstanceSettings;
  capability: 'text' | 'image' | 'video' | 'speech' | 'transcription';
  model: string;
  invoke(service: AIService, model: string): Promise<unknown>;
  expectedHeader: readonly [string, string | RegExp];
  expectedURLPrefix?: string;
}

async function expectProviderRequest(
  type: AIProviderType,
  testCase: ProviderRequestCase,
): Promise<void> {
  const requests: Request[] = [];
  const rejectingFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push(input instanceof Request ? input.clone() : new Request(input, init));
    throw new Error('zero-test-request-boundary');
  }) as unknown as typeof fetch;
  const provider: AIProviderConfig = {
    type,
    apiKey: testCase.apiKey === undefined ? 'zero-test-key' : testCase.apiKey,
    baseURL: testCase.baseURL,
    settings: testCase.settings,
    fetch: rejectingFetch,
  };
  const reference = `official/${testCase.model}`;
  const config = resolveAIConfig({
    autoDetect: false,
    providers: { official: provider },
    aliases: { [testCase.capability]: reference },
  }, {});
  expect(config).not.toBe(false);
  if (config === false) return;

  await expect(testCase.invoke(new AIService(config, { emitCode: () => undefined }), reference))
    .rejects.toBeDefined();
  expect(requests.length, `${type} ${testCase.capability}`).toBeGreaterThan(0);
  const header = requests[0].headers.get(testCase.expectedHeader[0]);
  if (testCase.expectedHeader[1] instanceof RegExp) {
    expect(header).toMatch(testCase.expectedHeader[1]);
  } else {
    expect(header).toBe(testCase.expectedHeader[1]);
  }
  if (testCase.expectedURLPrefix) {
    expect(requests[0].url).toStartWith(testCase.expectedURLPrefix);
  }
}
