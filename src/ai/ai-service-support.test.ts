import { describe, expect, test } from 'bun:test';
import {
  InvalidArgumentError,
  InvalidPromptError,
  InvalidToolApprovalError,
  NoOutputGeneratedError,
  NoSuchToolError,
  UnsupportedFunctionalityError,
} from 'ai';

import { AIError } from './ai-errors';
import { normalizeAIRequestError, promptInput } from './ai-service-support';

describe('AI request normalization', () => {
  test('keeps one trusted copy of a conversation system instruction', () => {
    expect(promptInput({
      system: 'Follow the application policy.',
      messages: [
        { role: 'system', content: 'Follow the application policy.' },
        { role: 'user', content: 'Hello.' },
      ],
    })).toEqual({
      messages: [{ role: 'user', content: 'Hello.' }],
      instructions: 'Follow the application policy.',
    });
  });

  test('preserves distinct system history alongside the trusted instruction', () => {
    expect(promptInput({
      system: 'Follow the application policy.',
      messages: [
        { role: 'system', content: 'This prior turn used a specialist persona.' },
        { role: 'user', content: 'Hello.' },
      ],
    })).toEqual({
      instructions: [
        { role: 'system', content: 'Follow the application policy.' },
        { role: 'system', content: 'This prior turn used a specialist persona.' },
      ],
      messages: [
        { role: 'user', content: 'Hello.' },
      ],
    });
  });

  test('snapshots provider options carried by trusted instructions', () => {
    const providerOptions = { anthropic: { cacheControl: { type: 'ephemeral' } } };
    const result = promptInput({
      instructions: {
        role: 'system',
        content: 'Follow the application policy.',
        providerOptions,
      },
    });

    expect(result.instructions).toEqual([{
      role: 'system',
      content: 'Follow the application policy.',
      providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } },
    }]);
    const normalized = (result.instructions as Array<{
      providerOptions?: typeof providerOptions;
    }>)[0]!;
    expect(normalized.providerOptions).not.toBe(providerOptions);
    expect(Object.isFrozen(normalized.providerOptions)).toBe(true);
    expect(Object.isFrozen(normalized.providerOptions?.anthropic)).toBe(true);
  });
});

describe('AI request errors', () => {
  test('maps invalid SDK prompts to the stable Zero request error', () => {
    const error = normalizeAIRequestError(new InvalidPromptError({
      prompt: [],
      message: 'messages must not expose private-prompt-content',
    }));

    expect(error).toMatchObject({
      code: 'AI_REQUEST_INVALID',
      status: 400,
      message: 'AI request is invalid.',
    });
    expect(JSON.stringify(error)).not.toContain('private-prompt-content');
  });

  test('maps invalid SDK call settings while preserving Zero and provider failures', () => {
    const invalid = normalizeAIRequestError(new InvalidArgumentError({
      parameter: 'temperature',
      value: -1,
      message: 'temperature must be greater than or equal to 0.',
    }));
    expect(invalid).toMatchObject({ code: 'AI_REQUEST_INVALID', status: 400 });

    const zero = new AIError('Provider inactive.', 'AI_PROVIDER_NOT_ACTIVE', 503);
    expect(normalizeAIRequestError(zero)).toBe(zero);

    expect(normalizeAIRequestError(new Error('Provider unavailable.'))).toMatchObject({
      code: 'AI_REQUEST_FAILED',
      status: 502,
      message: 'AI provider request failed.',
    });
  });

  test('redacts generated output failures and classifies timeouts and aborts', () => {
    expect(normalizeAIRequestError(new NoOutputGeneratedError({
      message: 'The provider emitted private generated content.',
    }))).toMatchObject({
      code: 'AI_OUTPUT_INVALID',
      status: 502,
      message: 'The AI provider response did not match the requested output.',
    });

    expect(normalizeAIRequestError(new DOMException('step expired', 'TimeoutError'))).toMatchObject({
      code: 'AI_REQUEST_TIMEOUT',
      status: 504,
    });
    expect(normalizeAIRequestError(new DOMException('caller cancelled', 'AbortError'))).toMatchObject({
      code: 'AI_REQUEST_ABORTED',
      status: 499,
    });

    const controller = new AbortController();
    controller.abort('application-defined reason');
    expect(normalizeAIRequestError('application-defined reason', controller.signal)).toMatchObject({
      code: 'AI_REQUEST_ABORTED',
      status: 499,
    });
  });

  test('classifies SDK 7 tool, approval, and capability errors without leaking payloads', () => {
    expect(normalizeAIRequestError(new NoSuchToolError({
      toolName: 'private-tool-name',
      availableTools: ['safe-tool'],
    }))).toMatchObject({
      code: 'AI_PROVIDER_RESPONSE_INVALID',
      status: 502,
      message: 'The AI provider returned an invalid response.',
    });

    expect(normalizeAIRequestError(new InvalidToolApprovalError({
      approvalId: 'private-approval-id',
    }))).toMatchObject({
      code: 'AI_REQUEST_INVALID',
      status: 400,
      message: 'AI request is invalid.',
    });

    expect(normalizeAIRequestError(new UnsupportedFunctionalityError({
      functionality: 'private-provider-feature',
    }))).toMatchObject({
      code: 'AI_CAPABILITY_NOT_SUPPORTED',
      status: 400,
      message: 'The selected AI model does not support this operation.',
    });
  });
});
