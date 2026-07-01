'use client';

/**
 * text-generate-effect.tsx
 *
 * Renders a word-by-word generate/reveal text animation for public Hero copy
 * and headings. This file owns only the text reveal animation; callers own
 * wording, layout, and semantic heading structure.
 */

import * as React from 'react';
import { motion } from 'motion/react';

import { cn } from '@/lib/utils';

export interface TextGenerateEffectProps extends React.ComponentProps<'span'> {
  words: string;
  duration?: number;
  delay?: number;
  stagger?: number;
  filter?: boolean;
  wordClassName?: string;
}

/** Render text that fades in word-by-word with an optional blur filter. */
export function TextGenerateEffect({
  words,
  duration = 0.45,
  delay = 0,
  stagger = 0.075,
  filter = true,
  className,
  wordClassName,
  ...props
}: TextGenerateEffectProps) {
  const tokens = React.useMemo(() => words.trim().split(/\s+/).filter(Boolean), [words]);

  return (
    <span className={cn('inline', className)} {...props}>
      {tokens.map((word, index) => (
        <React.Fragment key={`${word}-${index}`}>
          <motion.span
            className={cn('inline-block', wordClassName)}
            initial={{
              opacity: 0,
              y: '0.45em',
              filter: filter ? 'blur(0.35em)' : 'none',
            }}
            animate={{
              opacity: 1,
              y: 0,
              filter: 'blur(0em)',
            }}
            transition={{
              duration,
              delay: delay + index * stagger,
              ease: [0.22, 1, 0.36, 1],
            }}
          >
            {word}
          </motion.span>
          {index < tokens.length - 1 ? ' ' : null}
        </React.Fragment>
      ))}
    </span>
  );
}
