import { describe, expect, test } from 'bun:test';
import { AIDecision, AIService, createLayaTokenCounter, resolveAIConfig } from '@zero/framework/ai';
import { createLayaTokenCounter as ServerCounter } from '@zero/framework/server';
import { createLayaInputAdmission } from './ai-decision-input-limits';
import type { AILayaInputLimits } from './ai-decision-input-limits';
import type { AIProviderConfig } from './ai-provider-types';
import { AIError } from './ai-errors';
import { OBS_CODES } from '../observability/codes';

const questions = { check: AIDecision.yesNo('Q') };
const raw = { model: 'laya', answers: { check: { type: 'noul', noul: 0.9 } }, usage: { input_tokens: 10, output_tokens: 0 } };
// Deterministic boundary counter: all prompt pieces use one token; only state x's vary.
const countTokens = (text: string) => /^x+$/.test(text) ? text.length : 1;

function setup(limits: AIProviderConfig['layaInputLimits'] = { maxInputTokens: 2048, countTokens }, type: 'laya' | 'jev' = 'laya') {
  let calls = 0;
  const events: unknown[] = [];
  const config = resolveAIConfig({ autoDetect: false, providers: { decisionsProvider: {
    type, apiKey: type === 'jev' ? 'synthetic-key' : null, baseURL: 'http://127.0.0.1:8000',
    ...(limits === undefined ? {} : { layaInputLimits: limits }),
    fetch: async () => { calls++; return Response.json(raw); },
  } }, aliases: { decisions: 'decisionsProvider/laya' } }, {});
  if (!config) throw new Error('Fixture disabled');
  return { ai: new AIService(config, { emitCode: (code, options) => events.push({ code: code.code, options }) }),
    calls: () => calls, events };
}

async function reject(operation: Promise<unknown>, code: AIError['code'] = 'AI_REQUEST_LIMIT_EXCEEDED') {
  const error: unknown = await operation.then(() => undefined, error => error);
  expect(error).toBeInstanceOf(AIError);
  if (!(error instanceof AIError)) throw new Error('Expected a sanitized AIError');
  expect(error.code).toBe(code);
  return error;
}

