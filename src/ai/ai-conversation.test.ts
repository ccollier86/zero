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
      output: { ok: true },
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
