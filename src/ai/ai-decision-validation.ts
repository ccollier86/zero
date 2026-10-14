/** Bounded immutable decision request validation before transport. */
import { AIError } from './ai-errors';
import { snapshotAIJSONValue } from './ai-json-value-snapshot';
import { utf8ByteLength } from './ai-operation-limits';
import type { AIDecisionDescription, AIDecisionQuestions, AIDecisionRequest } from './ai-decision-types';

export const AI_DECISION_MAX_INPUT_BYTES = 1024 * 1024;
export const AI_DECISION_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
export const AI_DECISION_MAX_QUESTIONS = 64;

export function prepareDecisionRequest(request: AIDecisionRequest, model: string, providerType: 'jev' | 'laya') {
  const state = snapshotAIJSONValue(request.state, 'AI decision state', AI_DECISION_MAX_INPUT_BYTES);
  const questions = snapshotAIJSONValue(request.questions, 'AI decision questions', AI_DECISION_MAX_INPUT_BYTES);
  if (!isDescription(state) || !isRecord(questions)) throw invalidDecisionRequest();
  const entries = Object.entries(questions);
  if (entries.length < 1 || entries.length > AI_DECISION_MAX_QUESTIONS) throw invalidDecisionRequest();
  for (const [id, question] of entries) {
    if (!validKey(id) || !isRecord(question) || !isDescription(question.instructions)
      || Object.keys(question).some(key => !['type', 'instructions', 'criteria'].includes(key))) {
      throw invalidDecisionRequest();
    }
    if (question.type === 'choice') {
      if (!isRecord(question.criteria)) throw invalidDecisionRequest();
      const options = Object.entries(question.criteria);
      if (options.length < 2 || options.length > 255
        || options.some(([key, value]) => !validKey(key) || value !== null && !isDescription(value))) {
        throw invalidDecisionRequest();
      }
    } else if (question.type === 'score') {
      if (!Array.isArray(question.criteria) || question.criteria.length < 2 || question.criteria.length > 10
        || question.criteria.some(value => !isDescription(value))) throw invalidDecisionRequest();
    } else if (question.type === 'noul') {
      if (question.criteria !== undefined && (!isRecord(question.criteria)
        || Object.entries(question.criteria).some(([key, value]) => !['true', 'false'].includes(key) || !isDescription(value)))) {
        throw invalidDecisionRequest();
      }
    } else throw invalidDecisionRequest();
  }
  if (request.locality !== undefined && !['any', 'local-only'].includes(request.locality)) throw invalidDecisionRequest();
  if (request.contract !== undefined && (typeof request.contract !== 'string'
    || !request.contract.trim() || request.contract.length > 256 || /[\x00-\x1f]/.test(request.contract))) {
    throw invalidDecisionRequest();
  }
  if (typeof model !== 'string' || !model.trim() || model.length > 512 || /[\x00-\x1f]/.test(model)) throw invalidDecisionRequest();
  if (request.abortSignal !== undefined && !(request.abortSignal instanceof AbortSignal)) throw invalidDecisionRequest();
  const timeoutMs = boundedInteger(request.timeoutMs ?? 10_000, 1, 120_000);
  const maxRetries = boundedInteger(request.maxRetries ?? 0, 0, 3);
  const laya = prepareLayaControls(request.laya, providerType);
  const body = JSON.stringify({ model, state, questions, ...laya });
  if (utf8ByteLength(body, AI_DECISION_MAX_INPUT_BYTES) > AI_DECISION_MAX_INPUT_BYTES) {
    throw new AIError('AI decision request exceeds the byte limit.', 'AI_REQUEST_LIMIT_EXCEEDED', 413);
  }
  return { body, state: state as AIDecisionDescription,
    questions: questions as unknown as AIDecisionQuestions, timeoutMs, maxRetries,
    inputTokenLimit: laya.max_len as number | undefined,
    questionTokenLimit: laya.head_max_len as number | undefined,
    locality: request.locality ?? 'any', contract: request.contract };
}

function prepareLayaControls(controls: AIDecisionRequest['laya'], providerType: 'jev' | 'laya'): Record<string, string | number> {
  if (controls === undefined) return {};
  if (providerType !== 'laya') throw invalidDecisionRequest();
  const values = snapshotAIJSONValue(controls, 'AI Laya controls', 4096);
  if (!isRecord(values)) throw invalidDecisionRequest();
  const output: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(values)) {
    if (key === 'maxInputTokens' || key === 'maxQuestionTokens') {
      output[key === 'maxInputTokens' ? 'max_len' : 'head_max_len'] = boundedInteger(value, 1, 8192);
    } else if (key === 'minConfidence') {
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) throw invalidDecisionRequest();
      output.min_confidence = value;
    } else if (['language', 'languageHint', 'task'].includes(key)) {
      if (typeof value !== 'string' || !value.trim() || value.length > 128 || /[\x00-\x1f]/.test(value)) throw invalidDecisionRequest();
      output[key === 'language' ? 'lang' : key === 'languageHint' ? 'lang_guess' : 'task'] = value;
    } else throw invalidDecisionRequest();
  }
  return output;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function isDescription(value: unknown): boolean {
  return typeof value === 'string' ? Boolean(value.trim()) : isRecord(value) || Array.isArray(value);
}
function validKey(value: string): boolean {
  return value.length > 0 && value.length <= 256 && !/[\x00-\x1f]/.test(value)
    && !['__proto__', 'prototype', 'constructor'].includes(value);
}
function boundedInteger(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) throw invalidDecisionRequest();
  return value;
}
export function invalidDecisionRequest(): AIError {
  return new AIError('AI decision request has invalid questions, evidence, or execution options.', 'AI_REQUEST_INVALID', 400);
}
