/** Validate the complete decision result against the exact supplied question set. */
import { AIError } from './ai-errors';
import type { AIDecisionAnswer, AIDecisionQuestions } from './ai-decision-types';
import { isRecord } from './ai-decision-validation';

const TOLERANCE = 0.001;

export function parseDecisionResponse(raw: unknown, questions: AIDecisionQuestions) {
  if (!isRecord(raw) || typeof raw.model !== 'string' || !raw.model.trim() || raw.model.length > 512
    || !isRecord(raw.answers) || !sameKeys(raw.answers, Object.keys(questions))) throw invalidDecisionResponse();
  const answers: Record<string, AIDecisionAnswer> = Object.create(null);
  for (const [id, question] of Object.entries(questions)) {
    const answer = raw.answers[id];
    if (!isRecord(answer) || answer.type !== question.type) throw invalidDecisionResponse();
    const signals = parseSignals(answer);
    if (question.type === 'noul') {
      answers[id] = Object.freeze({ type: 'noul', noul: probability(answer.noul), signals });
      continue;
    }
    const keys = question.type === 'choice' ? Object.keys(question.criteria) : question.criteria.map((_, index) => String(index));
    if (!isRecord(answer.probabilities) || !sameKeys(answer.probabilities, keys)) throw invalidDecisionResponse();
    const probabilities: Record<string, number> = Object.create(null);
    let total = 0;
    for (const key of keys) { probabilities[key] = probability(answer.probabilities[key]); total += probabilities[key]; }
    if (Math.abs(total - 1) > TOLERANCE) throw invalidDecisionResponse();
    Object.freeze(probabilities);
    const confidence = probability(answer.confidence);
    if (question.type === 'choice') {
      if (typeof answer.choice !== 'string' || !Object.hasOwn(probabilities, answer.choice)
        || probabilities[answer.choice] + TOLERANCE < Math.max(...Object.values(probabilities))) throw invalidDecisionResponse();
      answers[id] = Object.freeze({ type: 'choice', choice: answer.choice, probabilities, confidence, signals });
    } else {
      const expected = keys.reduce((value, key) => value + Number(key) * probabilities[key], 0);
      if (typeof answer.score !== 'number' || !Number.isFinite(answer.score) || answer.score < 0
        || answer.score > keys.length - 1 || Math.abs(answer.score - expected) > TOLERANCE
        || !isRecord(answer.legend) || !sameKeys(answer.legend, keys)) throw invalidDecisionResponse();
      const legend: Record<string, string> = Object.create(null);
      for (const key of keys) {
        const label = answer.legend[key];
        if (typeof label !== 'string' || label.length > 65_536) throw invalidDecisionResponse();
        legend[key] = label;
      }
      answers[id] = Object.freeze({ type: 'score', score: answer.score, probabilities, legend: Object.freeze(legend), confidence, signals });
    }
  }
  let usage: { inputTokens: number; outputTokens: number; totalTokens: number } | null = null;
  if (raw.usage !== undefined && raw.usage !== null) {
    if (!isRecord(raw.usage)) throw invalidDecisionResponse();
    const inputTokens = tokenCount(raw.usage.input_tokens), outputTokens = tokenCount(raw.usage.output_tokens);
    if (!Number.isSafeInteger(inputTokens + outputTokens)) throw invalidDecisionResponse();
    usage = Object.freeze({ inputTokens, outputTokens, totalTokens: inputTokens + outputTokens });
  }
  const coverage = isRecord(raw.usage) ? raw.usage : {};
  for (const flag of [raw.truncated, coverage.truncated]) {
    if (flag !== undefined && typeof flag !== 'boolean') throw invalidDecisionResponse();
  }
  if (raw.truncated !== undefined && coverage.truncated !== undefined && raw.truncated !== coverage.truncated) throw invalidDecisionResponse();
  let truncatedQuestions: readonly string[] | null = null;
  if (coverage.truncated_questions !== undefined) {
    if (!Array.isArray(coverage.truncated_questions) || coverage.truncated_questions.length > Object.keys(questions).length
      || coverage.truncated_questions.some(id => typeof id !== 'string' || !Object.hasOwn(questions, id))
      || new Set(coverage.truncated_questions).size !== coverage.truncated_questions.length) throw invalidDecisionResponse();
    truncatedQuestions = Object.freeze([...coverage.truncated_questions]) as readonly string[];
  }
  const stateTokens = coverage.state_tokens === undefined ? null : tokenCount(coverage.state_tokens);
  const stateTokensDropped = coverage.state_tokens_dropped === undefined ? null : tokenCount(coverage.state_tokens_dropped);
  if (stateTokens !== null && stateTokensDropped !== null && stateTokensDropped > stateTokens) throw invalidDecisionResponse();
  const truncated = (raw.truncated ?? coverage.truncated ?? null) as boolean | null;
  if (truncated === false && (stateTokensDropped !== null && stateTokensDropped > 0 || truncatedQuestions?.length)) throw invalidDecisionResponse();
  return { model: raw.model, answers: Object.freeze(answers), usage, truncated,
    inputCoverage: Object.freeze({ stateTokens, stateTokensDropped, truncatedQuestions }) };
}

function parseSignals(answer: Record<string, unknown>) {
  const gate = answer.abstention;
  if (gate !== undefined && typeof gate !== 'boolean' && !['passed', 'abstained', 'unevaluated'].includes(gate as string)) throw invalidDecisionResponse();
  const abstention = gate === true ? 'abstained' : gate === false ? 'passed' : gate as 'passed' | 'abstained' | 'unevaluated' | undefined ?? null;
  return Object.freeze({
    abstained: abstention === 'abstained' ? true : abstention === 'passed' ? false : null,
    abstention,
    abstentionThreshold: answer.abstention_threshold === undefined ? null : probability(answer.abstention_threshold),
    jevConfidence: answer.x_jev_confidence === undefined ? null : probability(answer.x_jev_confidence),
    answerConfidence: answer.answer_confidence === undefined ? null : probability(answer.answer_confidence),
  });
}

function probability(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) throw invalidDecisionResponse();
  return value;
}
function tokenCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw invalidDecisionResponse();
  return value;
}
function sameKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
export function invalidDecisionResponse(): AIError {
  return new AIError('AI decision provider returned an invalid response.', 'AI_PROVIDER_RESPONSE_INVALID', 502);
}
