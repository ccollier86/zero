/** Bounded transcription and speech orchestration for Zero's AI service. */

import {
  generateSpeech,
  transcribe,
  type SpeechModel,
  type TranscriptionModel,
} from 'ai';

import { AIError } from './ai-errors';
import { snapshotAIJSONValue } from './ai-json-value-snapshot';
import { utf8ByteLength } from './ai-operation-limits';
import { normalizeAIProviderOptions } from './ai-provider-options';
import { snapshotAIHeaders } from './ai-request-snapshot';
import type { AIRequestTelemetry } from './ai-request-telemetry';
import { createAISafeDownload, type AISafeSingleDownload } from './ai-safe-download';
import { normalizeAIRequestError } from './ai-service-support';
import type {
  AIGenerateSpeechRequest,
  AISpeechResult,
  AITranscribeRequest,
  AITranscriptionResult,
} from './ai-types';

export const AI_MAX_AUDIO_INPUT_BYTES = 64 * 1024 * 1024;
export const AI_MAX_SPEECH_OUTPUT_BYTES = 64 * 1024 * 1024;
export const AI_MAX_SPEECH_TEXT_BYTES = 1024 * 1024;
export const AI_MAX_SPEECH_INSTRUCTIONS_BYTES = 256 * 1024;
export const AI_MAX_TRANSCRIPTION_TEXT_BYTES = 16 * 1024 * 1024;
export const AI_MAX_TRANSCRIPTION_SEGMENTS = 100_000;

export interface AITranscriptionOperationContext {
  readonly model: TranscriptionModel;
  readonly requestTelemetry: AIRequestTelemetry;
}

export interface AISpeechOperationContext {
  readonly model: SpeechModel;
  readonly requestTelemetry: AIRequestTelemetry;
}

/** Transcribe bounded, detached audio through a DNS-pinned URL downloader. */
export async function executeAITranscription(
  request: AITranscribeRequest,
  context: AITranscriptionOperationContext,
): Promise<AITranscriptionResult> {
  try {
    const audio = snapshotAudioInput(request.audio);
    const download = boundedAudioDownload(
      request.download ?? createAISafeDownload({
        maxBytes: AI_MAX_AUDIO_INPUT_BYTES,
        abortSignal: request.abortSignal,
      }),
    );
    const result = await transcribe({
      model: boundedTranscriptionModel(context.model),
      audio,
      maxRetries: optionalRetries(request.maxRetries),
      abortSignal: request.abortSignal,
      headers: snapshotAIHeaders(request.headers),
      providerOptions: normalizeAIProviderOptions(request.providerOptions),
      telemetry: request.telemetry,
      download,
    });
    context.requestTelemetry.complete();
    return result;
  } catch (error) {
    const normalized = normalizeAIRequestError(error, request.abortSignal);
    context.requestTelemetry.fail(normalized);
    throw normalized;
  }
}

/** Generate speech with bounded text and provider audio output. */
export async function executeAISpeech(
  request: AIGenerateSpeechRequest,
  context: AISpeechOperationContext,
): Promise<AISpeechResult> {
  try {
    assertTextLimit(request.text, AI_MAX_SPEECH_TEXT_BYTES, 'Speech text');
    if (request.instructions !== undefined) {
      assertTextLimit(
        request.instructions,
        AI_MAX_SPEECH_INSTRUCTIONS_BYTES,
        'Speech instructions',
      );
    }
    const result = await generateSpeech({
      model: boundedSpeechModel(context.model),
      text: request.text,
      voice: request.voice,
      outputFormat: request.outputFormat,
      instructions: request.instructions,
      speed: request.speed,
      language: request.language,
      maxRetries: optionalRetries(request.maxRetries),
      abortSignal: request.abortSignal,
      headers: snapshotAIHeaders(request.headers),
      providerOptions: normalizeAIProviderOptions(request.providerOptions),
      telemetry: request.telemetry,
    });
    const audio = result.audio?.uint8Array;
    if (!(audio instanceof Uint8Array) || audio.byteLength === 0) {
      throw providerAudioInvalid();
    }
    if (audio.byteLength > AI_MAX_SPEECH_OUTPUT_BYTES) throw audioLimit('Speech output');
    context.requestTelemetry.complete();
    return result;
  } catch (error) {
    const normalized = normalizeAIRequestError(error, request.abortSignal);
    context.requestTelemetry.fail(normalized);
    throw normalized;
  }
}

