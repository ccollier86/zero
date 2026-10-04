import { describe, expect, test } from 'bun:test';

import { resolveAIConfig } from './ai-env';
import { AIService } from './ai-service';
import type { AIProviderInstanceSettings } from './ai-types';

describe('cloud AI credential-mode isolation', () => {
  test('allows Bedrock bearer auth with an explicit endpoint and no AWS region', async () => {
    let capturedRequest: Request | null = null;
    const config = resolveAIConfig({
      autoDetect: false,
      providers: {
        bedrock: {
          type: 'amazon-bedrock',
          apiKey: 'zero-bedrock-bearer',
          baseURL: 'https://bedrock-runtime.example.test',
          fetch: (async (input, init) => {
            capturedRequest = new Request(input, init);
            return Response.json({
              output: {
                message: {
                  role: 'assistant',
                  content: [{ text: 'Bearer endpoint works.' }],
                },
              },
              stopReason: 'end_turn',
              usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
            });
          }) as typeof fetch,
        },
      },
      aliases: { smart: 'bedrock/amazon.nova-micro-v1:0' },
    }, {});

    expect(config).not.toBe(false);
    if (config === false) return;
    expect(config.providers.bedrock).toMatchObject({ active: true, reason: null });

    const result = await new AIService(config).generateText({ prompt: 'Use bearer auth.' });
    expect(result.text).toBe('Bearer endpoint works.');
    const request = capturedRequest as unknown as Request;
    expect(request.url).toStartWith('https://bedrock-runtime.example.test/');
    expect(request.headers.get('authorization')).toBe('Bearer zero-bedrock-bearer');
    expect(request.headers.get('x-amz-date')).toBeNull();
  });

  test('keeps explicit Bedrock static credentials on SigV4 when an ambient bearer token exists', async () => {
    await withEnvironment('AWS_BEARER_TOKEN_BEDROCK', 'ambient-bearer-must-not-win', async () => {
      let capturedRequest: Request | null = null;
      const mockFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        capturedRequest = new Request(input, init);
        return Response.json({
          output: {
            message: {
              role: 'assistant',
              content: [{ text: 'SigV4 stayed authoritative.' }],
            },
          },
          stopReason: 'end_turn',
          usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
        });
      }) as typeof fetch;
      const config = resolveAIConfig({
        autoDetect: false,
        providers: {
          bedrock: {
            type: 'amazon-bedrock',
            apiKey: null,
            fetch: mockFetch,
            settings: {
              region: 'us-east-1',
              accessKeyId: 'AKIAZEROEXPLICIT0000',
              secretAccessKey: 'zero-explicit-secret-never-send',
            },
          },
        },
        aliases: { smart: 'bedrock/amazon.nova-micro-v1:0' },
      }, {});

      expect(config).not.toBe(false);
      if (config === false) return;
      expect(config.providers.bedrock.apiKey).toBeUndefined();

      const result = await new AIService(config).generateText({ prompt: 'Confirm the auth mode.' });
      expect(result.text).toBe('SigV4 stayed authoritative.');

      const request = capturedRequest as unknown as Request;
      expect(request.headers.get('authorization')).toStartWith(
        'AWS4-HMAC-SHA256 Credential=AKIAZEROEXPLICIT0000/',
      );
      expect(request.headers.get('authorization')).not.toContain('ambient-bearer-must-not-win');
    });
  });

  test('keeps explicit Vertex ADC on regional OAuth when an ambient express key exists', async () => {
    await withEnvironment('GOOGLE_VERTEX_API_KEY', 'ambient-express-key-must-not-win', async () => {
      let capturedRequest: Request | null = null;
      const mockFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        capturedRequest = new Request(input, init);
        return Response.json({
          candidates: [{
            content: { role: 'model', parts: [{ text: 'ADC stayed authoritative.' }] },
            finishReason: 'STOP',
          }],
          usageMetadata: {
            promptTokenCount: 1,
            candidatesTokenCount: 2,
            totalTokenCount: 3,
          },
        });
      }) as typeof fetch;
      const config = resolveAIConfig({
        autoDetect: false,
        providers: {
          vertex: {
            type: 'google-vertex',
            apiKey: null,
            fetch: mockFetch,
            settings: {
              project: 'zero-adc-project',
              location: 'us-central1',
              googleAuthOptions: {
                authClient: {
                  getAccessToken: async () => ({ token: 'zero-adc-access-token' }),
                },
              } as unknown as NonNullable<AIProviderInstanceSettings['googleAuthOptions']>,
            },
          },
        },
        aliases: { smart: 'vertex/gemini-2.5-flash' },
      }, {});

      expect(config).not.toBe(false);
      if (config === false) return;
      expect(config.providers.vertex.apiKey).toBeUndefined();
      expect(config.providers.vertex.capabilities.transcription).toBe(true);

      const result = await new AIService(config).generateText({ prompt: 'Confirm the auth mode.' });
      expect(result.text).toBe('ADC stayed authoritative.');

      const request = capturedRequest as unknown as Request;
      expect(request.url).toStartWith(
        'https://us-central1-aiplatform.googleapis.com/v1beta1/projects/zero-adc-project/',
      );
      expect(request.headers.get('authorization')).toBe('Bearer zero-adc-access-token');
      expect(request.headers.get('x-goog-api-key')).toBeNull();
    });
  });
});

async function withEnvironment(
  key: string,
  value: string,
  run: () => Promise<void>,
): Promise<void> {
  const previous = Bun.env[key];
  Bun.env[key] = value;
  try {
    await run();
  } finally {
    if (previous === undefined) delete Bun.env[key];
    else Bun.env[key] = previous;
  }
}
