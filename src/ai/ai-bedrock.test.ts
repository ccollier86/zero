import { describe, expect, test } from 'bun:test';
import { stepCountIs } from 'ai';

import { resolveAIConfig } from './ai-env';
import { AIService } from './ai-service';
import { aiTool, defineAITools } from './ai-toolkit';
import type { AIMessage, ResolvedAIConfig } from './ai-types';

const NOOP_OBSERVABILITY = { emitCode: () => undefined } as const;

function historicalToolMessages(): AIMessage[] {
  return [
    { role: 'user', content: 'Look up the patient status.' },
    {
      role: 'assistant',
      content: [{
        type: 'tool-call',
        toolCallId: 'call_status_1',
        toolName: 'lookup_status',
        input: { patientId: 'patient_1' },
      }],
    },
    {
      role: 'tool',
      content: [{
        type: 'tool-result',
        toolCallId: 'call_status_1',
        toolName: 'lookup_status',
        output: { status: 'zero-history-value' },
      }],
    },
    { role: 'user', content: 'Summarize the status without calling another tool.' },
  ];
}

function bedrockTestConfig(fetch: typeof globalThis.fetch): ResolvedAIConfig {
  const config = resolveAIConfig({
    autoDetect: false,
    providers: {
      bedrock: {
        type: 'amazon-bedrock',
        apiKey: 'zero-bedrock-bearer',
        baseURL: 'https://bedrock-runtime.example.test',
        fetch,
      },
    },
    aliases: { smart: 'bedrock/amazon.nova-micro-v1:0' },
  }, {});
  if (config === false) throw new Error('Bedrock test configuration unexpectedly disabled AI.');
  return config;
}

function textResponse(text: string): Response {
  return Response.json({
    output: { message: { role: 'assistant', content: [{ text }] } },
    stopReason: 'end_turn',
    usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
  });
}

function statusTool(execute?: (input: { patientId: string }) => unknown) {
  return defineAITools({
    lookup_status: aiTool<{ patientId: string }, unknown>({
      description: 'Look up a patient status.',
      input: {
        type: 'object',
        properties: { patientId: { type: 'string' } },
        required: ['patientId'],
        additionalProperties: false,
      },
      execute,
    }),
  });
}

