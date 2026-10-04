import { describe, expect, test } from 'bun:test';
import type {
  LanguageModelV4CallOptions,
  LanguageModelV4Message,
  LanguageModelV4ToolResultOutput,
} from '@ai-sdk/provider';

import { AIError } from '../ai-errors';
import {
  BEDROCK_INACTIVE_TOOL_HISTORY_MAX_BYTES,
  projectInactiveToolHistory,
} from './bedrock-tool-history';

function callOptions(
  prompt: LanguageModelV4Message[],
  overrides: Partial<LanguageModelV4CallOptions> = {},
): LanguageModelV4CallOptions {
  return { prompt, ...overrides };
}

function toolResult(output: LanguageModelV4ToolResultOutput, id = 'call_1') {
  return {
    type: 'tool-result' as const,
    toolCallId: id,
    toolName: 'lookup_status',
    output,
  };
}

function projectedText(options: LanguageModelV4CallOptions): string {
  const text: string[] = [];
  for (const message of projectInactiveToolHistory(options).prompt) {
    if (typeof message.content === 'string') {
      text.push(message.content);
      continue;
    }
    for (const part of message.content) {
      if (part.type === 'text') text.push(part.text);
    }
  }
  return text.join('\n');
}

function expectInvalidProjection(run: () => unknown): AIError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(AIError);
    const aiError = error as AIError;
    expect(aiError.code).toBe('AI_REQUEST_INVALID');
    expect(aiError.status).toBe(400);
    return aiError;
  }
  throw new Error('Expected Bedrock history projection to fail.');
}

describe('Bedrock inactive tool history projection', () => {
  test('returns the original call when a native tool is active', () => {
    const options = callOptions([
      {
        role: 'assistant',
        content: [{
          type: 'tool-call',
          toolCallId: 'call_1',
          toolName: 'lookup_status',
          input: {},
        }],
      },
    ], {
      tools: [{
        type: 'function',
        name: 'lookup_status',
        inputSchema: { type: 'object', properties: {} },
      }],
      toolChoice: { type: 'auto' },
    });

    expect(projectInactiveToolHistory(options)).toBe(options);
  });

  test('retains every safely representable V4 tool-result variant', () => {
    const options = callOptions([{
      role: 'tool',
      content: [
        toolResult({ type: 'text', value: 'plain result' }, 'text'),
        toolResult({ type: 'json', value: { status: 'ready' } }, 'json'),
        toolResult({ type: 'execution-denied', reason: 'not approved' }, 'denied'),
        toolResult({ type: 'error-text', value: 'text failure' }, 'error-text'),
        toolResult({ type: 'error-json', value: { code: 'FAILED' } }, 'error-json'),
        toolResult({
          type: 'content',
          value: [
            { type: 'text', text: 'content text' },
            {
              type: 'file',
              data: { type: 'text', text: 'inline document' },
              mediaType: 'text/plain',
              filename: 'status.txt',
            },
          ],
        }, 'content'),
      ],
    }]);

    const text = projectedText(options);
    expect(text).toContain('plain result');
    expect(text).toContain('"status":"ready"');
    expect(text).toContain('not approved');
    expect(text).toContain('text failure');
    expect(text).toContain('"code":"FAILED"');
    expect(text).toContain('content text');
    expect(text).toContain('inline document');
    expect(text).toContain('status.txt');
  });

  test('does not reinterpret tool-role provider options as user-message options', () => {
    const requestOptions = { bedrock: { requestFlag: true } };
    const toolMessageOptions = { bedrock: { nativeToolFlag: true } };
    const partOptions = { bedrock: { nativeResultFlag: true } };
    const options = callOptions([{
      role: 'tool',
      providerOptions: toolMessageOptions,
      content: [{
        ...toolResult({ type: 'text', value: 'safe result' }),
        providerOptions: partOptions,
      }],
    }], { providerOptions: requestOptions });

    const projected = projectInactiveToolHistory(options);
    expect(projected.providerOptions).toBe(requestOptions);
    expect(projected.prompt[0].role).toBe('user');
    const projectedMessage = projected.prompt[0];
    if (projectedMessage.role !== 'user') throw new Error('Expected a projected user message.');
    expect('providerOptions' in projectedMessage).toBe(false);
    expect('providerOptions' in projectedMessage.content[0]).toBe(false);
  });

  test('fails closed for binary-file and custom tool-result content', () => {
    const unsafeOutputs: LanguageModelV4ToolResultOutput[] = [
      {
        type: 'content',
        value: [{
          type: 'file',
          data: { type: 'data', data: new Uint8Array([1, 2, 3]) },
          mediaType: 'application/octet-stream',
        }],
      },
      { type: 'content', value: [{ type: 'custom' }] },
    ];

    for (const output of unsafeOutputs) {
      const error = expectInvalidProjection(() => projectInactiveToolHistory(callOptions([{
        role: 'tool',
        content: [toolResult(output)],
      }])));
      expect(error.message).not.toContain('application/octet-stream');
    }
  });

  test('fails closed for cyclic or over-budget history without exposing values', () => {
    const secret = 'zero-private-cyclic-value';
    const cyclic: Record<string, unknown> = { secret };
    cyclic.self = cyclic;
    const cyclicError = expectInvalidProjection(() => projectInactiveToolHistory(callOptions([{
      role: 'assistant',
      content: [{
        type: 'tool-call',
        toolCallId: 'call_cyclic',
        toolName: 'lookup_status',
        input: cyclic,
      }],
    }])));
    expect(cyclicError.message).not.toContain(secret);

    const oversized = 'x'.repeat(BEDROCK_INACTIVE_TOOL_HISTORY_MAX_BYTES + 1);
    const budgetError = expectInvalidProjection(() => projectInactiveToolHistory(callOptions([{
      role: 'tool',
      content: [toolResult({ type: 'text', value: oversized })],
    }])));
    expect(budgetError.message).not.toContain(oversized.slice(0, 100));
  });
});
