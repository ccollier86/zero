import { describe, expect, test } from 'bun:test';

import { resolveAIConfig } from './ai-env';
import {
  createAIRegistry,
  resolveImageModel,
  resolveLanguageModel,
  resolveRerankingModel,
  resolveSpeechModel,
  resolveTranscriptionModel,
} from './ai-registry';
import { AIService } from './ai-service';
import type {
  AIFetchFunction,
  AIConfig,
  AIProviderConfig,
  ResolvedAIConfig,
} from './ai-types';

describe('AI provider request contracts', () => {
  test('sends Anthropic bearer tokens through Authorization instead of x-api-key', async () => {
    let request: Request | null = null;
    const config = resolveRequiredConfig({
      autoDetect: false,
      providers: {
        anthropic: {
          type: 'anthropic',
          apiKey: null,
          settings: { authToken: 'zero-anthropic-bearer' },
          fetch: async (input, init) => {
            request = new Request(input, init);
            return Response.json({
              id: 'msg_zero',
              type: 'message',
              role: 'assistant',
              model: 'claude-haiku-4-5',
              content: [{ type: 'text', text: 'Bearer auth works.' }],
              stop_reason: 'end_turn',
              stop_sequence: null,
              usage: { input_tokens: 2, output_tokens: 3 },
            });
          },
        },
      },
      aliases: { smart: 'anthropic/claude-haiku-4-5' },
    });

    const result = await new AIService(config).generateText({ prompt: 'Authenticate.' });
    expect(result.text).toBe('Bearer auth works.');
    const captured = request as unknown as Request;
    expect(captured.headers.get('authorization')).toBe('Bearer zero-anthropic-bearer');
    expect(captured.headers.get('x-api-key')).toBeNull();
  });

  test('keeps explicit Anthropic bearer auth authoritative over an ambient API key', async () => {
    await withEnvironmentValues({
      ANTHROPIC_API_KEY: 'ambient-anthropic-api-key',
    }, async () => {
      const request = await captureLanguageProviderRequest(
        'anthropic',
        {
          type: 'anthropic',
          apiKey: null,
          settings: { authToken: 'explicit-anthropic-bearer' },
        },
        'anthropic/claude-haiku-4-5'
      );
      expect(request.headers.get('authorization'))
        .toBe('Bearer explicit-anthropic-bearer');
      expect(request.headers.get('x-api-key')).toBeNull();
    });
  });

  test('keeps nested Gateway model ids intact at the request boundary', async () => {
    const captured = rejectingFetch();
    const config = resolveRequiredConfig({
      autoDetect: false,
      providers: {
        gateway: {
          type: 'gateway',
          apiKey: 'gateway-key',
          settings: { teamIdOrSlug: 'team_zero' },
          fetch: captured.fetch,
        },
      },
    });
    const { model } = resolveLanguageModel(
      createAIRegistry(config),
      {},
      'gateway/anthropic/claude-opus-4.5'
    );
    if (typeof model === 'string') throw new Error('Gateway returned a string model.');

    await expect(model.doGenerate({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'Hello.' }] }],
    } as any)).rejects.toThrow('expected request boundary');

    expect(captured.request?.url).toContain('/language-model');
    expect(captured.request?.headers.get('ai-language-model-id'))
      .toBe('anthropic/claude-opus-4.5');
    expect(captured.request?.headers.get('x-vercel-ai-gateway-team')).toBe('team_zero');
  });

  test('forwards Azure API-key and Entra auth modes to actual requests', async () => {
    const apiKeyRequest = await captureAzureRequest({ apiKey: 'azure-key' });
    expect(apiKeyRequest.headers.get('api-key')).toBe('azure-key');
    expect(apiKeyRequest.headers.get('authorization')).toBeNull();

    const entraRequest = await captureAzureRequest({
      apiKey: null,
      settings: { tokenProvider: async () => 'zero-entra-token' },
    });
    expect(entraRequest.headers.get('authorization')).toBe('Bearer zero-entra-token');
    expect(entraRequest.headers.get('api-key')).toBeNull();
  });

  test('distinguishes omitted and suppressed OpenAI endpoints at the request boundary', async () => {
    await withEnvironmentValues({
      OPENAI_BASE_URL: 'https://ambient-openai.example.test/v1',
    }, async () => {
      const inherited = await captureLanguageProviderRequest(
        'openai',
        { type: 'openai', apiKey: 'openai-key' },
        'openai/gpt-4o-mini'
      );
      expect(inherited.url).toStartWith('https://ambient-openai.example.test/v1/');

      const suppressed = await captureLanguageProviderRequest(
        'openai',
        { type: 'openai', apiKey: 'openai-key', baseURL: null },
        'openai/gpt-4o-mini'
      );
      expect(suppressed.url).toStartWith('https://api.openai.com/v1/');
    });
  });

  test('distinguishes omitted and suppressed Anthropic endpoints at the request boundary', async () => {
    await withEnvironmentValues({
      ANTHROPIC_BASE_URL: 'https://ambient-anthropic.example.test/v1',
    }, async () => {
      const inherited = await captureLanguageProviderRequest(
        'anthropic',
        { type: 'anthropic', apiKey: 'anthropic-key' },
        'anthropic/claude-haiku-4-5'
      );
      expect(inherited.url).toStartWith('https://ambient-anthropic.example.test/v1/');

      const suppressed = await captureLanguageProviderRequest(
        'anthropic',
        { type: 'anthropic', apiKey: 'anthropic-key', baseURL: null },
        'anthropic/claude-haiku-4-5'
      );
      expect(suppressed.url).toStartWith('https://api.anthropic.com/v1/');
    });
  });

  test('honors Bedrock endpoint precedence and explicit suppression at the request boundary', async () => {
    await withEnvironmentValues({
      AMAZON_BEDROCK_BASE_URL: undefined,
      BEDROCK_BASE_URL: undefined,
      AWS_ENDPOINT_URL_BEDROCK_RUNTIME: 'https://service-bedrock.example.test',
      AWS_ENDPOINT_URL: 'https://generic-aws.example.test',
    }, async () => {
      const settings = {
        region: 'us-east-1',
        accessKeyId: 'AKIAZEROEXPLICIT0000',
        secretAccessKey: 'zero-explicit-secret-never-send',
      };
      const inherited = await captureLanguageProviderRequest(
        'bedrock',
        { type: 'amazon-bedrock', apiKey: null, settings },
        'bedrock/amazon.nova-micro-v1:0'
      );
      expect(inherited.url).toStartWith('https://service-bedrock.example.test/');

      const suppressed = await captureLanguageProviderRequest(
        'bedrock',
        { type: 'amazon-bedrock', apiKey: null, baseURL: null, settings },
        'bedrock/amazon.nova-micro-v1:0'
      );
      expect(suppressed.url).toStartWith(
        'https://bedrock-runtime.us-east-1.amazonaws.com/'
      );
    });
  });

  test('routes Bedrock reranking through Agent Runtime without misrouting model calls', async () => {
    const captured = rejectingFetch();
    const config = resolveRequiredConfig({
      autoDetect: false,
      providers: {
        bedrock: {
          type: 'amazon-bedrock',
          apiKey: null,
          fetch: captured.fetch,
          settings: {
            region: 'us-east-1',
            accessKeyId: 'AKIAZEROEXPLICIT0000',
            secretAccessKey: 'zero-explicit-secret-never-send',
            runtimeBaseURL: 'https://runtime.bedrock.example.test',
            agentRuntimeBaseURL: 'https://agent.bedrock.example.test',
          },
        },
      },
    });
    const registry = createAIRegistry(config);
    const language = resolveLanguageModel(
      registry,
      {},
      'bedrock/amazon.nova-micro-v1:0'
    ).model;
    if (typeof language === 'string') throw new Error('Bedrock returned a string model.');
    await expect(language.doGenerate({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'Hello.' }] }],
    } as any)).rejects.toThrow('expected request boundary');
    expect(captured.request?.url).toStartWith('https://runtime.bedrock.example.test/');

    const reranking = resolveRerankingModel(
      registry,
      {},
      'bedrock/amazon.rerank-v1:0'
    ).model;
    if (typeof reranking === 'string') throw new Error('Bedrock returned a string reranker.');
    await expect(reranking.doRerank({
      documents: { type: 'text', values: ['first', 'second'] },
      query: 'best',
      topN: 1,
    } as any)).rejects.toThrow('expected request boundary');
    expect(captured.request?.url).toBe('https://agent.bedrock.example.test/rerank');
  });

  test('distinguishes omitted and suppressed QuiverAI endpoints at the request boundary', async () => {
    await withEnvironmentValues({
      QUIVERAI_BASE_URL: 'https://ambient-quiver.example.test/v1',
    }, async () => {
      const inherited = await captureImageProviderRequest(
        'quiverai',
        { type: 'quiverai', apiKey: 'quiver-key' },
        'quiverai/arrow-2'
      );
      expect(inherited.url).toStartWith('https://ambient-quiver.example.test/v1/');

      const suppressed = await captureImageProviderRequest(
        'quiverai',
        { type: 'quiverai', apiKey: 'quiver-key', baseURL: null },
        'quiverai/arrow-2'
      );
      expect(suppressed.url).toStartWith('https://api.quiver.ai/v1/');
    });
  });

  test('rewrites fixed ElevenLabs endpoints through the configured provider base URL', async () => {
    const captured = rejectingFetch();
    const config = resolveRequiredConfig({
      autoDetect: false,
      providers: {
        elevenlabs: {
          type: 'elevenlabs',
          apiKey: 'elevenlabs-key',
          baseURL: 'https://speech-proxy.example.test/elevenlabs',
          fetch: captured.fetch,
        },
      },
    });
    const { model } = resolveSpeechModel(
      createAIRegistry(config),
      {},
      'elevenlabs/eleven_multilingual_v2'
    );
    if (typeof model === 'string') throw new Error('ElevenLabs returned a string model.');

    await expect(model.doGenerate({ text: 'Hello.' } as any))
      .rejects.toThrow('expected request boundary');
    expect(captured.request?.url).toStartWith(
      'https://speech-proxy.example.test/elevenlabs/v1/text-to-speech/'
    );
  });

  test('routes every advertised fal.ai modality through its configured base URL', async () => {
    const captured = rejectingFetch();
    const config = resolveRequiredConfig({
      autoDetect: false,
      providers: {
        fal: {
          type: 'fal',
          apiKey: 'fal-key',
          baseURL: 'https://fal-proxy.example.test/root',
          fetch: captured.fetch,
        },
      },
    });
    const registry = createAIRegistry(config);

    const image = resolveImageModel(registry, {}, 'fal/fal-ai/flux/schnell').model;
    if (typeof image === 'string') throw new Error('fal.ai returned a string image model.');
    await expect(image.doGenerate({ prompt: 'A test image.', n: 1 } as any))
      .rejects.toThrow('expected request boundary');
    expect(captured.request?.url).toStartWith(
      'https://fal-proxy.example.test/root/fal-ai/flux/schnell'
    );

    const speech = resolveSpeechModel(registry, {}, 'fal/fal-ai/minimax/speech-02-hd').model;
    if (typeof speech === 'string') throw new Error('fal.ai returned a string speech model.');
    await expect(speech.doGenerate({ text: 'Hello.' } as any))
      .rejects.toThrow('expected request boundary');
    expect(captured.request?.url).toBe(
      'https://fal-proxy.example.test/root/fal-ai/minimax/speech-02-hd'
    );

    const transcription = resolveTranscriptionModel(registry, {}, 'fal/whisper').model;
    if (typeof transcription === 'string') {
      throw new Error('fal.ai returned a string transcription model.');
    }
    await expect(transcription.doGenerate({
      audio: new Uint8Array([1, 2, 3]),
      mediaType: 'audio/mpeg',
    } as any)).rejects.toThrow('expected request boundary');
    expect(captured.request?.url).toBe(
      'https://fal-proxy.example.test/root/fal-ai/whisper'
    );
  });
});

