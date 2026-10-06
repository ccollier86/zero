/** Live transformer identity, portable configuration identity and detached render snapshots. */
import type { ShikiTransformer } from 'shiki';
import type { CodeBlockHighlightOptions, CodeBlockHighlightResult } from './code-block.types';

const hooks = ['preprocess', 'tokens', 'root', 'pre', 'code', 'line', 'span', 'postprocess'] as const;
const functions = new WeakMap<Function, number>();
const results = new WeakMap<CodeBlockHighlightResult, string>();
let nextFunction = 0;

/** Capture executable hooks, arrays and themes before highlighting can yield. */
export function snapshotCodeBlockHighlightOptions(options: CodeBlockHighlightOptions): CodeBlockHighlightOptions {
  validateIdentity(options.transformerIdentity);
  return Object.freeze({ ...options,
    ...(options.theme ? { theme: Object.freeze({ ...options.theme }) } : {}),
    ...(options.highlightLines ? { highlightLines: Object.freeze([...options.highlightLines]) } : {}),
    ...(options.highlightWords ? { highlightWords: Object.freeze([...options.highlightWords]) } : {}),
    ...(options.transformers ? { transformers: Object.freeze(options.transformers.map(transformer => {
      const captured = { ...transformer, name: transformer.name, enforce: transformer.enforce };
      // Inherited Shiki hooks remain supported, but their current function is
      // captured once rather than reread after asynchronous language loading.
      for (const hook of hooks) Object.defineProperty(captured, hook, {
        value: transformer[hook], enumerable: true, writable: false, configurable: false,
      });
      return Object.freeze(captured);
    })) } : {}),
  });
}

/** Stable portable identities are explicit; function names alone never identify custom behavior. */
export function codeBlockTransformerKey(options: CodeBlockHighlightOptions): unknown {
  validateIdentity(options.transformerIdentity);
  if (options.transformerIdentity !== undefined) return ['configured', options.transformerIdentity];
  return options.transformers?.length ? ['live', liveIdentity(options)] : [];
}

/** Bind framework results to the exact live hooks, separately from their serializable key. */
export function bindCodeBlockHighlightResult(result: CodeBlockHighlightResult,
  options: CodeBlockHighlightOptions): CodeBlockHighlightResult {
  const bound = Object.freeze({ ...result,
    ...(options.transformerIdentity === undefined ? {} : { transformerIdentity: options.transformerIdentity }),
  });
  results.set(bound, liveIdentity(options));
  return bound;
}

/** Detached custom HTML needs an explicit configuration identity; live results also fence hook changes. */
export function codeBlockHighlightBindingMatches(result: CodeBlockHighlightResult,
  options: CodeBlockHighlightOptions): boolean {
  const bound = results.get(result);
  // A publisher may intentionally omit executable hooks from the consuming
  // browser. Its explicit identity still authorizes that portable configuration.
  if (!options.transformers?.length && result.transformerIdentity !== undefined
    && result.transformerIdentity === options.transformerIdentity) return true;
  if (bound !== undefined) return bound === liveIdentity(options);
  if (!options.transformers?.length) return true;
  return options.transformerIdentity !== undefined && options.transformerIdentity === result.transformerIdentity;
}

/** Distinguish client highlight generations even when a portable configuration key is unchanged. */
export function codeBlockHighlightLiveIdentity(options: CodeBlockHighlightOptions): string {
  return liveIdentity(options);
}

function liveIdentity(options: CodeBlockHighlightOptions): string {
  return JSON.stringify((options.transformers ?? []).map(transformer => [
    transformer.name ?? '', transformer.enforce ?? null,
    ...hooks.map(hook => {
      const fn = transformer[hook];
      if (typeof fn !== 'function') return null;
      let id = functions.get(fn);
      if (id === undefined) { id = ++nextFunction; functions.set(fn, id); }
      return id;
    }),
  ]));
}

function validateIdentity(value: unknown): void {
  if (value !== undefined && (typeof value !== 'string' || !value.trim() || value.length > 256)) {
    throw new TypeError('CodeBlock transformerIdentity must be a nonempty string of at most 256 characters.');
  }
}
