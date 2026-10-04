import { describe, expect, test } from 'bun:test';

import { OBS_CODES, MemoryEventStore, configureObservability } from '../observability';
import { resolveAIConfig } from './ai-env';
import { AIService } from './ai-service';
import { aiTool, defineAITools } from './ai-toolkit';
import type { AIProviderConfig } from './ai-types';

describe('resolveAIConfig', () => {
  test('auto-detects providers from env keys and chooses active aliases', () => {
    const config = resolveAIConfig(true, {
      OPENAI_API_KEY: 'openai-key',
      GROQ_API_KEY: 'groq-key',
    });

    expect(config).not.toBe(false);
    if (config === false) return;

    expect(config.providers.openai.active).toBe(true);
    expect(config.providers.openai.configuredBy).toEqual(['OPENAI_API_KEY']);
    expect(config.providers.groq.active).toBe(true);
    expect(config.providers.groq.type).toBe('groq');
    expect(config.providers.groq.configuredBy).toEqual(['GROQ_API_KEY']);
    expect(config.providers.anthropic.active).toBe(false);
    expect(config.aliases.fast).toBe('groq/llama-3.3-70b-versatile');
    expect(config.aliases.smart).toBe('openai/gpt-4o');
    expect(config.aliases.embedding).toBe('openai/text-embedding-3-small');
    expect(config.aliases.speech).toBe('openai/gpt-4o-mini-tts');
  });

  test('uses Deepgram as the default speech alias when Deepgram is active', () => {
    const config = resolveAIConfig(true, {
      DEEPGRAM_API_KEY: 'deepgram-key',
    });

    expect(config).not.toBe(false);
    if (config === false) return;

    expect(config.providers.deepgram.active).toBe(true);
    expect(config.providers.deepgram.capabilities.speech).toBe(true);
    expect(config.aliases.speech).toBe('deepgram/aura-2-helena-en');
  });

  test('keeps Gateway vendor-qualified model ids intact in every default alias', () => {
    const config = resolveAIConfig(true, {
      AI_GATEWAY_API_KEY: 'gateway-key',
    });

    expect(config).not.toBe(false);
    if (config === false) return;

    expect(config.providers.gateway.active).toBe(true);
    expect(config.aliases).toMatchObject({
      fast: 'gateway/openai/gpt-4o-mini',
      smart: 'gateway/anthropic/claude-opus-4.5',
      embedding: 'gateway/openai/text-embedding-3-small',
      image: 'gateway/openai/gpt-image-1',
      transcription: 'gateway/openai/gpt-4o-mini-transcribe',
      speech: 'gateway/openai/tts-1',
      reranking: 'gateway/cohere/rerank-v3.5',
      video: 'gateway/google/veo-3.1-fast-generate-001',
    });
  });

  test('resolves the hosted-files provider from config before environment', () => {
    const explicit = resolveAIConfig({
      autoDetect: false,
      filesProvider: 'openai',
      providers: {
        openai: { type: 'openai', apiKey: 'openai-key' },
        google: { type: 'google', apiKey: 'google-key' },
      },
    }, { ZERO_AI_FILES_PROVIDER: 'google' });
    const fromEnvironment = resolveAIConfig({
      autoDetect: false,
      providers: { google: { type: 'google', apiKey: 'google-key' } },
    }, { ZERO_AI_FILES_PROVIDER: 'google' });

    expect(explicit).not.toBe(false);
    expect(fromEnvironment).not.toBe(false);
    if (explicit === false || fromEnvironment === false) return;
    expect(explicit.filesProvider).toBe('openai');
    expect(fromEnvironment.filesProvider).toBe('google');
  });

  test('rejects a blank or malformed hosted-files provider id', () => {
    expect(() => resolveAIConfig({ filesProvider: '   ' }, {})).toThrow(
      'AI filesProvider must identify a configured provider.'
    );
    expect(() => resolveAIConfig(true, { ZERO_AI_FILES_PROVIDER: 'invalid/provider' })).toThrow(
      'must start with a letter or number'
    );
  });

  test('explicit provider config wins over env auto-detection', () => {
    const config = resolveAIConfig({
      providers: {
        togetherai: {
          type: 'togetherai',
          apiKey: 'explicit-key',
          baseURL: 'https://together.test/v1',
        },
      },
      aliases: {
        smart: 'togetherai/custom-model',
      },
    }, {
      TOGETHER_API_KEY: 'env-key',
    });

    expect(config).not.toBe(false);
    if (config === false) return;

    expect(config.providers.togetherai.source).toBe('config');
    expect(config.providers.togetherai.apiKey).toBe('explicit-key');
    expect(config.providers.togetherai.baseURL).toBe('https://together.test/v1');
    expect(config.aliases.smart).toBe('togetherai/custom-model');
  });

  test('explicit catalog providers inherit env secrets when omitted', () => {
    const config = resolveAIConfig({
      providers: {
        openai: {
          type: 'openai',
        },
      },
    }, {
      OPENAI_API_KEY: 'env-openai-key',
      OPENAI_BASE_URL: 'https://openai-proxy.test/v1',
    });

    expect(config).not.toBe(false);
    if (config === false) return;

    expect(config.providers.openai.source).toBe('config');
    expect(config.providers.openai.active).toBe(true);
    expect(config.providers.openai.apiKey).toBe('env-openai-key');
    expect(config.providers.openai.baseURL).toBe('https://openai-proxy.test/v1');
    expect(config.providers.openai.configuredBy).toEqual(['OPENAI_API_KEY', 'OPENAI_BASE_URL']);
  });

  test('normalizes blank explicit values before environment inheritance', () => {
    const config = resolveAIConfig({
      autoDetect: false,
      providers: {
        openai: {
          type: 'openai',
          apiKey: '   ',
          baseURL: '\t ',
        },
        anthropic: {
          type: 'anthropic',
          apiKey: null,
          settings: { authToken: '   ' },
        },
      },
    }, {
      OPENAI_API_KEY: 'env-openai-key',
      OPENAI_BASE_URL: 'https://openai-proxy.test/v1',
      ANTHROPIC_AUTH_TOKEN: 'env-anthropic-bearer',
    });

    expect(config).not.toBe(false);
    if (config === false) return;
    expect(config.providers.openai).toMatchObject({
      active: true,
      apiKey: 'env-openai-key',
      baseURL: 'https://openai-proxy.test/v1',
      configuredBy: ['OPENAI_API_KEY', 'OPENAI_BASE_URL'],
    });
    expect(config.providers.anthropic).toMatchObject({
      active: true,
      apiKey: undefined,
      settings: { authToken: 'env-anthropic-bearer' },
      configuredBy: ['ANTHROPIC_AUTH_TOKEN'],
    });
  });

  test('uses null as the explicit Gateway OIDC signal while omission inherits env', () => {
    const inherited = resolveAIConfig({
      autoDetect: false,
      providers: { gateway: { type: 'gateway' } },
    }, { AI_GATEWAY_API_KEY: 'ambient-gateway-key' });
    const oidc = resolveAIConfig({
      autoDetect: false,
      providers: { gateway: { type: 'gateway', apiKey: null } },
    }, { AI_GATEWAY_API_KEY: 'ambient-gateway-key' });

    expect(inherited).not.toBe(false);
    expect(oidc).not.toBe(false);
    if (inherited === false || oidc === false) return;
    expect(inherited.providers.gateway).toMatchObject({
      active: true,
      apiKey: 'ambient-gateway-key',
      configuredBy: ['AI_GATEWAY_API_KEY'],
    });
    expect(oidc.providers.gateway).toMatchObject({
      active: true,
      apiKey: undefined,
      configuredBy: [],
    });
  });

  test('keeps explicit alternate cloud credentials authoritative over ambient API keys', () => {
    const tokenProvider = async () => 'entra-token';
    const credentialProvider = async () => ({
      accessKeyId: 'bedrock-access',
      secretAccessKey: 'bedrock-secret',
    });
    const config = resolveAIConfig({
      autoDetect: false,
      providers: {
        anthropic: {
          type: 'anthropic',
          settings: { authToken: 'anthropic-bearer' },
        },
        bedrock: {
          type: 'amazon-bedrock',
          settings: { region: 'us-east-1', credentialProvider },
        },
        azure: {
          type: 'azure',
          settings: { resourceName: 'zero-resource', tokenProvider },
        },
        vertex: {
          type: 'google-vertex',
          settings: { project: 'zero-project', location: 'us-central1' },
        },
      },
    }, {
      ANTHROPIC_API_KEY: 'ambient-anthropic-key',
      AWS_BEARER_TOKEN_BEDROCK: 'ambient-bedrock-bearer',
      AZURE_API_KEY: 'ambient-azure-key',
      GOOGLE_VERTEX_API_KEY: 'ambient-vertex-key',
    });

    expect(config).not.toBe(false);
    if (config === false) return;
    for (const providerId of ['anthropic', 'bedrock', 'azure', 'vertex']) {
      expect(config.providers[providerId]?.apiKey, providerId).toBeUndefined();
    }
    expect(config.providers.anthropic.settings?.authToken).toBe('anthropic-bearer');
    expect(config.providers.bedrock.settings?.credentialProvider).toBe(credentialProvider);
    expect(config.providers.azure.settings?.tokenProvider).toBe(tokenProvider);
    expect(config.providers.vertex.settings).toMatchObject({
      project: 'zero-project',
      location: 'us-central1',
    });
  });

  test('rejects conflicting explicit credential modes during config resolution', () => {
    const conflictingProviders: Array<Record<string, AIProviderConfig>> = [
      {
        anthropic: {
          type: 'anthropic' as const,
          apiKey: 'api-key',
          settings: { authToken: 'bearer-token' },
        },
      },
      {
        bedrock: {
          type: 'amazon-bedrock' as const,
          apiKey: 'bearer-token',
          settings: {
            region: 'us-east-1',
            accessKeyId: 'access-key',
            secretAccessKey: 'secret-key',
          },
        },
      },
      {
        azure: {
          type: 'azure' as const,
          apiKey: 'api-key',
          settings: { resourceName: 'zero-resource', tokenProvider: async () => 'token' },
        },
      },
      {
        vertex: {
          type: 'google-vertex' as const,
          apiKey: 'express-key',
          settings: { project: 'zero-project', location: 'us-central1' },
        },
      },
    ];

    for (const providers of conflictingProviders) {
      try {
        resolveAIConfig({ autoDetect: false, providers }, {});
        throw new Error('Expected conflicting AI credentials to fail.');
      } catch (error) {
        expect(error).toMatchObject({ code: 'AI_PROVIDER_CONFIG_INVALID' });
      }
    }
  });

  test('prefers API-key auth when both Anthropic environment credentials exist', () => {
    const config = resolveAIConfig(true, {
      ANTHROPIC_API_KEY: 'anthropic-api-key',
      ANTHROPIC_AUTH_TOKEN: 'anthropic-bearer-token',
    });

    expect(config).not.toBe(false);
    if (config === false) return;
    expect(config.providers.anthropic).toMatchObject({
      active: true,
      apiKey: 'anthropic-api-key',
      configuredBy: ['ANTHROPIC_API_KEY'],
      settings: undefined,
    });
  });

  test('uses provider-id environment keys before adapter-wide keys', () => {
    const config = resolveAIConfig({
      autoDetect: false,
      providers: {
        openai: { type: 'openai' },
        secondary: { type: 'openai' },
      },
    }, {
      OPENAI_API_KEY: 'primary-key',
      SECONDARY_API_KEY: 'secondary-key',
    });

    expect(config).not.toBe(false);
    if (config === false) return;
    expect(config.providers.openai.apiKey).toBe('primary-key');
    expect(config.providers.secondary.apiKey).toBe('secondary-key');
    expect(config.providers.secondary.configuredBy).toEqual(['SECONDARY_API_KEY']);
  });

  test('rejects provider ids that cannot form an unambiguous model reference', () => {
    for (const id of ['', ' spaced ', 'nested/provider', 'provider?mode=bad', 'provider\\bad']) {
      expect(() => resolveAIConfig({
        autoDetect: false,
        providers: { [id]: { type: 'openai', apiKey: 'key' } },
      }, {})).toThrow('must start with a letter or number');
    }
  });

  test('rejects malformed or non-HTTP provider base URLs', () => {
    for (const baseURL of [
      'not-a-url',
      'file:///tmp/provider',
    ]) {
      expect(() => resolveAIConfig({
        autoDetect: false,
        providers: { local: { type: 'openai-compatible', baseURL } },
      }, {})).toThrow('must be an absolute HTTP(S) URL');
    }

    expect(() => resolveAIConfig({ providers: {} }, {
      OPENAI_API_KEY: 'key',
      OPENAI_BASE_URL: 'ftp://provider.example.test/v1',
    })).toThrow('must be an absolute HTTP(S) URL');

    expect(() => resolveAIConfig(true, {
      AWS_BEARER_TOKEN_BEDROCK: 'bedrock-key',
      AWS_REGION: 'us-east-1',
      AWS_ENDPOINT_URL_BEDROCK_RUNTIME: 'https://runtime.bedrock.example.test',
      AWS_ENDPOINT_URL: 'ftp://agent-fallback.example.test',
    })).toThrow('must be an absolute HTTP(S) URL');
  });

  test('rejects provider-specific settings that the selected adapter cannot use', () => {
    expect(() => resolveAIConfig({
      autoDetect: false,
      providers: {
        openai: {
          type: 'openai',
          apiKey: 'key',
          settings: { region: 'us-east-1' },
        },
      },
    }, {})).toThrow('does not support settings.region');

    expect(() => resolveAIConfig({
      autoDetect: false,
      providers: {
        bedrock: {
          type: 'amazon-bedrock',
          settings: {
            region: 'us-east-1',
            accessKeyId: 'access',
            secretAccessKey: 'secret',
          },
        },
      },
    }, {})).not.toThrow();
  });

  test('prevents built-in and compatible adapters from advertising unsupported modalities', () => {
    expect(() => resolveAIConfig({
      autoDetect: false,
      providers: {
        anthropic: {
          type: 'anthropic',
          apiKey: 'key',
          capabilities: { images: true },
        },
      },
    }, {})).toThrow('cannot enable unsupported capability "images"');

    for (const capability of ['speech', 'transcription'] as const) {
      expect(() => resolveAIConfig({
        autoDetect: false,
        providers: {
          compatible: {
            type: 'openai-compatible',
            baseURL: 'https://compatible.example.test/v1',
            capabilities: { [capability]: true },
          },
        },
      }, {})).toThrow(`cannot enable unsupported capability "${capability}"`);
    }

    expect(() => resolveAIConfig({
      autoDetect: false,
      providers: {
        custom: {
          type: 'custom',
          adapter: {
            specificationVersion: 'v4',
            languageModel() { throw new Error('not used'); },
            embeddingModel() { throw new Error('not used'); },
            imageModel() { throw new Error('not used'); },
          },
          capabilities: { files: false, fileDelete: true },
        },
      },
    }, {})).toThrow('cannot enable "fileDelete" without hosted file uploads');

    const compatible = resolveAIConfig({
      autoDetect: false,
      providers: {
        deepseek: { type: 'openai-compatible', apiKey: 'deepseek-key' },
        voyage: { type: 'openai-compatible', apiKey: 'voyage-key' },
      },
    }, {});
    const native = resolveAIConfig({
      autoDetect: false,
      providers: {
        deepseek: { type: 'deepseek', apiKey: 'deepseek-key' },
        voyage: { type: 'voyage', apiKey: 'voyage-key' },
      },
    }, {});

    expect(compatible).not.toBe(false);
    expect(native).not.toBe(false);
    if (compatible === false || native === false) return;
    expect(compatible.providers.deepseek.capabilities.files).toBe(false);
    expect(compatible.providers.voyage.capabilities.reranking).toBe(false);
    expect(native.providers.deepseek.capabilities.files).toBe(true);
    expect(native.providers.voyage.capabilities.reranking).toBe(true);
  });

  test('activates Anthropic from its bearer-token environment binding', () => {
    const config = resolveAIConfig(true, {
      ANTHROPIC_AUTH_TOKEN: 'anthropic-bearer-token',
    });

    expect(config).not.toBe(false);
    if (config === false) return;

    expect(config.providers.anthropic).toMatchObject({
      active: true,
      apiKey: undefined,
      configuredBy: ['ANTHROPIC_AUTH_TOKEN'],
      settings: { authToken: 'anthropic-bearer-token' },
      reason: null,
    });
  });

  test('only creates default aliases for capabilities the active provider exposes', () => {
    const config = resolveAIConfig({
      autoDetect: false,
      providers: {
        gateway: {
          type: 'gateway',
          apiKey: 'gateway-key',
          capabilities: {
            embeddings: false,
            images: false,
            transcription: false,
            speech: false,
            reranking: false,
            video: false,
          },
        },
      },
    }, {});

    expect(config).not.toBe(false);
    if (config === false) return;
    expect(config.aliases.fast).toBe('gateway/openai/gpt-4o-mini');
    expect(config.aliases.smart).toBe('gateway/anthropic/claude-opus-4.5');
    expect(config.aliases.embedding).toBeUndefined();
    expect(config.aliases.image).toBeUndefined();
    expect(config.aliases.transcription).toBeUndefined();
    expect(config.aliases.speech).toBeUndefined();
    expect(config.aliases.reranking).toBeUndefined();
    expect(config.aliases.video).toBeUndefined();
  });

  test('custom providers require an AI SDK adapter before they become active', () => {
    const adapter = {
      specificationVersion: 'v3',
      languageModel() {
        throw new Error('not used');
      },
      embeddingModel() {
        throw new Error('not used');
      },
      imageModel() {
        throw new Error('not used');
      },
    } as any;
    const config = resolveAIConfig({
      autoDetect: false,
      providers: {
        missing: {
          type: 'custom',
          apiKey: 'does-not-matter',
        },
        ready: {
          type: 'custom',
          adapter,
        },
      },
    }, {});

    expect(config).not.toBe(false);
    if (config === false) return;

    expect(config.providers.missing.active).toBe(false);
    expect(config.providers.missing.reason).toBe('missing_custom_provider_adapter');
    expect(config.providers.ready.active).toBe(true);
    expect(config.providers.ready.reason).toBeNull();
  });

  test('requires explicit base URLs for custom openai-compatible providers', () => {
    const config = resolveAIConfig({
      autoDetect: false,
      providers: {
        local: {
          type: 'openai-compatible',
          apiKey: 'local-key',
        },
        deepseek: {
          type: 'openai-compatible',
          apiKey: 'deepseek-key',
        },
      },
    }, {});

    expect(config).not.toBe(false);
    if (config === false) return;

    expect(config.providers.local.active).toBe(false);
    expect(config.providers.local.baseURL).toBeUndefined();
    expect(config.providers.local.reason).toBe('missing_base_url');
    expect(config.providers.deepseek.active).toBe(true);
    expect(config.providers.deepseek.type).toBe('openai-compatible');
    expect(config.providers.deepseek.baseURL).toBe('https://api.deepseek.com');
    expect(config.providers.deepseek.capabilities.text).toBe(true);
  });

  test('activates Bedrock with bearer, static, or dynamic credentials', () => {
    const bearer = resolveAIConfig(true, {
      AWS_BEARER_TOKEN_BEDROCK: 'bedrock-bearer-token',
      AWS_REGION: 'us-east-1',
    });
    const staticCredentials = resolveAIConfig(true, {
      AWS_DEFAULT_REGION: 'us-west-2',
      AWS_ACCESS_KEY_ID: 'test-access-key',
      AWS_SECRET_ACCESS_KEY: 'test-secret-key',
      AWS_SESSION_TOKEN: 'test-session-token',
    });
    const credentialProvider = async () => ({
      accessKeyId: 'dynamic-access-key',
      secretAccessKey: 'dynamic-secret-key',
    });
    const dynamicCredentials = resolveAIConfig({
      autoDetect: false,
      providers: {
        bedrock: {
          type: 'amazon-bedrock',
          settings: {
            region: 'us-east-2',
            credentialProvider,
          },
        },
      },
    }, {});

    expect(bearer).not.toBe(false);
    expect(staticCredentials).not.toBe(false);
    expect(dynamicCredentials).not.toBe(false);
    if (bearer === false || staticCredentials === false || dynamicCredentials === false) return;

    expect(bearer.providers.bedrock).toMatchObject({
      active: true,
      apiKey: 'bedrock-bearer-token',
      reason: null,
      configuredBy: ['AWS_BEARER_TOKEN_BEDROCK', 'AWS_REGION'],
      settings: { region: 'us-east-1' },
    });
    expect(staticCredentials.providers.bedrock).toMatchObject({
      active: true,
      reason: null,
      configuredBy: [
        'AWS_DEFAULT_REGION',
        'AWS_ACCESS_KEY_ID',
        'AWS_SECRET_ACCESS_KEY',
        'AWS_SESSION_TOKEN',
      ],
      settings: {
        region: 'us-west-2',
        accessKeyId: 'test-access-key',
        secretAccessKey: 'test-secret-key',
        sessionToken: 'test-session-token',
      },
    });
    expect(dynamicCredentials.providers.bedrock).toMatchObject({
      active: true,
      reason: null,
      settings: {
        region: 'us-east-2',
        credentialProvider,
      },
    });
  });

  test('accepts the official AWS endpoint override for Bedrock bearer auth', () => {
    const config = resolveAIConfig(true, {
      AWS_BEARER_TOKEN_BEDROCK: 'bedrock-bearer-token',
      AWS_ENDPOINT_URL: 'https://bedrock-runtime.example.test',
    });

    expect(config).not.toBe(false);
    if (config === false) return;
    expect(config.providers.bedrock).toMatchObject({
      active: true,
      apiKey: 'bedrock-bearer-token',
      baseURL: 'https://bedrock-runtime.example.test',
      configuredBy: ['AWS_BEARER_TOKEN_BEDROCK', 'AWS_ENDPOINT_URL'],
      reason: null,
    });
  });

  test('prefers the Bedrock Runtime endpoint override over the generic AWS endpoint', () => {
    const config = resolveAIConfig(true, {
      AWS_BEARER_TOKEN_BEDROCK: 'bedrock-bearer-token',
      AWS_ENDPOINT_URL_BEDROCK_RUNTIME: 'https://bedrock-runtime.example.test',
      AWS_ENDPOINT_URL: 'https://generic-aws.example.test',
    });

    expect(config).not.toBe(false);
    if (config === false) return;
    expect(config.providers.bedrock).toMatchObject({
      active: true,
      apiKey: 'bedrock-bearer-token',
      baseURL: 'https://bedrock-runtime.example.test',
      reason: null,
    });
    expect(config.providers.bedrock.configuredBy).toContain(
      'AWS_ENDPOINT_URL_BEDROCK_RUNTIME'
    );
    expect(config.providers.bedrock.settings).toMatchObject({
      runtimeBaseURL: 'https://bedrock-runtime.example.test',
      agentRuntimeBaseURL: 'https://generic-aws.example.test',
    });
  });

  test('resolves independent Bedrock Runtime and Agent Runtime endpoints', () => {
    const config = resolveAIConfig(true, {
      AWS_BEARER_TOKEN_BEDROCK: 'bedrock-bearer-token',
      AWS_REGION: 'us-east-1',
      AWS_ENDPOINT_URL_BEDROCK_RUNTIME: 'https://runtime.bedrock.example.test',
      AWS_ENDPOINT_URL_BEDROCK_AGENT_RUNTIME: 'https://agent.bedrock.example.test',
      AWS_ENDPOINT_URL: 'https://generic-aws.example.test',
    });

    expect(config).not.toBe(false);
    if (config === false) return;
    expect(config.providers.bedrock).toMatchObject({
      active: true,
      baseURL: 'https://runtime.bedrock.example.test',
      capabilities: { reranking: true },
      settings: {
        region: 'us-east-1',
        runtimeBaseURL: 'https://runtime.bedrock.example.test',
        agentRuntimeBaseURL: 'https://agent.bedrock.example.test',
      },
    });
    expect(config.providers.bedrock.configuredBy).toEqual(expect.arrayContaining([
      'AWS_BEARER_TOKEN_BEDROCK',
      'AWS_ENDPOINT_URL_BEDROCK_RUNTIME',
      'AWS_ENDPOINT_URL_BEDROCK_AGENT_RUNTIME',
      'AWS_REGION',
    ]));
  });

  test('does not advertise Bedrock reranking without the required AWS region', () => {
    const config = resolveAIConfig(true, {
      AWS_BEARER_TOKEN_BEDROCK: 'bedrock-bearer-token',
      AWS_ENDPOINT_URL_BEDROCK_RUNTIME: 'https://runtime.bedrock.example.test',
    });

    expect(config).not.toBe(false);
    if (config === false) return;
    expect(config.providers.bedrock).toMatchObject({
      active: true,
      capabilities: { reranking: false },
      settings: { runtimeBaseURL: 'https://runtime.bedrock.example.test' },
    });
  });

  test('preserves explicit endpoint suppression for OpenAI and Bedrock', () => {
    const config = resolveAIConfig({
      autoDetect: false,
      providers: {
        openai: {
          type: 'openai',
          apiKey: 'openai-key',
          baseURL: null,
        },
        bedrock: {
          type: 'amazon-bedrock',
          apiKey: null,
          baseURL: null,
          settings: {
            region: 'us-east-1',
            accessKeyId: 'test-access-key',
            secretAccessKey: 'test-secret-key',
          },
        },
      },
    }, {
      OPENAI_BASE_URL: 'https://ambient-openai.example.test/v1',
      AWS_ENDPOINT_URL_BEDROCK_RUNTIME: 'https://ambient-bedrock.example.test',
      AWS_ENDPOINT_URL: 'https://ambient-aws.example.test',
    });

    expect(config).not.toBe(false);
    if (config === false) return;
    expect(config.providers.openai).toMatchObject({
      active: true,
      baseURL: undefined,
      baseURLSuppressed: true,
      configuredBy: [],
    });
    expect(config.providers.bedrock).toMatchObject({
      active: true,
      baseURL: undefined,
      baseURLSuppressed: true,
      configuredBy: [],
    });
  });

  test('reports precise Bedrock readiness failures for missing and partial settings', () => {
    const cases = [
      {
        name: 'missing region',
        provider: { type: 'amazon-bedrock' as const, apiKey: 'bearer-token' },
        reason: 'missing_region',
      },
      {
        name: 'missing credentials',
        provider: { type: 'amazon-bedrock' as const, settings: { region: 'us-east-1' } },
        reason: 'missing_credentials',
      },
      {
        name: 'access key without secret',
        provider: {
          type: 'amazon-bedrock' as const,
          settings: { region: 'us-east-1', accessKeyId: 'test-access-key' },
        },
        reason: 'partial_aws_credentials',
      },
      {
        name: 'secret without access key',
        provider: {
          type: 'amazon-bedrock' as const,
          settings: { region: 'us-east-1', secretAccessKey: 'test-secret-key' },
        },
        reason: 'partial_aws_credentials',
      },
    ];

    for (const testCase of cases) {
      const config = resolveAIConfig({
        autoDetect: false,
        providers: { bedrock: testCase.provider },
      }, {});
      expect(config, testCase.name).not.toBe(false);
      if (config === false) continue;
      expect(config.providers.bedrock.active, testCase.name).toBe(false);
      expect(config.providers.bedrock.reason, testCase.name).toBe(testCase.reason);
    }
  });

  test('activates Azure with either API-key or dynamic Entra credentials', () => {
    const apiKey = resolveAIConfig(true, {
      AZURE_API_KEY: 'azure-key',
      AZURE_RESOURCE_NAME: 'zero-test-resource',
    });
    const tokenProvider = async () => 'entra-token';
    const entra = resolveAIConfig({
      autoDetect: false,
      providers: {
        azure: {
          type: 'azure',
          settings: {
            resourceName: 'zero-test-resource',
            tokenProvider,
          },
        },
      },
    }, {});

    expect(apiKey).not.toBe(false);
    expect(entra).not.toBe(false);
    if (apiKey === false || entra === false) return;

    expect(apiKey.providers.azure).toMatchObject({
      active: true,
      apiKey: 'azure-key',
      reason: null,
      configuredBy: ['AZURE_API_KEY', 'AZURE_RESOURCE_NAME'],
      settings: { resourceName: 'zero-test-resource' },
    });
    expect(entra.providers.azure).toMatchObject({
      active: true,
      reason: null,
      settings: { resourceName: 'zero-test-resource', tokenProvider },
    });
  });

  test('reports precise Azure readiness failures', () => {
    const missingEndpoint = resolveAIConfig({
      autoDetect: false,
      providers: { azure: { type: 'azure', apiKey: 'azure-key' } },
    }, {});
    const missingCredentials = resolveAIConfig({
      autoDetect: false,
      providers: {
        azure: { type: 'azure', settings: { resourceName: 'zero-test-resource' } },
      },
    }, {});
    const completeBaseURL = resolveAIConfig({
      autoDetect: false,
      providers: {
        azure: {
          type: 'azure',
          apiKey: 'azure-key',
          baseURL: 'https://azure-proxy.example.test/openai',
        },
      },
    }, {});

    expect(missingEndpoint).not.toBe(false);
    expect(missingCredentials).not.toBe(false);
    expect(completeBaseURL).not.toBe(false);
    if (missingEndpoint === false || missingCredentials === false || completeBaseURL === false) return;

    expect(missingEndpoint.providers.azure).toMatchObject({ active: false, reason: 'missing_azure_endpoint' });
    expect(missingCredentials.providers.azure).toMatchObject({ active: false, reason: 'missing_credentials' });
    expect(completeBaseURL.providers.azure).toMatchObject({ active: true, reason: null });
  });

  test('distinguishes Vertex express-mode and ADC capabilities', () => {
    const express = resolveAIConfig(true, {
      GOOGLE_VERTEX_API_KEY: 'vertex-express-key',
    });
    const adc = resolveAIConfig(true, {
      GOOGLE_VERTEX_PROJECT: 'zero-test-project',
      GOOGLE_VERTEX_LOCATION: 'us-central1',
    });

    expect(express).not.toBe(false);
    expect(adc).not.toBe(false);
    if (express === false || adc === false) return;

    expect(express.providers['google-vertex']).toMatchObject({
      active: true,
      reason: null,
      configuredBy: ['GOOGLE_VERTEX_API_KEY'],
      capabilities: { transcription: false },
    });
    expect(adc.providers['google-vertex']).toMatchObject({
      active: true,
      reason: null,
      configuredBy: ['GOOGLE_VERTEX_PROJECT', 'GOOGLE_VERTEX_LOCATION'],
      settings: { project: 'zero-test-project', location: 'us-central1' },
      capabilities: { transcription: true },
    });
  });

  test('activates Vertex ADC behind an explicit endpoint without overstating transcription', () => {
    const googleAuthOptions = {
      authClient: { getAccessToken: async () => ({ token: 'adc-token' }) },
    } as never;
    const config = resolveAIConfig({
      autoDetect: false,
      providers: {
        vertex: {
          type: 'google-vertex',
          baseURL: 'https://vertex-proxy.example.test/v1',
          settings: { googleAuthOptions },
        },
      },
    }, {});

    expect(config).not.toBe(false);
    if (config === false) return;
    expect(config.providers.vertex).toMatchObject({
      active: true,
      reason: null,
      capabilities: { transcription: false },
    });
    expect(config.providers.vertex.settings?.googleAuthOptions).toBe(googleAuthOptions);
  });

  test('reports precise Vertex ADC readiness failures', () => {
    const missingProject = resolveAIConfig({
      autoDetect: false,
      providers: {
        vertex: { type: 'google-vertex', settings: { location: 'us-central1' } },
      },
    }, {});
    const missingLocation = resolveAIConfig({
      autoDetect: false,
      providers: {
        vertex: { type: 'google-vertex', settings: { project: 'zero-test-project' } },
      },
    }, {});

    expect(missingProject).not.toBe(false);
    expect(missingLocation).not.toBe(false);
    if (missingProject === false || missingLocation === false) return;

    expect(missingProject.providers.vertex).toMatchObject({ active: false, reason: 'missing_project' });
    expect(missingLocation.providers.vertex).toMatchObject({ active: false, reason: 'missing_location' });
  });

  test('rejects a reserved provider id paired with an incompatible adapter type', () => {
    expect(() => resolveAIConfig({
      autoDetect: false,
      providers: {
        openai: { type: 'anthropic', apiKey: 'anthropic-key' },
      },
    }, {})).toThrow('AI provider id "openai" is reserved for adapter type "openai", not "anthropic".');
  });

  test('allows an app-owned adapter to intentionally replace a built-in provider id', () => {
    const adapter = {
      specificationVersion: 'v3' as const,
      languageModel() { throw new Error('not used'); },
      embeddingModel() { throw new Error('not used'); },
      imageModel() { throw new Error('not used'); },
    };
    const config = resolveAIConfig({
      autoDetect: false,
      providers: {
        openai: {
          type: 'custom',
          adapter,
          capabilities: { embeddings: false, images: false },
        },
      },
    }, {});

    expect(config).not.toBe(false);
    if (config === false) return;
    expect(config.providers.openai).toMatchObject({
      type: 'custom',
      active: true,
      source: 'config',
    });
    expect(config.aliases.fast).toBe('openai/gpt-4o-mini');
    expect(config.aliases.embedding).toBeUndefined();
    expect(config.aliases.image).toBeUndefined();
  });

  test('preserves built-in identity when a provider is explicitly disabled', () => {
    const config = resolveAIConfig({
      providers: { bedrock: false },
    }, {
      AWS_BEARER_TOKEN_BEDROCK: 'ignored-token',
      AWS_REGION: 'us-east-1',
    });

    expect(config).not.toBe(false);
    if (config === false) return;

    expect(config.providers.bedrock).toEqual({
      id: 'bedrock',
      type: 'amazon-bedrock',
      source: 'config',
      enabled: false,
      active: false,
      configuredBy: [],
      capabilities: {
        text: true,
        streaming: true,
        tools: true,
        vision: true,
        embeddings: true,
        images: true,
        transcription: false,
        speech: false,
        reranking: true,
        video: false,
        files: false,
        fileMetadata: false,
        fileDownload: false,
        fileDelete: false,
        skills: false,
        realtime: false,
        evaluation: false,
        batch: false,
      },
      reason: 'config_disabled',
    });
  });
});

