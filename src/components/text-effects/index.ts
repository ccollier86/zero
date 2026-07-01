/**
 * index.ts
 *
 * Public Zero export for reusable public text-effect components. This file owns
 * stable import boundaries only; each component owns its own animation logic.
 */

export { TextGenerateEffect } from './text-generate-effect';
export type { TextGenerateEffectProps } from './text-generate-effect';

export { TypewriterEffect } from './typewriter-effect';
export type { TypewriterEffectProps, TypewriterWord } from './typewriter-effect';

export { FlipWords } from './flip-words';
export type { FlipWordsProps } from './flip-words';