async function captureAzureRequest(
  credential: Pick<NonNullable<AIConfig['providers']>[string], never> & {
    apiKey?: string | null;
    settings?: { tokenProvider?: () => Promise<string> };
  }
): Promise<Request> {
  const captured = rejectingFetch();
  const config = resolveRequiredConfig({
    autoDetect: false,
    providers: {
      azure: {
        type: 'azure',
        baseURL: 'https://zero-resource.openai.azure.com/openai',
        fetch: captured.fetch,
        ...credential,
      },
    },
  });
  const { model } = resolveLanguageModel(createAIRegistry(config), {}, 'azure/gpt-4o');
  if (typeof model === 'string') throw new Error('Azure returned a string model.');
  await expect(model.doGenerate({
    prompt: [{ role: 'user', content: [{ type: 'text', text: 'Hello.' }] }],
  } as any)).rejects.toThrow('expected request boundary');
  if (!captured.request) throw new Error('Azure did not reach the request boundary.');
  return captured.request;
}

async function captureLanguageProviderRequest(
  providerId: string,
  provider: AIProviderConfig,
  modelReference: string
): Promise<Request> {
  const captured = rejectingFetch();
  const config = resolveRequiredRuntimeConfig({
    autoDetect: false,
    providers: {
      [providerId]: { ...provider, fetch: captured.fetch },
    },
  });
  const { model } = resolveLanguageModel(createAIRegistry(config), {}, modelReference);
  if (typeof model === 'string') {
    throw new Error(`${providerId} returned a string model.`);
  }
  await expect(model.doGenerate({
    prompt: [{ role: 'user', content: [{ type: 'text', text: 'Hello.' }] }],
  } as any)).rejects.toThrow('expected request boundary');
  if (!captured.request) throw new Error(`${providerId} did not reach the request boundary.`);
  return captured.request;
}

