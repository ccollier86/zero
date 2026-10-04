import { AIError } from './ai-errors';

export function assertAISafeDownloadByteLimit(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new AIError(
      'AI download byte limit must be a positive safe integer.',
      'AI_PROVIDER_CONFIG_INVALID',
      500,
    );
  }
  return value;
}

export function invalidRemoteAIAsset(message: string): AIError {
  return new AIError(message, 'AI_REQUEST_INVALID', 400);
}

export function remoteAIAssetDownloadFailed(): AIError {
  return new AIError('Remote AI input could not be downloaded.', 'AI_REQUEST_FAILED', 502);
}

export function remoteAIAssetTooLarge(): AIError {
  return new AIError(
    'Remote AI input exceeds the configured byte limit.',
    'AI_REQUEST_LIMIT_EXCEEDED',
    413,
  );
}

export function remoteAIAssetDownloadAborted(): AIError {
  return new AIError('Remote AI input download was aborted.', 'AI_REQUEST_ABORTED', 499);
}

export function remoteAIAssetDownloadTimedOut(): AIError {
  return new AIError('Remote AI input download timed out.', 'AI_REQUEST_TIMEOUT', 504);
}
