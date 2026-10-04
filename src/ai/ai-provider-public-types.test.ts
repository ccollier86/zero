import { describe, expect, test } from 'bun:test';

import type {
  AICustomProviderContext,
  AIModelAliasStatus,
  AIProviderStatus,
  AIStatus,
  AIStatusEndpointReadMode,
  ResolvedAIConfig,
  ResolvedAIProviderConfig,
  ResolvedAIStatusEndpointConfig,
} from '@zero/framework/ai';
import type {
  AIModelAliasStatus as ServerAIModelAliasStatus,
  AIStatusEndpointReadMode as ServerAIStatusEndpointReadMode,
  ResolvedAIStatusEndpointConfig as ServerResolvedAIStatusEndpointConfig,
} from '@zero/framework/server';

describe('public AI provider types', () => {
  test('keeps original capability literals source-compatible after capability expansion', () => {
    const capabilities = {
      text: true,
      streaming: true,
      tools: true,
      vision: true,
      embeddings: true,
      images: true,
      transcription: true,
      speech: true,
    } as const;
    const context = { id: 'legacy', capabilities } satisfies AICustomProviderContext;
    const provider = {
      id: 'legacy',
      type: 'custom',
      source: 'config',
      active: true,
      configuredBy: [],
      capabilities,
      reason: null,
      adapter: {} as ResolvedAIProviderConfig['adapter'],
    } satisfies ResolvedAIProviderConfig;
    const status = {
      id: 'legacy',
      type: 'custom',
      source: 'config',
      active: true,
      configuredBy: [],
      baseURL: null,
      capabilities,
      reason: null,
    } satisfies AIProviderStatus;

    expect(context.capabilities.text).toBe(true);
    expect(provider.capabilities.streaming).toBe(true);
    expect(status.capabilities.tools).toBe(true);
  });
  test('keeps pre-hosted-files resolved config and status literals source-compatible', () => {
    const config = {
      enabled: true,
      autoDetect: false,
      providers: {},
      aliases: {},
      statusEndpoint: { enabled: false, basePath: '/api/_zero/ai' },
    } satisfies ResolvedAIConfig;
    const status = {
      enabled: true,
      providers: [],
      aliases: {},
    } satisfies AIStatus;

    expect(config).not.toHaveProperty('filesProvider');
    expect(status).not.toHaveProperty('filesProvider');
  });

  test('exports status helper contracts from both server-side package boundaries', () => {
    const readMode: AIStatusEndpointReadMode = 'admin-or-dev';
    const serverReadMode: ServerAIStatusEndpointReadMode = readMode;
    const endpoint: ResolvedAIStatusEndpointConfig = {
      enabled: true,
      basePath: '/api/_zero/ai',
      read: serverReadMode,
    };
    const serverEndpoint: ServerResolvedAIStatusEndpointConfig = endpoint;
    const alias: AIModelAliasStatus = {
      model: 'openai/gpt-4o-mini',
      active: true,
      reason: null,
    };
    const serverAlias: ServerAIModelAliasStatus = alias;

    expect(serverEndpoint.enabled).toBe(true);
    expect(serverAlias.active).toBe(true);
  });
});