async function captureImageProviderRequest(
  providerId: string,
  provider: AIProviderConfig,
  modelReference: string
): Promise<Request> {
  const captured = rejectingFetch();
  const config = resolveRequiredRuntimeConfig({
    autoDetect: false,
    providers: {
      [providerId]: { ...provider, fetch: captured.fetch },
    },
  });
  const { model } = resolveImageModel(createAIRegistry(config), {}, modelReference);
  if (typeof model === 'string') {
    throw new Error(`${providerId} returned a string model.`);
  }
  await expect(model.doGenerate({ prompt: 'A test image.', n: 1 } as any))
    .rejects.toThrow('expected request boundary');
  if (!captured.request) throw new Error(`${providerId} did not reach the request boundary.`);
  return captured.request;
}

function rejectingFetch(): { fetch: AIFetchFunction; request: Request | null } {
  const capture = {
    request: null as Request | null,
    fetch: undefined as unknown as AIFetchFunction,
  };
  capture.fetch = (async (input, init) => {
    capture.request = new Request(input, init);
    throw new Error('expected request boundary');
  }) as AIFetchFunction;
  return capture;
}

function resolveRequiredConfig(config: AIConfig): ResolvedAIConfig {
  const resolved = resolveAIConfig(config, {});
  if (resolved === false) throw new Error('AI unexpectedly resolved as disabled.');
  return resolved;
}

function resolveRequiredRuntimeConfig(config: AIConfig): ResolvedAIConfig {
  const resolved = resolveAIConfig(config);
  if (resolved === false) throw new Error('AI unexpectedly resolved as disabled.');
  return resolved;
}

async function withEnvironmentValues(
  values: Record<string, string | undefined>,
  run: () => Promise<void>
): Promise<void> {
  const previous = new Map(
    Object.keys(values).map((key) => [key, Bun.env[key]] as const)
  );
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete Bun.env[key];
    else Bun.env[key] = value;
  }
  try {
    await run();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete Bun.env[key];
      else Bun.env[key] = value;
    }
  }
}

async function settleWithin<T>(promise: PromiseLike<T>, timeoutMs: number): Promise<T> {
  return Promise.race([
    Promise.resolve(promise),
    Bun.sleep(timeoutMs).then(() => {
      throw new Error(`AI stream did not settle within ${timeoutMs}ms.`);
    }),
  ]);
}