describe('Amazon Bedrock runtime integration', () => {
  test('signs a Bun fetch request and preserves model ids containing slashes', async () => {
    let capturedRequest: Request | null = null;
    const modelId = 'arn:aws:bedrock:us-east-1:123456789012:inference-profile/us.test-model-v1:0';
    const mockFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedRequest = new Request(input, init);
      return Response.json({
        output: {
          message: {
            role: 'assistant',
            content: [{ text: 'Bedrock is ready.' }],
          },
        },
        stopReason: 'end_turn',
        usage: { inputTokens: 4, outputTokens: 5, totalTokens: 9 },
      }, {
        headers: { 'x-amzn-requestid': 'zero-bedrock-test' },
      });
    }) as typeof fetch;
    const config = resolveAIConfig({
      autoDetect: false,
      providers: {
        bedrock: {
          type: 'amazon-bedrock',
          fetch: mockFetch,
          headers: { 'x-zero-provider-test': 'forwarded' },
          settings: {
            region: 'us-east-1',
            accessKeyId: 'AKIAZEROFAKE00000000',
            secretAccessKey: 'zero-test-secret-never-send',
          },
        },
      },
      aliases: { smart: `bedrock/${modelId}` },
    }, {});

    expect(config).not.toBe(false);
    if (config === false) return;

    const result = await new AIService(config, NOOP_OBSERVABILITY)
      .generateText({ prompt: 'Confirm readiness.' });
    expect(result.text).toBe('Bedrock is ready.');
    expect(capturedRequest).not.toBeNull();

    const request = capturedRequest as unknown as Request;
    expect(request.method).toBe('POST');
    expect(request.url).toContain(encodeURIComponent(modelId));
    expect(request.url).toEndWith('/converse');
    expect(request.headers.get('authorization')).toStartWith(
      'AWS4-HMAC-SHA256 Credential=AKIAZEROFAKE00000000/'
    );
    expect(request.headers.get('x-amz-date')).toMatch(/^\d{8}T\d{6}Z$/);
    expect(request.headers.get('x-zero-provider-test')).toBe('forwarded');

    const body = await request.json() as { messages?: unknown[] };
    expect(body.messages).toHaveLength(1);
  });

  test('preserves completed tool history when no current tools are active', async () => {
    let capturedRequest: Request | null = null;
    const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedRequest = new Request(input, init);
      return textResponse('The result was received.');
    }) as typeof globalThis.fetch;
    const messages = historicalToolMessages();
    const originalTranscript = JSON.stringify(messages);

    await new AIService(bedrockTestConfig(fetch), NOOP_OBSERVABILITY).generateConversation({
      messages,
    });

    const request = capturedRequest as unknown as Request;
    const body = await request.text();
    expect(body).toContain('zero-history-value');
    expect(body).toContain('lookup_status');
    expect(body).toContain('[Zero historical tool call; inactive for this request]');
    expect(body).toContain('[Zero historical tool result; inactive for this request]');
    expect(body).not.toContain('"toolUse"');
    expect(body).not.toContain('"toolResult"');
    expect(body).not.toContain('"toolConfig"');
    expect(JSON.stringify(messages)).toBe(originalTranscript);
  });

  test('preserves inactive history in a stream without enabling tools', async () => {
    let capturedRequest: Request | null = null;
    const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedRequest = new Request(input, init);
      throw new Error('zero-bedrock-stream-request-boundary');
    }) as unknown as typeof globalThis.fetch;
    const tools = statusTool();
    const result = new AIService(bedrockTestConfig(fetch), NOOP_OBSERVABILITY)
      .streamConversation({
        messages: historicalToolMessages(),
        tools,
        toolChoice: 'none',
        maxRetries: 0,
      });

    await expect(result.text).rejects.toBeDefined();
    const body = await (capturedRequest as unknown as Request).text();
    expect(body).toContain('zero-history-value');
    expect(body).toContain('lookup_status');
    expect(body).toContain('[Zero historical tool result; inactive for this request]');
    expect(body).not.toContain('"toolConfig"');
    expect(body).not.toContain('"toolUse"');
  });

  test('keeps native history when a tool is currently active', async () => {
    let capturedRequest: Request | null = null;
    const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedRequest = new Request(input, init);
      return textResponse('The tool remains active.');
    }) as typeof globalThis.fetch;

    await new AIService(bedrockTestConfig(fetch), NOOP_OBSERVABILITY).generateConversation({
      messages: historicalToolMessages(),
      tools: statusTool(),
      toolChoice: 'auto',
    });

    const body = await (capturedRequest as unknown as Request).text();
    expect(body).toContain('"toolConfig"');
    expect(body).toContain('"toolUse"');
    expect(body).toContain('"toolResult"');
    expect(body).not.toContain('[Zero historical tool call; inactive for this request]');
  });

  test('projects prior-step tool history when prepareStep disables later tools', async () => {
    const requests: Request[] = [];
    let toolExecutions = 0;
    const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(new Request(input, init));
      if (requests.length === 1) {
        return Response.json({
          output: {
            message: {
              role: 'assistant',
              content: [{
                toolUse: {
                  toolUseId: 'call_dynamic_1',
                  name: 'lookup_status',
                  input: { patientId: 'patient_1' },
                },
              }],
            },
          },
          stopReason: 'tool_use',
          usage: { inputTokens: 6, outputTokens: 3, totalTokens: 9 },
        });
      }
      return textResponse('The dynamic result was received.');
    }) as typeof globalThis.fetch;
    const tools = statusTool(() => {
      toolExecutions += 1;
      return { status: 'zero-dynamic-result' };
    });

    const result = await new AIService(bedrockTestConfig(fetch), NOOP_OBSERVABILITY)
      .generateConversation({
        messages: [{ role: 'user', content: 'Look up and summarize the patient status.' }],
        tools,
        stopWhen: stepCountIs(2),
        prepareStep: ({ stepNumber }) => stepNumber === 1 ? { activeTools: [] } : undefined,
      });

    expect(result.text).toBe('The dynamic result was received.');
    expect(toolExecutions).toBe(1);
    expect(requests).toHaveLength(2);
    const firstBody = await requests[0].text();
    const secondBody = await requests[1].text();
    expect(firstBody).toContain('"toolConfig"');
    expect(secondBody).toContain('zero-dynamic-result');
    expect(secondBody).toContain('[Zero historical tool call; inactive for this request]');
    expect(secondBody).toContain('[Zero historical tool result; inactive for this request]');
    expect(secondBody).not.toContain('"toolConfig"');
    expect(secondBody).not.toContain('"toolUse"');
  });
});
