/** Factories for official image, speech, and transcription providers. */

import { createAssemblyAI } from '@ai-sdk/assemblyai';
import { createBlackForestLabs } from '@ai-sdk/black-forest-labs';
import { createByteDance } from '@ai-sdk/bytedance';
import { createCartesia } from '@ai-sdk/cartesia';
import { createDeepgram } from '@ai-sdk/deepgram';
import { createElevenLabs } from '@ai-sdk/elevenlabs';
import { createFal } from '@ai-sdk/fal';
import { createFishAudio } from '@ai-sdk/fish-audio';
import { createGladia } from '@ai-sdk/gladia';
import { createHume } from '@ai-sdk/hume';
import { createLuma } from '@ai-sdk/luma';
import { createKlingAI } from '@ai-sdk/klingai';
import { createProdia } from '@ai-sdk/prodia';
import { createQuiverAI } from '@ai-sdk/quiverai';
import { createReplicate } from '@ai-sdk/replicate';
import { createRevai } from '@ai-sdk/revai';
import { createTopaz } from '@ai-sdk/topaz';

import type { ResolvedAIProviderConfig } from '../ai-types';
import {
  commonProviderOptions,
  asAISDKFetch,
  createBaseURLRewriteFetch,
  fixedEndpointProviderOptions,
  normalizeProviderAdapter,
} from './provider-factory-types';

const QUIVERAI_DEFAULT_BASE_URL = 'https://api.quiver.ai/v1';
const CARTESIA_DEFAULT_BASE_URL = 'https://api.cartesia.ai';

export function createFalAdapter(provider: ResolvedAIProviderConfig) {
  const falFetch = provider.baseURL
    ? createBaseURLRewriteFetch(
        provider.baseURL,
        'https://queue.fal.run',
        createBaseURLRewriteFetch(provider.baseURL, 'https://fal.run', provider.fetch)
      )
    : provider.fetch;
  return normalizeProviderAdapter(createFal({
    ...commonProviderOptions(provider),
    fetch: asAISDKFetch(falFetch),
  }));
}

export function createLumaAdapter(provider: ResolvedAIProviderConfig) {
  return normalizeProviderAdapter(createLuma(commonProviderOptions(provider)));
}

export function createProdiaAdapter(provider: ResolvedAIProviderConfig) {
  return normalizeProviderAdapter(createProdia(commonProviderOptions(provider)));
}

export function createKlingAIAdapter(provider: ResolvedAIProviderConfig) {
  return normalizeProviderAdapter(createKlingAI({
    ...commonProviderOptions(provider),
    accessKey: provider.settings?.accessKey,
    secretKey: provider.settings?.secretKey,
  }));
}

export function createCartesiaAdapter(provider: ResolvedAIProviderConfig) {
  return normalizeProviderAdapter(createCartesia({
    ...fixedEndpointProviderOptions(provider),
    version: provider.settings?.version,
    webSocket: provider.settings?.webSocket,
    fetch: asAISDKFetch(provider.baseURL
      ? createBaseURLRewriteFetch(provider.baseURL, CARTESIA_DEFAULT_BASE_URL, provider.fetch)
      : provider.fetch),
  }));
}

export function createTopazAdapter(provider: ResolvedAIProviderConfig) {
  return normalizeProviderAdapter(createTopaz(commonProviderOptions(provider)));
}

export function createDeepgramAdapter(provider: ResolvedAIProviderConfig) {
  return normalizeProviderAdapter(createDeepgram({
    ...fixedEndpointProviderOptions(provider),
    fetch: asAISDKFetch(provider.baseURL
      ? createBaseURLRewriteFetch(provider.baseURL, 'https://api.deepgram.com', provider.fetch)
      : provider.fetch),
  }));
}

export function createElevenLabsAdapter(provider: ResolvedAIProviderConfig) {
  return normalizeProviderAdapter(createElevenLabs(rewriteFixedEndpointOptions(
    provider,
    'https://api.elevenlabs.io'
  )));
}

export function createHumeAdapter(provider: ResolvedAIProviderConfig) {
  return normalizeProviderAdapter(createHume(rewriteFixedEndpointOptions(
    provider,
    'https://api.hume.ai'
  )));
}

export function createRevaiAdapter(provider: ResolvedAIProviderConfig) {
  return normalizeProviderAdapter(createRevai(rewriteFixedEndpointOptions(
    provider,
    'https://api.rev.ai'
  )));
}

export function createAssemblyAIAdapter(provider: ResolvedAIProviderConfig) {
  return normalizeProviderAdapter(createAssemblyAI(rewriteFixedEndpointOptions(
    provider,
    'https://api.assemblyai.com'
  )));
}

export function createGladiaAdapter(provider: ResolvedAIProviderConfig) {
  return normalizeProviderAdapter(createGladia(rewriteFixedEndpointOptions(
    provider,
    'https://api.gladia.io'
  )));
}

export function createFishAudioAdapter(provider: ResolvedAIProviderConfig) {
  return normalizeProviderAdapter(createFishAudio(commonProviderOptions(provider)));
}

export function createReplicateAdapter(provider: ResolvedAIProviderConfig) {
  return normalizeProviderAdapter(createReplicate({
    apiToken: provider.apiKey ?? undefined,
    baseURL: provider.baseURL ?? undefined,
    headers: provider.headers,
    fetch: asAISDKFetch(provider.fetch),
  }));
}

export function createBlackForestLabsAdapter(provider: ResolvedAIProviderConfig) {
  return normalizeProviderAdapter(createBlackForestLabs({
    ...commonProviderOptions(provider),
    pollIntervalMillis: provider.settings?.pollIntervalMillis,
    pollTimeoutMillis: provider.settings?.pollTimeoutMillis,
  }));
}

export function createByteDanceAdapter(provider: ResolvedAIProviderConfig) {
  return normalizeProviderAdapter(createByteDance(commonProviderOptions(provider)));
}

export function createQuiverAIAdapter(provider: ResolvedAIProviderConfig) {
  return normalizeProviderAdapter(createQuiverAI(
    commonProviderOptions(provider, QUIVERAI_DEFAULT_BASE_URL)
  ));
}

function rewriteFixedEndpointOptions(
  provider: ResolvedAIProviderConfig,
  upstreamBaseURL: string
) {
  return {
    ...fixedEndpointProviderOptions(provider),
    fetch: asAISDKFetch(provider.baseURL
      ? createBaseURLRewriteFetch(provider.baseURL, upstreamBaseURL, provider.fetch)
      : provider.fetch),
  };
}