describe('AIService.status', () => {
  test('reports capability-aware hosted-files provider operations', () => {
    const complete = resolveAIConfig({
      autoDetect: false,
      filesProvider: 'openai',
      providers: { openai: { type: 'openai', apiKey: 'openai-key' } },
    }, {});
    const uploadOnly = resolveAIConfig({
      autoDetect: false,
      filesProvider: 'google',
      providers: { google: { type: 'google', apiKey: 'google-key' } },
    }, {});
    const missing = resolveAIConfig({
      autoDetect: false,
      filesProvider: 'missing',
      providers: {},
    }, {});

    expect(complete).not.toBe(false);
    expect(uploadOnly).not.toBe(false);
    expect(missing).not.toBe(false);
    if (complete === false || uploadOnly === false || missing === false) return;

    expect(new AIService(complete).status().filesProvider).toEqual({
      providerId: 'openai',
      active: true,
      reason: null,
      operations: { upload: true, metadata: true, download: true, delete: true },
    });
    expect(new AIService(uploadOnly).status().filesProvider).toEqual({
      providerId: 'google',
      active: true,
      reason: null,
      operations: { upload: true, metadata: false, download: false, delete: false },
    });
    expect(new AIService(missing).status().filesProvider).toEqual({
      providerId: 'missing',
      active: false,
      reason: 'provider_not_configured',
      operations: { upload: false, metadata: false, download: false, delete: false },
    });
  });

  test('reports active providers and alias health without secrets', () => {
    const config = resolveAIConfig(true, {
      OPENAI_API_KEY: 'openai-key',
      ZERO_AI_SMART_MODEL: 'openai/gpt-4o',
    });
    expect(config).not.toBe(false);
    if (config === false) return;

    const service = new AIService(config);
    const status = service.status();

    const openai = status.providers.find((provider) => provider.id === 'openai');
    expect(openai?.active).toBe(true);
    expect(openai).not.toHaveProperty('apiKey');
    expect(status.aliases.smart).toEqual({
      model: 'openai/gpt-4o',
      active: true,
      reason: null,
    });
    expect(service.getStatus()).toEqual(status);
  });

  test('checks alias health against the alias capability', () => {
    const config = resolveAIConfig(true, {
      DEEPGRAM_API_KEY: 'deepgram-key',
    });
    expect(config).not.toBe(false);
    if (config === false) return;

    const status = new AIService(config).status();

    expect(status.aliases.speech).toEqual({
      model: 'deepgram/aura-2-helena-en',
      active: true,
      reason: null,
    });
  });

  test('projects only provider origins and redacts path/query/fragment credentials', () => {
    const config = resolveAIConfig({
      autoDetect: false,
      providers: {
        openai: {
          type: 'openai',
          apiKey: 'openai-key',
          baseURL: 'https://zero-user:zero-password@ai-proxy.example.test/v1/path-secret?token=query-secret#private',
        },
      },
    }, {});
    expect(config).not.toBe(false);
    if (config === false) return;

    const status = new AIService(config).status();
    expect(status.providers).toContainEqual(expect.objectContaining({
      id: 'openai',
      baseURL: 'https://ai-proxy.example.test',
    }));
    expect(JSON.stringify(status)).not.toContain('zero-user');
    expect(JSON.stringify(status)).not.toContain('zero-password');
    expect(JSON.stringify(status)).not.toContain('path-secret');
    expect(JSON.stringify(status)).not.toContain('query-secret');
  });

  test('returns detached provider status collections that cannot mutate live capability gates', () => {
    const config = resolveAIConfig(true, { OPENAI_API_KEY: 'openai-key' });
    expect(config).not.toBe(false);
    if (config === false) return;

    const service = new AIService(config);
    const first = service.status();
    const openai = first.providers.find((provider) => provider.id === 'openai');
    expect(openai).toBeDefined();
    openai!.configuredBy.push('MUTATED');
    openai!.capabilities.tools = false;

    const second = service.status().providers.find((provider) => provider.id === 'openai');
    expect(second?.configuredBy).toEqual(['OPENAI_API_KEY']);
    expect(second?.capabilities.tools).toBe(true);
    expect(config.providers.openai.capabilities.tools).toBe(true);
  });
});