describe('Laya local input admission', () => {
  test('accepts exactly 2048 tokens including framing; rejects the next token without HTTP', async () => {
    // Four framing tokens, one instruction token, two options and their two markers = nine.
    const { ai, calls } = setup();
    await ai.decisions.evaluate({ state: 'x'.repeat(2048 - 9), questions });
    expect(calls()).toBe(1);
    const error = await reject(ai.decisions.evaluate({ state: 'x'.repeat(2048 - 8), questions }));
    expect(error.status).toBe(413); expect(error.message).toContain('2048-token');
    expect(calls()).toBe(1);
  });

  test('checks each independent question rather than comparing summed usage with context', () => {
    const admit = createLayaInputAdmission({ maxInputTokens: 2048, countTokens });
    expect(() => admit!({ state: 'x'.repeat(2039), questions: {
      first: AIDecision.yesNo('Q'), second: AIDecision.yesNo('Another question'),
    } })).not.toThrow();
  });

  test('caller token controls may lower the ceiling, never raise the operator ceiling', async () => {
    const { ai, calls } = setup();
    await reject(ai.decisions.evaluate({ state: 'x'.repeat(1000), questions, laya: { maxInputTokens: 512 } }));
    await reject(ai.decisions.evaluate({ state: 'x'.repeat(2040), questions, laya: { maxInputTokens: 8192 } }));
    await reject(ai.decisions.evaluate({ state: 'small', questions, laya: { maxQuestionTokens: 1 } }));
    expect(calls()).toBe(0);
  });

  test('snapshots limits and the tokenizer callback at service startup', async () => {
    const limits = { maxInputTokens: 2048, countTokens };
    const { ai, calls } = setup(limits);
    limits.maxInputTokens = 8192; limits.countTokens = () => 1;
    await reject(ai.decisions.evaluate({ state: 'x'.repeat(2040), questions }));
    expect(calls()).toBe(0);
  });

  test('rejects oversize instructions and options even with a tiny state', async () => {
    const { ai, calls } = setup({ maxInputTokens: 2048, countTokens: text => text.length });
    await reject(ai.decisions.evaluate({ state: 'small', questions: { check: AIDecision.yesNo('long '.repeat(100)) } }));
    await reject(ai.decisions.evaluate({ state: 'small', questions: {
      check: AIDecision.choice('Q', { small: null, large: 'long '.repeat(20) }),
    } }));
    expect(calls()).toBe(0);
  });

  test('detects the runtime even-option shrink before a head total alone would overflow', () => {
    const admit = createLayaInputAdmission({ maxInputTokens: 2048, maxQuestionTokens: 192,
      countTokens: text => text.includes('question:') ? 1 : text === 'small' ? 1 : 48 });
    // Four 49-token option spans trigger the reserve-16 shrink even with a one-token instruction.
    expect(() => admit!({ state: 'small', questions: { check: AIDecision.choice('Q', {
      a: 'A', b: 'B', c: 'C', d: 'D',
    }) } })).toThrow('question/options');
  });

  test('default byte upper bound protects long Unicode input without a tokenizer or any network', async () => {
    const { ai, calls } = setup({ maxInputTokens: 2048 });
    const error = await reject(ai.decisions.evaluate({ state: '😀'.repeat(600), questions }));
    expect(error.message).toContain('safe token upper bound'); expect(calls()).toBe(0);
    await ai.decisions.evaluate({ state: 'Small synthetic input', questions }); expect(calls()).toBe(1);
  });

  test('unknown/invalid settings and accessors are rejected without evaluating getters', () => {
    let getters = 0;
    for (const value of [{ maxInputTokens: 0 }, { maxInputTokens: 8193 }, { maxQuestionTokens: NaN },
      { runtime: 'unknown' }, { countTokens: 'remote' }, { extra: true },
      Object.defineProperty({}, 'maxInputTokens', { enumerable: true, get() { getters++; return 8192; } }),
    ]) expect(() => createLayaInputAdmission(value as AILayaInputLimits)).toThrow(AIError);
    expect(getters).toBe(0);
  });

  test('invalid token counts fail closed and private counter exceptions are sanitized', async () => {
    for (const counter of [() => -1, () => NaN, () => Infinity, () => 1.5, () => 0,
      () => { throw new Error('private-evidence-secret'); }]) {
      const { ai, calls, events } = setup({ maxInputTokens: 2048, countTokens: counter });
      const error = await reject(ai.decisions.evaluate({ state: 'private-evidence-secret', questions }), 'AI_PROVIDER_CONFIG_INVALID');
      expect(calls()).toBe(0); expect(error.message).not.toContain('private-evidence-secret');
      expect(JSON.stringify(events)).not.toContain('private-evidence-secret');
    }
  });

  test('local rejection emits failure telemetry once and does not retry or send state', async () => {
    const { ai, calls, events } = setup();
    await reject(ai.decisions.evaluate({ state: 'x'.repeat(3000), questions, maxRetries: 3 }));
    expect(calls()).toBe(0);
    const codes = (events as { code: string }[]).map(event => event.code);
    expect(codes.filter(code => code === OBS_CODES.AI_REQUEST_STARTED.code)).toHaveLength(1);
    expect(codes.filter(code => code === OBS_CODES.AI_REQUEST_FAILED.code)).toHaveLength(1);
    expect(JSON.stringify(events)).not.toContain('x'.repeat(100));
  });

  test('only trusted startup may delegate truncation to a server that reports it', async () => {
    const { ai, calls } = setup(false);
    await ai.decisions.evaluate({ state: 'x'.repeat(3000), questions }); expect(calls()).toBe(1);
  });

  test('Jev remains unchanged: no Laya guard, and cannot accept Laya-specific limits', async () => {
    const config = resolveAIConfig({ autoDetect: false, providers: { jev: { type: 'jev', apiKey: 'synthetic-key',
      fetch: async () => Response.json(raw),
    } }, aliases: { decisions: 'jev/jev-1.13.0' } }, {});
    if (!config) throw new Error('Fixture disabled');
    const ai = new AIService(config, { emitCode: () => undefined });
    const result = await ai.decisions.evaluate({ state: 'x'.repeat(10_000), questions });
    expect(result.answers.check.noul).toBe(0.9);
    expect(() => setup({ maxInputTokens: 2048, countTokens }, 'jev')).toThrow('require a Laya provider');
  });

  test('serializes structured state and criteria, count-prefixes all answer types and reserves framing', () => {
    const texts: string[] = [];
    const admit = createLayaInputAdmission({ maxInputTokens: 2048, countTokens: text => { texts.push(text); return 1; } });
    admit!({ state: { z: ['é', true], a: '[MASK]' }, questions: {
      choice: AIDecision.choice({ task: 'Route?' }, { none: null, object: { help: 'yes' } }),
      score: AIDecision.score('Score?', [{ title: 'low' }, 'high']),
      bool: AIDecision.yesNo('Boolean?', { true: 'Confirmed' }),
    } });
    expect(texts[0]).toBe('{"z": ["é", true], "a": " "}');
    expect(texts).toContain('choice question: {"task": "Route?"}');
    expect(texts).toContain(' object: {"help": "yes"}');
    expect(texts).toContain(' level 0: {"title": "low"}');
    expect(texts).toContain(' false: no, the statement does not hold');
    expect(texts).toContain(' true: Confirmed');
  });

  test('respects the deployed runtime mask escaping without changing the original state', () => {
    const state = { '[MASK]': '[MASK]' };
    for (const runtime of ['llama.cpp', 'laya'] as const) {
      const texts: string[] = [];
      createLayaInputAdmission({ runtime, countTokens: text => { texts.push(text); return 1; } })!({ state, questions });
      expect(texts[0]).toBe(runtime === 'laya' ? '{" ": " "}' : '{"[MASK]": " "}');
    }
    expect(state).toEqual({ '[MASK]': '[MASK]' });
  });
});

describe('offline checkpoint tokenizer helper', () => {
  const tokenizerJSON = { version: '1.0', truncation: { max_length: 1 }, padding: null,
    added_tokens: [], normalizer: null, pre_tokenizer: null, post_processor: null, decoder: null,
    model: { type: 'BPE', dropout: null, unk_token: '[UNK]', continuing_subword_prefix: null,
      end_of_word_suffix: null, fuse_unk: false, byte_fallback: false,
      vocab: { '[UNK]': 0, a: 1, b: 2, ab: 3 }, merges: ['a b'] },
  };

  test('exports the same helper from AI and server and does not silently clamp the count', () => {
    expect(createLayaTokenCounter).toBe(ServerCounter);
    const counter = createLayaTokenCounter(tokenizerJSON);
    expect(counter('ab')).toBe(1); expect(counter('aaaaaa')).toBe(6);
    expect(counter('')).toBe(0);
  });

  test('detaches tokenizer files from later mutation and sanitizes invalid files', () => {
    const json = structuredClone(tokenizerJSON);
    const counter = createLayaTokenCounter(json);
    json.model.merges.length = 0;
    expect(counter('ab')).toBe(1);
    expect(() => createLayaTokenCounter({ private: 'private-secret' })).toThrow(AIError);
  });
});
