import { describe, expect, test } from 'bun:test';

import { AIConversationBuilder, toModelMessages } from './ai-conversation';
import type { AITextResult } from './ai-types';

describe('toModelMessages', () => {
  test('normalizes system, multimodal user, assistant, and tool messages', () => {
    const messages = toModelMessages([
      { role: 'developer', content: 'Stay terse.' },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Read this.' },
          { type: 'image', url: 'https://example.test/image.png' },
        ],
      },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Calling tool.' },
          { type: 'tool-call', toolCallId: 'call_1', toolName: 'lookup', input: { id: '1' } },
        ],
      },
      {
        role: 'tool',
        content: [{ type: 'tool-result', toolCallId: 'call_1', toolName: 'lookup', output: { ok: true } }],
      },
    ]);

    expect(messages[0]).toEqual({ role: 'system', content: 'Stay terse.' });
    expect(messages[1].role).toBe('user');
    expect((messages[1] as any).content[1]).toMatchObject({
      type: 'file',
      mediaType: 'image/png',
      data: {
        type: 'url',
        url: new URL('https://example.test/image.png'),
      },
    });
    expect((messages[2] as any).content[1]).toEqual({
      type: 'tool-call',
      toolCallId: 'call_1',
      toolName: 'lookup',
      input: { id: '1' },
    });
    expect((messages[3] as any).content[0]).toEqual({
      type: 'tool-result',
      toolCallId: 'call_1',
      toolName: 'lookup',
      output: { type: 'json', value: { ok: true } },
    });
  });

  test('normalizes raw tool outputs and preserves valid discriminated outputs', () => {
    const messages = toModelMessages([
      {
        role: 'assistant',
        content: [{
          type: 'tool-result',
          toolCallId: 'assistant-result',
          toolName: 'lookup',
          output: 'plain result',
        }],
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'normalized-result',
            toolName: 'lookup',
            output: { type: 'execution-denied', reason: 'Approval declined.' },
          },
          {
            type: 'tool-result',
            toolCallId: 'undefined-result',
            toolName: 'lookup',
            output: undefined,
          },
        ],
      },
    ]);

    expect((messages[0] as any).content[0].output).toEqual({
      type: 'text',
      value: 'plain result',
    });
    expect((messages[1] as any).content[0].output).toEqual({
      type: 'execution-denied',
      reason: 'Approval declined.',
    });
    expect((messages[1] as any).content[1].output).toEqual({
      type: 'json',
      value: null,
    });
  });

  test('binds hosted-file references to the selected configured provider', () => {
    const message = {
      role: 'user' as const,
      content: [{
        type: 'file' as const,
        hostedFile: {
          version: 1 as const,
          providerId: 'primary-openai',
          providerReference: { 'openai.files': 'file_123' },
        },
        mediaType: 'application/pdf',
        filename: 'record.pdf',
      }],
    };

    const messages = toModelMessages([message], { providerId: 'primary-openai' });
    expect((messages[0] as any).content[0]).toEqual({
      type: 'file',
      data: {
        type: 'reference',
        reference: { 'openai.files': 'file_123' },
      },
      mediaType: 'application/pdf',
      filename: 'record.pdf',
    });

    expect(() => toModelMessages([message])).toThrow(expect.objectContaining({
      code: 'AI_REQUEST_INVALID',
    }));
    expect(() => toModelMessages([message], { providerId: 'other-openai' }))
      .toThrow(expect.objectContaining({ code: 'AI_REQUEST_INVALID' }));
  });

  test('detaches binary files and JSON tool history from caller mutation', () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const toolInput = { nested: { id: 1 } };
    const toolOutput = { nested: { ok: true } };
    const messages = toModelMessages([
      {
        role: 'user',
        content: [{
          type: 'file',
          data: bytes,
          mediaType: 'application/octet-stream',
        }],
      },
      {
        role: 'assistant',
        content: [{ type: 'tool-call', toolCallId: 'call_1', toolName: 'lookup', input: toolInput }],
      },
      {
        role: 'tool',
        content: [{ type: 'tool-result', toolCallId: 'call_1', output: toolOutput }],
      },
    ]);

    bytes[0] = 9;
    toolInput.nested.id = 9;
    toolOutput.nested.ok = false;

    expect((messages[0] as any).content[0].data.data).toEqual(new Uint8Array([1, 2, 3]));
    expect((messages[1] as any).content[0].input).toEqual({ nested: { id: 1 } });
    expect((messages[2] as any).content[0].output).toEqual({
      type: 'json',
      value: { nested: { ok: true } },
    });
  });

  test('preserves SDK 7 content tool results while detaching their media', () => {
    const bytes = new Uint8Array([4, 5, 6]);
    const messages = toModelMessages([{
      role: 'tool',
      content: [{
        type: 'tool-result',
        toolCallId: 'call_1',
        output: {
          type: 'content',
          value: [{
            type: 'file',
            data: { type: 'data', data: bytes },
            mediaType: 'application/octet-stream',
          }],
        },
      }],
    }]);
    bytes[0] = 9;

    expect((messages[0] as any).content[0].output).toMatchObject({
      type: 'content',
      value: [{
        type: 'file',
        data: { type: 'data', data: new Uint8Array([4, 5, 6]) },
        mediaType: 'application/octet-stream',
      }],
    });
  });
});

describe('AIConversationBuilder', () => {
  test('collects messages and delegates generation to the runner', async () => {
    const seen: unknown[] = [];
    const runner = {
      async generateConversation(request: any) {
        seen.push(request.messages);
        return { text: 'ok' } as AITextResult;
      },
      streamConversation() {
        throw new Error('not used');
      },
    };

    const result = await new AIConversationBuilder(runner, { model: 'smart', system: 'System' })
      .user('Hello')
      .assistant('Hi')
      .tool('call_1', { ok: true }, 'lookup')
      .generate();

    expect(result.text).toBe('ok');
    expect(seen[0]).toEqual([
      { role: 'system', content: 'System' },
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi' },
      { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'call_1', toolName: 'lookup', output: { ok: true } }] },
    ]);
  });
});
