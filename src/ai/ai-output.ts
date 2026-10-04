/**
 * ai-output.ts
 *
 * Exposes Zero's stable structured-output facade over AI SDK output modes.
 * This file owns type inference and output construction only; it does not
 * resolve models, call providers, or validate generated values itself.
 */

import { Output as SDKOutput } from 'ai';
import type {
  InferGenerateOutput,
  InferStreamOutput,
  OutputInterface,
} from 'ai';

/** Any AI SDK 7 output specification accepted by Zero generation calls. */
export type AIOutputSpec<Complete = any, Partial = any, Element = any> =
  OutputInterface<Complete, Partial, Element>;

/** Backward-compatible unconstrained output used when callers omit `output`. */
export type AIAnyOutput = AIOutputSpec<any, any, any>;

/** Default plain-text output specification. */
export type AITextOutput = ReturnType<typeof SDKOutput.text>;

/** Infer the completed value returned by a Zero output specification. */
export type AIInferOutput<Output extends AIOutputSpec> = InferGenerateOutput<Output>;

/** Infer the incremental value emitted by a streaming output specification. */
export type AIInferPartialOutput<Output extends AIOutputSpec> = InferStreamOutput<Output>;

/**
 * Typed output constructors accepted by `AIService.generateText()` and
 * `AIService.streamText()`.
 *
 * The facade is frozen so application code cannot replace constructors for
 * other callers in the same process.
 */
export const AIOutput = Object.freeze({
  text: SDKOutput.text,
  object: SDKOutput.object,
  array: SDKOutput.array,
  choice: SDKOutput.choice,
  json: SDKOutput.json,
});