function snapshotAudioInput(
  audio: AITranscribeRequest['audio'],
): AITranscribeRequest['audio'] {
  if (audio instanceof URL) return new URL(audio);
  if (audio instanceof Uint8Array) {
    if (audio.byteLength > AI_MAX_AUDIO_INPUT_BYTES) throw audioLimit('Transcription audio');
    return new Uint8Array(audio);
  }
  if (audio instanceof ArrayBuffer) {
    if (audio.byteLength > AI_MAX_AUDIO_INPUT_BYTES) throw audioLimit('Transcription audio');
    return audio.slice(0);
  }
  if (typeof audio === 'string') {
    // Data-content strings are base64; bound their encoded representation
    // before the SDK allocates the decoded byte array.
    const encodedLimit = Math.ceil((AI_MAX_AUDIO_INPUT_BYTES * 4) / 3) + 16;
    if (audio.length > encodedLimit) throw audioLimit('Transcription audio');
    return audio;
  }
  throw new AIError('Transcription audio is invalid.', 'AI_REQUEST_INVALID', 400);
}

function boundedAudioDownload(delegate: AISafeSingleDownload): AISafeSingleDownload {
  return async (options) => {
    const result = await delegate(options);
    if (!(result?.data instanceof Uint8Array)) throw providerAudioInvalid();
    if (result.data.byteLength > AI_MAX_AUDIO_INPUT_BYTES) {
      throw audioLimit('Transcription audio');
    }
    return {
      data: new Uint8Array(result.data),
      mediaType: result.mediaType,
    };
  };
}

function boundedSpeechModel(model: SpeechModel): SpeechModel {
  if (typeof model !== 'object' || model === null) return model;
  const method = Reflect.get(model, 'doGenerate');
  if (typeof method !== 'function') return model;
  return new Proxy(model, {
    get(target, property, receiver) {
      if (property !== 'doGenerate') return Reflect.get(target, property, receiver);
      return async (options: unknown) => {
        const response: unknown = await Reflect.apply(method, target, [options]);
        if (!isRecord(response)) throw providerAudioInvalid();
        const bytes = rawAudioBytes(response.audio);
        if (bytes > AI_MAX_SPEECH_OUTPUT_BYTES) throw audioLimit('Speech output');
        if (!Array.isArray(response.warnings) || !validResponseMetadata(response.response)) {
          throw providerAudioInvalid();
        }
        return {
          ...response,
          audio: response.audio instanceof Uint8Array
            ? new Uint8Array(response.audio)
            : response.audio,
          warnings: snapshotWarnings(response.warnings),
          response: snapshotResponseMetadata(response.response),
          ...snapshotProviderMetadataProperty(response.providerMetadata),
        };
      };
    },
  }) as SpeechModel;
}

function boundedTranscriptionModel(model: TranscriptionModel): TranscriptionModel {
  if (typeof model !== 'object' || model === null) return model;
  const method = Reflect.get(model, 'doGenerate');
  if (typeof method !== 'function') return model;
  return new Proxy(model, {
    get(target, property, receiver) {
      if (property !== 'doGenerate') return Reflect.get(target, property, receiver);
      return async (options: unknown) => {
        const response: unknown = await Reflect.apply(method, target, [options]);
        if (!isRecord(response)
          || typeof response.text !== 'string'
          || utf8ByteLength(response.text, AI_MAX_TRANSCRIPTION_TEXT_BYTES)
            > AI_MAX_TRANSCRIPTION_TEXT_BYTES
          || !Array.isArray(response.segments)
          || response.segments.length > AI_MAX_TRANSCRIPTION_SEGMENTS
          || (response.language !== undefined && typeof response.language !== 'string')
          || (response.durationInSeconds !== undefined
            && !validNonNegativeNumber(response.durationInSeconds))
          || !Array.isArray(response.warnings)
          || !validResponseMetadata(response.response)) {
          throw providerAudioInvalid();
        }
        let transcriptBytes = utf8ByteLength(response.text, AI_MAX_TRANSCRIPTION_TEXT_BYTES);
        const segments = response.segments.map((segment) => {
          if (!isRecord(segment)
            || typeof segment.text !== 'string'
            || !validNonNegativeNumber(segment.startSecond)
            || !validNonNegativeNumber(segment.endSecond)
            || segment.endSecond < segment.startSecond) {
            throw providerAudioInvalid();
          }
          transcriptBytes += utf8ByteLength(
            segment.text,
            AI_MAX_TRANSCRIPTION_TEXT_BYTES - Math.min(
              transcriptBytes,
              AI_MAX_TRANSCRIPTION_TEXT_BYTES,
            ),
          );
          if (transcriptBytes > AI_MAX_TRANSCRIPTION_TEXT_BYTES) {
            throw providerAudioInvalid();
          }
          return Object.freeze({
            text: segment.text,
            startSecond: segment.startSecond,
            endSecond: segment.endSecond,
          });
        });
        return {
          ...response,
          segments: Object.freeze(segments),
          warnings: snapshotWarnings(response.warnings),
          response: snapshotResponseMetadata(response.response),
          ...snapshotProviderMetadataProperty(response.providerMetadata),
        };
      };
    },
  }) as TranscriptionModel;
}

