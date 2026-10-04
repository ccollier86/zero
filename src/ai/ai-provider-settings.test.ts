import { describe, expect, test } from 'bun:test';

import { AIError } from './ai-errors';
import { resolveAIConfig } from './ai-env';
import type { AIProviderConfig, AIProviderInstanceSettings } from './ai-types';

describe('AI provider setting values', () => {
  test('normalizes and validates AI Gateway team scoping', () => {
    const config = resolveProvider({
      type: 'gateway',
      apiKey: 'gateway-key',
      settings: { teamIdOrSlug: '  team_zero  ' },
    });

    expect(config.settings?.teamIdOrSlug).toBe('team_zero');
    expectInvalidSetting({
      type: 'openai',
      apiKey: 'openai-key',
      settings: { teamIdOrSlug: 'team_zero' },
    }, 'teamIdOrSlug', 'does not support');
  });

  test('trims endpoint settings without mutating app config', () => {
    const settings = {
      modelURL: '  https://model.baseten.example.test/sync/v1/  ',
    };
    const config = resolveProvider({
      type: 'baseten',
      apiKey: 'test-key',
      settings,
    });

    expect(config.settings?.modelURL).toBe('https://model.baseten.example.test/sync/v1');
    expect(config.capabilities.embeddings).toBe(true);
    expect(settings.modelURL).toBe('  https://model.baseten.example.test/sync/v1/  ');
  });

  test('treats a whitespace-only Baseten model URL as omitted', () => {
    const config = resolveProvider({
      type: 'baseten',
      apiKey: 'test-key',
      settings: { modelURL: '   \t  ' },
    });

    expect(config.active).toBe(true);
    expect(config.settings).toBeUndefined();
    expect(config.capabilities.embeddings).toBe(false);
  });

  test('rejects malformed nested provider endpoints as stable config errors', () => {
    const cases: Array<{ provider: AIProviderConfig; setting: string }> = [
      {
        provider: {
          type: 'amazon-bedrock',
          settings: {
            region: 'us-east-1',
            accessKeyId: 'test-access-key',
            secretAccessKey: 'test-secret-key',
            runtimeBaseURL: '/runtime',
          },
        },
        setting: 'runtimeBaseURL',
      },
      {
        provider: {
          type: 'amazon-bedrock',
          settings: {
            region: 'us-east-1',
            accessKeyId: 'test-access-key',
            secretAccessKey: 'test-secret-key',
            agentRuntimeBaseURL: 'file:///tmp/agent-runtime',
          },
        },
        setting: 'agentRuntimeBaseURL',
      },
      {
        provider: {
          type: 'azure',
          apiKey: 'test-key',
          settings: { resourceName: 'zero-resource', speechBaseURL: '/speech' },
        },
        setting: 'speechBaseURL',
      },
      {
        provider: {
          type: 'baseten',
          apiKey: 'test-key',
          settings: { modelURL: 'file:///tmp/model' },
        },
        setting: 'modelURL',
      },
      {
        provider: {
          type: 'alibaba',
          apiKey: 'test-key',
          settings: { embeddingBaseURL: 'ftp://embedding.example.test' },
        },
        setting: 'embeddingBaseURL',
      },
      {
        provider: {
          type: 'alibaba',
          apiKey: 'test-key',
          settings: { videoBaseURL: 'not-a-url' },
        },
        setting: 'videoBaseURL',
      },
      {
        provider: {
          type: 'minimax',
          apiKey: 'test-key',
          settings: { videoBaseURL: 'data:text/plain,invalid' },
        },
        setting: 'videoBaseURL',
      },
    ];

    for (const testCase of cases) {
      expectInvalidSetting(testCase.provider, testCase.setting, 'absolute HTTP(S) URL');
    }
  });

  test('accepts only usable Baseten embedding endpoints', () => {
    for (const modelURL of [
      'https://model.baseten.example.test/predict',
      'https://model.baseten.example.test/v1',
      'https://model.baseten.example.test/sync?token=unsafe',
      'https://model.baseten.example.test/sync#fragment',
    ]) {
      expectInvalidSetting({
        type: 'baseten',
        apiKey: 'test-key',
        settings: { modelURL },
      }, 'modelURL', 'Baseten /sync or /sync/v1 endpoint');
    }
  });

  test('requires finite positive integer refresh and polling intervals', () => {
    for (const invalid of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expectInvalidSetting({
        type: 'gateway',
        apiKey: 'test-key',
        settings: { metadataCacheRefreshMillis: invalid },
      }, 'metadataCacheRefreshMillis', 'finite positive integer');

      expectInvalidSetting({
        type: 'black-forest-labs',
        apiKey: 'test-key',
        settings: { pollIntervalMillis: invalid },
      }, 'pollIntervalMillis', 'finite positive integer');

      expectInvalidSetting({
        type: 'black-forest-labs',
        apiKey: 'test-key',
        settings: { pollTimeoutMillis: invalid },
      }, 'pollTimeoutMillis', 'finite positive integer');
    }
  });

  test('validates boolean provider switches at runtime', () => {
    const cases: Array<{ provider: AIProviderConfig; setting: string }> = [
      {
        provider: {
          type: 'azure',
          apiKey: 'test-key',
          settings: invalidSettings({
            resourceName: 'zero-resource',
            useDeploymentBasedUrls: 'true',
          }),
        },
        setting: 'useDeploymentBasedUrls',
      },
      {
        provider: {
          type: 'open-responses',
          baseURL: 'https://responses.example.test/v1',
          settings: invalidSettings({ strictResponseInput: 1 }),
        },
        setting: 'strictResponseInput',
      },
      {
        provider: {
          type: 'alibaba',
          apiKey: 'test-key',
          settings: invalidSettings({ includeUsage: 'yes' }),
        },
        setting: 'includeUsage',
      },
    ];

    for (const testCase of cases) {
      expectInvalidSetting(testCase.provider, testCase.setting, 'boolean');
    }
  });

  test('validates callback and constructor settings at runtime', () => {
    const cases: Array<{ provider: AIProviderConfig; setting: string }> = [
      {
        provider: {
          type: 'google',
          apiKey: 'test-key',
          settings: invalidSettings({ generateId: 'not-a-function' }),
        },
        setting: 'generateId',
      },
      {
        provider: {
          type: 'azure',
          settings: invalidSettings({
            resourceName: 'zero-resource',
            tokenProvider: {},
          }),
        },
        setting: 'tokenProvider',
      },
      {
        provider: {
          type: 'amazon-bedrock',
          settings: invalidSettings({
            region: 'us-east-1',
            credentialProvider: Promise.resolve({}),
          }),
        },
        setting: 'credentialProvider',
      },
      {
        provider: {
          type: 'baseten',
          apiKey: 'test-key',
          settings: invalidSettings({
            modelURL: 'https://model.baseten.example.test/sync/v1',
            performanceClient: {},
          }),
        },
        setting: 'performanceClient',
      },
    ];

    for (const testCase of cases) {
      expectInvalidSetting(testCase.provider, testCase.setting, 'function');
    }
  });

  test('validates Bedrock regions and accepts ID generation supported by SDK 7', () => {
    expect(() => resolveProvider({
      type: 'amazon-bedrock',
      settings: {
        region: 'us-east-1',
        accessKeyId: 'test-access-key',
        secretAccessKey: 'test-secret-key',
        generateId: () => 'zero-bedrock-id',
      },
    })).not.toThrow();

    for (const region of ['bad.region', '-us-east-1', 'us-east-1-']) {
      expectInvalidSetting({
        type: 'amazon-bedrock',
        settings: {
          region,
          accessKeyId: 'test-access-key',
          secretAccessKey: 'test-secret-key',
        },
      }, 'region', 'single DNS label');
    }
  });

  test('requires a usable Baseten performance-client constructor and model URL', () => {
    expectInvalidSetting({
      type: 'baseten',
      apiKey: 'test-key',
      settings: invalidSettings({
        modelURL: 'https://model.baseten.example.test/sync/v1',
        performanceClient: () => ({}),
      }),
    }, 'performanceClient', 'constructable function');

    class PerformanceClient {
      constructor(_modelURL: string, _apiKey?: string) {}
      async embed(_input: string[], _model: string) {
        return { data: [] };
      }
    }
    expectInvalidSetting({
      type: 'baseten',
      apiKey: 'test-key',
      settings: { performanceClient: PerformanceClient },
    }, 'performanceClient', 'requires settings.modelURL');

    const config = resolveProvider({
      type: 'baseten',
      apiKey: 'test-key',
      settings: {
        modelURL: 'https://model.baseten.example.test/sync/v1',
        performanceClient: PerformanceClient,
      },
    });
    expect(config.settings?.performanceClient).toBe(PerformanceClient);
  });

  test('preserves flexible Google auth option objects and rejects non-objects', () => {
    const authClient = { getAccessToken: async () => 'token' };
    const googleAuthOptions = {
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
      authClient,
      customTransporter: { request: async () => ({}) },
    };
    const config = resolveProvider({
      type: 'google-vertex',
      settings: {
        project: 'zero-project',
        location: 'us-central1',
        googleAuthOptions: googleAuthOptions as never,
      },
    });

    expect(config.active).toBe(true);
    expect(config.settings?.googleAuthOptions as unknown).toBe(googleAuthOptions);

    for (const invalid of [null, [], 'credentials']) {
      expectInvalidSetting({
        type: 'google-vertex',
        settings: invalidSettings({
          project: 'zero-project',
          location: 'us-central1',
          googleAuthOptions: invalid,
        }),
      }, 'googleAuthOptions', 'non-array object');
    }
  });

  test('trims cloud identifiers and validates Azure resource DNS labels', () => {
    const settings = {
      resourceName: '  zero-resource  ',
      apiVersion: '  2025-04-01-preview  ',
    };
    const config = resolveProvider({
      type: 'azure',
      apiKey: 'test-key',
      settings,
    });

    expect(config.settings).toMatchObject({
      resourceName: 'zero-resource',
      apiVersion: '2025-04-01-preview',
    });
    expect(settings.resourceName).toBe('  zero-resource  ');

    for (const resourceName of ['-leading', 'trailing-', 'contains.dot', 'contains space']) {
      expectInvalidSetting({
        type: 'azure',
        apiKey: 'test-key',
        settings: { resourceName },
      }, 'resourceName', 'single DNS label');
    }
  });
});

function resolveProvider(provider: AIProviderConfig) {
  const config = resolveAIConfig({
    autoDetect: false,
    providers: { tested: provider },
  }, {});
  if (config === false) throw new Error('Expected AI configuration to be enabled.');
  return config.providers.tested;
}

function expectInvalidSetting(
  provider: AIProviderConfig,
  setting: string,
  message: string
): void {
  try {
    resolveProvider(provider);
    throw new Error(`Expected settings.${setting} to be rejected.`);
  } catch (error) {
    expect(error).toBeInstanceOf(AIError);
    expect(error).toMatchObject({
      code: 'AI_PROVIDER_CONFIG_INVALID',
      status: 500,
    });
    expect((error as Error).message).toContain(`settings.${setting}`);
    expect((error as Error).message).toContain(message);
  }
}

function invalidSettings(values: Record<string, unknown>): AIProviderInstanceSettings {
  return values as AIProviderInstanceSettings;
}
