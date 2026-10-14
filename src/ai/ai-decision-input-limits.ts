/** Local, provider-owned Laya admission. No inference or token-counting HTTP calls. */
import { AIError } from './ai-errors';
import type { AIDecisionDescription, AIDecisionQuestions } from './ai-decision-types';
import { isRecord } from './ai-decision-validation';

export interface AILayaInputLimits {
  /** Complete prompt per question, including state, options and framing. Default 512. */
  readonly maxInputTokens?: number;
  /** Checkpoint question/options budget, independent of the context size. Default 192. */
  readonly maxQuestionTokens?: number;
  /** Match the deployed mask escaping. Default llama.cpp; both serializers preserve object order. */
  readonly runtime?: 'llama.cpp' | 'laya';
  /** Synchronous local counter for this checkpoint, without added special tokens or truncation. */
  readonly countTokens?: (text: string) => number;
}

export interface PreparedLayaInput {
  readonly state: AIDecisionDescription;
  readonly questions: AIDecisionQuestions;
  readonly inputTokenLimit?: number;
  readonly questionTokenLimit?: number;
}

/** Snapshot operator settings; callers cannot raise the admission ceiling per request. */
export function createLayaInputAdmission(value: AILayaInputLimits | false | undefined) {
  if (value === false) return undefined;
  const values: Record<string, unknown> = Object.create(null);
  if (value !== undefined) {
    if (!isRecord(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw invalidLimits();
    for (const key of Reflect.ownKeys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (typeof key !== 'string' || !['maxInputTokens', 'maxQuestionTokens', 'runtime', 'countTokens'].includes(key)
        || !descriptor?.enumerable || !('value' in descriptor)) throw invalidLimits();
      values[key] = descriptor.value;
    }
  }
  const maxInput = limit(values.maxInputTokens ?? 512);
  const maxQuestion = limit(values.maxQuestionTokens ?? 192);
  const runtime = values.runtime ?? 'llama.cpp';
  if (!['llama.cpp', 'laya'].includes(runtime as string)
    || values.countTokens !== undefined && typeof values.countTokens !== 'function') throw invalidLimits();
  const localCounter = values.countTokens as AILayaInputLimits['countTokens'];
  const count = (text: string): number => {
    let tokens: unknown;
    try {
      // Byte-level BPE cannot have more tokens than UTF-8 bytes. Without a local
      // tokenizer this deliberately conservative upper bound may reject valid input.
      tokens = localCounter ? localCounter(text) : Math.max(
        new TextEncoder().encode(text).length, new TextEncoder().encode(text.normalize('NFC')).length);
    } catch { throw invalidLimits(); }
    if (typeof tokens !== 'number' || !Number.isSafeInteger(tokens) || tokens < 0
      || text.length > 0 && tokens === 0) throw invalidLimits();
    return tokens;
  };
  const reason = localCounter ? 'token count' : 'safe token upper bound';
  return (input: PreparedLayaInput): void => {
    const contextLimit = Math.min(maxInput, input.inputTokenLimit ?? maxInput);
    const headLimit = Math.min(maxQuestion, input.questionTokenLimit ?? maxQuestion);
    const render = (value: unknown) => serializeLayaValue(value, runtime === 'laya');
    const stateTokens = count(render(input.state));
    if (stateTokens + 4 > contextLimit) throw exceeded('prompt', contextLimit, reason);
    for (const question of Object.values(input.questions)) {
      const instructionTokens = count(`${question.type} question: ${render(question.instructions)}`);
      const options = question.type === 'choice'
        ? Object.entries(question.criteria).map(([label, description]) => description === null ? render(label) : `${render(label)}: ${render(description)}`)
        : question.type === 'score'
          ? question.criteria.map((description, index) => `level ${index}: ${render(description)}`)
          : ['false', 'true'].map(label => `${label}: ${question.criteria?.[label as 'false' | 'true'] === undefined
            ? label === 'false' ? 'no, the statement does not hold' : 'yes, the statement holds'
            : render(question.criteria![label as 'false' | 'true'])}`);
      const optionTokens = options.map(option => count(` ${option}`));
      // Both English runtimes cap each option at 48 text tokens, then share the
      // head budget. Reject any input that would be clipped rather than trimming it.
      if (optionTokens.some(tokens => tokens > 48)) throw exceeded('option', 48, reason);
      const optionsWithMarkers = optionTokens.reduce((sum, tokens) => sum + tokens + 1, 0);
      if (instructionTokens + optionsWithMarkers > headLimit) throw exceeded('question/options', headLimit, reason);
      if (optionsWithMarkers + 16 > headLimit) {
        const perOption = Math.max(4, Math.floor((headLimit - 16) / options.length));
        if (optionTokens.some(tokens => tokens + 1 > perOption)) throw exceeded('question/options', headLimit, reason);
      }
      const instructionLimit = Math.max(8, headLimit - optionsWithMarkers);
      if (instructionTokens > instructionLimit) throw exceeded('question/options', headLimit, reason);
      // One CLS, three SEP tokens, and one MASK for each option. Questions are
      // independently evaluated: do not compare their aggregate usage with context.
      if (stateTokens + instructionTokens + optionsWithMarkers + 4 > contextLimit) {
        throw exceeded('prompt', contextLimit, reason);
      }
    }
  };
}

/** Laya's text/JSON representation: strings are unquoted; containers use spaced separators. */
function serializeLayaValue(value: unknown, maskKeys: boolean): string {
  if (typeof value === 'string') return value.replaceAll('[MASK]', ' ');
  const json = (item: unknown): string => {
    if (typeof item === 'string') return JSON.stringify(item.replaceAll('[MASK]', ' '));
    if (Array.isArray(item)) return `[${item.map(json).join(', ')}]`;
    if (isRecord(item)) {
      const keys = Object.keys(item);
      return `{${keys.map(key => `${JSON.stringify(key)}: ${json(item[key])}`).join(', ')}}`;
    }
    return JSON.stringify(item);
  };
  const text = json(value);
  return maskKeys ? text.replaceAll('[MASK]', ' ') : text;
}

function limit(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > 8192) throw invalidLimits();
  return value;
}
function invalidLimits(): AIError {
  return new AIError('AI Laya input limits or local tokenizer are invalid.', 'AI_PROVIDER_CONFIG_INVALID', 500);
}
function exceeded(section: string, maximum: number, reason: string): AIError {
  return new AIError(`AI Laya ${section} exceeds its configured ${maximum}-token budget (${reason}).`, 'AI_REQUEST_LIMIT_EXCEEDED', 413);
}