function rawAudioBytes(value: unknown): number {
  if (value instanceof Uint8Array) return value.byteLength;
  if (typeof value !== 'string' || value.length === 0) throw providerAudioInvalid();
  let characters = 0;
  let padding = 0;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]!;
    if (/\s/u.test(character)) continue;
    characters += 1;
    padding = character === '=' ? Math.min(2, padding + 1) : 0;
    if (characters > Math.ceil((AI_MAX_SPEECH_OUTPUT_BYTES * 4) / 3) + 4) {
      throw audioLimit('Speech output');
    }
  }
  return Math.max(0, Math.floor((characters * 3) / 4) - padding);
}

function validResponseMetadata(value: unknown): value is Record<string, unknown> {
  return isRecord(value)
    && value.timestamp instanceof Date
    && Number.isFinite(value.timestamp.getTime())
    && typeof value.modelId === 'string'
    && value.modelId.length > 0
    && (value.headers === undefined
      || (isRecord(value.headers)
        && Object.values(value.headers).every((entry) => typeof entry === 'string')));
}

function snapshotResponseMetadata(value: Record<string, unknown>): Record<string, unknown> {
  return Object.freeze({
    ...value,
    timestamp: new Date((value.timestamp as Date).getTime()),
    ...(value.headers === undefined
      ? {}
      : { headers: Object.freeze({ ...(value.headers as Record<string, string>) }) }),
  });
}

function snapshotWarnings(value: unknown[]): unknown[] {
  return Object.freeze(value.map((warning) => {
    if (!isRecord(warning) || typeof warning.type !== 'string') throw providerAudioInvalid();
    return Object.freeze({ ...warning });
  })) as unknown[];
}

function snapshotProviderMetadataProperty(value: unknown): { providerMetadata?: unknown } {
  if (value === undefined) return {};
  try {
    const snapshot = snapshotAIJSONValue(value, 'AI provider metadata');
    if (!isRecord(snapshot)) throw providerAudioInvalid();
    return { providerMetadata: snapshot };
  } catch {
    throw providerAudioInvalid();
  }
}

function validNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function assertTextLimit(value: unknown, maxBytes: number, label: string): asserts value is string {
  if (typeof value !== 'string') {
    throw new AIError(`${label} must be a string.`, 'AI_REQUEST_INVALID', 400);
  }
  if (utf8ByteLength(value, maxBytes) > maxBytes) throw audioLimit(label);
}

function optionalRetries(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || value < 0 || value > 10) {
    throw new AIError('maxRetries must be an integer between 0 and 10.', 'AI_REQUEST_INVALID', 400);
  }
  return value;
}

function audioLimit(label: string): AIError {
  return new AIError(`${label} exceeds the byte limit.`, 'AI_REQUEST_LIMIT_EXCEEDED', 413);
}

function providerAudioInvalid(): AIError {
  return new AIError(
    'AI audio provider returned an invalid response.',
    'AI_PROVIDER_RESPONSE_INVALID',
    502,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
