/** Public native System One contracts. No provider SDK is required. */
export type AIDecisionJSON = null | boolean | number | string
  | readonly AIDecisionJSON[] | { readonly [key: string]: AIDecisionJSON };
export type AIDecisionDescription = string | readonly AIDecisionJSON[]
  | { readonly [key: string]: AIDecisionJSON };

export interface AIDecisionChoiceQuestion<Options extends string = string> {
  readonly type: 'choice';
  readonly instructions: AIDecisionDescription;
  readonly criteria: Readonly<Record<Options, AIDecisionDescription | null>>;
}
export interface AIDecisionScoreQuestion {
  readonly type: 'score';
  readonly instructions: AIDecisionDescription;
  readonly criteria: readonly AIDecisionDescription[];
}
export interface AIDecisionYesNoQuestion {
  readonly type: 'noul';
  readonly instructions: AIDecisionDescription;
  readonly criteria?: Readonly<{ true?: AIDecisionDescription; false?: AIDecisionDescription }>;
}
export type AIDecisionQuestion = AIDecisionChoiceQuestion | AIDecisionScoreQuestion | AIDecisionYesNoQuestion;
export type AIDecisionQuestions = Readonly<Record<string, AIDecisionQuestion>>;

export interface AIDecisionAnswerSignals {
  /** Null means this provider did not report the signal. */
  readonly abstained: boolean | null;
  readonly abstention: 'passed' | 'abstained' | 'unevaluated' | null;
  readonly abstentionThreshold: number | null;
  readonly jevConfidence: number | null;
  readonly answerConfidence: number | null;
}
export interface AIDecisionChoiceAnswer<Options extends string = string> {
  readonly type: 'choice';
  readonly choice: Options;
  readonly probabilities: Readonly<Record<Options, number>>;
  /** Provider-reported distribution statistic, not a verified probability of correctness. */
  readonly confidence: number;
  readonly signals: AIDecisionAnswerSignals;
}
export interface AIDecisionScoreAnswer {
  readonly type: 'score';
  /** Probability-weighted level index; may be fractional. */
  readonly score: number;
  readonly probabilities: Readonly<Record<string, number>>;
  readonly legend: Readonly<Record<string, string>>;
  readonly confidence: number;
  readonly signals: AIDecisionAnswerSignals;
}
export interface AIDecisionYesNoAnswer {
  readonly type: 'noul';
  /** Probability of yes. Zero does not turn this into a boolean or invent confidence. */
  readonly noul: number;
  readonly signals: AIDecisionAnswerSignals;
}
export type AIDecisionAnswer<Question extends AIDecisionQuestion = AIDecisionQuestion> =
  Question extends AIDecisionChoiceQuestion<infer Options> ? AIDecisionChoiceAnswer<Options>
    : Question extends AIDecisionScoreQuestion ? AIDecisionScoreAnswer : AIDecisionYesNoAnswer;
export type AIDecisionAnswers<Questions extends AIDecisionQuestions> = {
  readonly [Key in keyof Questions]: AIDecisionAnswer<Questions[Key]>;
};

export interface AIDecisionRequest<Questions extends AIDecisionQuestions = AIDecisionQuestions> {
  readonly state: AIDecisionDescription;
  readonly questions: Questions;
  /** Alias or provider/model. Defaults to the explicitly configured `decisions` alias. */
  readonly model?: string;
  /** Optional application-owned versioned contract identity, never provider input. */
  readonly contract?: string;
  /** Local-only requires an explicitly designated local Laya provider; no hosted fallback. */
  readonly locality?: 'any' | 'local-only';
  /** One deadline covering fetch, response reading, and all retry waits. Default 10 seconds. */
  readonly timeoutMs?: number;
  /** Retries for 429/529/5xx only. Default 0; maximum 3. Retries can incur additional billing. */
  readonly maxRetries?: number;
  readonly abortSignal?: AbortSignal;
  /** Correlation metadata for Zero observability, not content sent to the model. */
  readonly metadata?: Record<string, unknown>;
  /** Bounded native Laya controls; rejected for Jev instead of silently ignored. */
  readonly laya?: Readonly<{
    maxInputTokens?: number;
    maxQuestionTokens?: number;
    minConfidence?: number;
    language?: string;
    languageHint?: string;
    task?: string;
  }>;
}

export interface AIDecisionResult<Questions extends AIDecisionQuestions = AIDecisionQuestions> {
  readonly answers: AIDecisionAnswers<Questions>;
  /** Actual model/checkpoint reported by the provider, not the alias. */
  readonly model: string;
  /** Null when a compatible server does not report usage; no estimated counts. */
  readonly usage: Readonly<{ inputTokens: number; outputTokens: number; totalTokens: number }> | null;
  readonly provenance: Readonly<{
    providerId: string;
    providerType: 'jev' | 'laya';
    requestedModel: string;
    resolvedModel: string;
    locality: 'local' | 'hosted';
    contract?: string;
    durationMs: number;
  }>;
  /** Provider-declared truncation only. Null means the server did not report it, not that no truncation happened. */
  readonly truncated: boolean | null;
  readonly inputCoverage: Readonly<{
    stateTokens: number | null;
    stateTokensDropped: number | null;
    truncatedQuestions: readonly (keyof Questions & string)[] | null;
  }>;
}

/** Optional question builders preserve inferred choice labels without `as const`. */
export const AIDecision = Object.freeze({
  choice<const Options extends string>(instructions: AIDecisionDescription,
    criteria: Readonly<Record<Options, AIDecisionDescription | null>>): AIDecisionChoiceQuestion<Options> {
    return { type: 'choice', instructions, criteria };
  },
  score(instructions: AIDecisionDescription, criteria: readonly AIDecisionDescription[]): AIDecisionScoreQuestion {
    return { type: 'score', instructions, criteria };
  },
  yesNo(instructions: AIDecisionDescription, criteria?: AIDecisionYesNoQuestion['criteria']): AIDecisionYesNoQuestion {
    return { type: 'noul', instructions, ...(criteria === undefined ? {} : { criteria }) };
  },
});
