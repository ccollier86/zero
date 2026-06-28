import { describe, expect, test } from 'bun:test';

import { AIConversationSessionBuilder } from './ai-session';
import type { AIGenerateConversationRequest, AITextResult } from './ai-types';

describe('AIConversationSessionBuilder', () => {
  test('carries prior user and assistant turns into the next request', async () => {
    const requests: AIGenerateConversationRequest[] = [];
    const session = new AIConversationSessionBuilder({
      async generateConversation(request) {
        requests.push({ ...request, messages: [...request.messages] });
        return { text: `answer-${requests.length}` } as AITextResult;
      },
    }, {
      model: 'smart',
      system: 'Use short answers.',
    });

    await session.send('first');
    await session.send('second');

    expect(requests[0].messages).toEqual([
      { role: 'system', content: 'Use short answers.' },
      { role: 'user', content: 'first' },
    ]);
    expect(requests[1].messages).toEqual([
      { role: 'system', content: 'Use short answers.' },
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'answer-1' },
      { role: 'user', content: 'second' },
    ]);
    expect(session.messages()).toEqual([
      { role: 'system', content: 'Use short answers.' },
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'answer-1' },
      { role: 'user', content: 'second' },
      { role: 'assistant', content: 'answer-2' },
    ]);
  });

  test('bounds retained messages while preserving the configured system prompt', () => {
    const session = new AIConversationSessionBuilder({
      async generateConversation() {
        return { text: 'ok' } as AITextResult;
      },
    }, {
      system: 'System stays.',
      maxMessages: 3,
    });

    session.user('one').assistant('two').user('three').assistant('four');

    expect(session.messages()).toEqual([
      { role: 'system', content: 'System stays.' },
      { role: 'user', content: 'three' },
      { role: 'assistant', content: 'four' },
    ]);
  });
});