describe('AIService request capability checks', () => {
  test('fails provider construction with a stable error and secret-safe observability', () => {
    const store = new MemoryEventStore();
    configureObservability({ console: false, store });
    const config = resolveAIConfig({
      autoDetect: false,
      providers: {
        broken: {
          type: 'custom',
          adapter: () => {
            const error = new Error('vendor setup included super-secret-value');
            error.name = 'PrivateVendor-super-secret-name';
            throw error;
          },
        },
      },
    }, {});
    expect(config).not.toBe(false);
    if (config === false) return;

    try {
      expect(() => new AIService(config)).toThrow('AI provider "broken" could not be initialized.');
      const events = store.query({ code: OBS_CODES.AI_PROVIDER_FAILED.code }).events;
      expect(events).toHaveLength(1);
      expect(events[0].metadata).toMatchObject({
        providerId: 'broken',
        providerType: 'custom',
        reason: 'provider_error',
      });
      expect(JSON.stringify(events[0])).not.toContain('super-secret-value');
      expect(JSON.stringify(events[0])).not.toContain('PrivateVendor');
    } finally {
      configureObservability({ console: false });
    }
  });

  test('rejects tools before provider calls when the selected provider does not support tools', async () => {
    const config = resolveAIConfig({
      autoDetect: false,
      providers: {
        local: {
          type: 'openai-compatible',
          apiKey: 'local-key',
          baseURL: 'http://localhost:11434/v1',
          capabilities: { tools: false },
        },
      },
      aliases: {
        smart: 'local/test-model',
      },
    }, {});
    expect(config).not.toBe(false);
    if (config === false) return;

    const tools = defineAITools({
      lookup: aiTool({
        execute: () => ({ ok: true }),
      }),
    });

    await expect(new AIService(config).generateText({
      model: 'smart',
      prompt: 'Use a tool.',
      tools,
    })).rejects.toMatchObject({
      code: 'AI_CAPABILITY_NOT_SUPPORTED',
      message: 'AI provider "local" does not support tools.',
    });
  });

  test('rejects streaming before provider calls when the selected provider does not support streaming', () => {
    const config = resolveAIConfig({
      autoDetect: false,
      providers: {
        local: {
          type: 'openai-compatible',
          apiKey: 'local-key',
          baseURL: 'http://localhost:11434/v1',
          capabilities: { streaming: false },
        },
      },
      aliases: {
        smart: 'local/test-model',
      },
    }, {});
    expect(config).not.toBe(false);
    if (config === false) return;

    expect(() => new AIService(config).streamText({
      model: 'smart',
      prompt: 'Stream this.',
    })).toThrow(expect.objectContaining({
      code: 'AI_CAPABILITY_NOT_SUPPORTED',
      message: 'AI provider "local" does not support streaming.',
    }));
  });

  test('rejects image messages before provider calls when the selected provider does not support vision', async () => {
    const config = resolveAIConfig({
      autoDetect: false,
      providers: {
        local: {
          type: 'openai-compatible',
          apiKey: 'local-key',
          baseURL: 'http://localhost:11434/v1',
          capabilities: { vision: false },
        },
      },
      aliases: {
        smart: 'local/test-model',
      },
    }, {});
    expect(config).not.toBe(false);
    if (config === false) return;

    await expect(new AIService(config).generateConversation({
      model: 'smart',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Describe this.' },
            { type: 'image', url: 'https://example.test/image.png' },
          ],
        },
      ],
    })).rejects.toMatchObject({
      code: 'AI_CAPABILITY_NOT_SUPPORTED',
      message: 'AI provider "local" does not support vision inputs.',
    });
  });

  test('rejects speech generation before provider calls when the selected provider does not support speech', async () => {
    const config = resolveAIConfig({
      autoDetect: false,
      providers: {
        local: {
          type: 'openai-compatible',
          apiKey: 'local-key',
          baseURL: 'http://localhost:11434/v1',
          capabilities: { speech: false },
        },
      },
      aliases: {
        speech: 'local/test-speech-model',
      },
    }, {});
    expect(config).not.toBe(false);
    if (config === false) return;

    await expect(new AIService(config).generateSpeech({
      model: 'speech',
      text: 'Hello.',
    })).rejects.toMatchObject({
      code: 'AI_CAPABILITY_NOT_SUPPORTED',
      message: 'AI provider "local" does not support speech.',
    });
  });

  test('routes Deepgram speech through the configured base URL override', async () => {
    const config = resolveAIConfig(true, {
      DEEPGRAM_API_KEY: 'deepgram-key',
      DEEPGRAM_BASE_URL: 'https://deepgram-proxy.test/api',
    });
    expect(config).not.toBe(false);
    if (config === false) return;

    const originalFetch = globalThis.fetch;
    let requestedUrl: string | null = null;
    globalThis.fetch = (async (input) => {
      requestedUrl = input instanceof Request ? input.url : input.toString();
      return new Response(new Uint8Array([1, 2, 3]), {
        headers: { 'content-type': 'audio/mpeg' },
      });
    }) as typeof fetch;

    try {
      await new AIService(config).generateSpeech({
        model: 'speech',
        text: 'Hello.',
      });
    } finally {
      globalThis.fetch = originalFetch;
    }

    const url = requestedUrl ?? '';
    expect(url).toStartWith('https://deepgram-proxy.test/api/v1/speak?');
    expect(url).toContain('model=aura-2-helena-en');
  });

  test('emits observability when model aliases cannot be resolved before a provider call', async () => {
    const store = new MemoryEventStore();
    configureObservability({ console: false, store });
    const config = resolveAIConfig({
      autoDetect: false,
      providers: {
        openai: {
          type: 'openai',
          apiKey: 'openai-key',
        },
      },
    }, {});
    expect(config).not.toBe(false);
    if (config === false) return;

    try {
      await expect(new AIService(config).generateText({
        model: 'missingAlias',
        prompt: 'Hello.',
      })).rejects.toMatchObject({
        code: 'AI_MODEL_NOT_CONFIGURED',
      });

      const events = store.query({ code: OBS_CODES.AI_MODEL_ALIAS_UNRESOLVED.code }).events;
      expect(events).toHaveLength(1);
      expect(events[0].metadata).toMatchObject({
        requestedModel: 'missingAlias',
        capability: 'text',
        reason: 'AI_MODEL_NOT_CONFIGURED',
      });
    } finally {
      configureObservability({ console: false });
    }
  });
});
