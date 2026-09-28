'use client';

/**
 * typewriter-effect.tsx
 *
 * Renders segmented text with a typewriter reveal and cursor. This file owns
 * typing state and timing only; callers own copy, looping policy, and layout.
 */

import * as React from 'react';

import { cn } from '#zero/lib/utils';

export interface TypewriterWord {
  text: string;
  className?: string;
}

export interface TypewriterEffectProps extends React.ComponentProps<'span'> {
  words: readonly TypewriterWord[];
  cursorClassName?: string;
  typingSpeed?: number;
  startDelay?: number;
  loop?: boolean;
  loopDelay?: number;
}

interface TypewriterSegment extends TypewriterWord {
  start: number;
  end: number;
}

/** Render a segmented typewriter text effect with a blinking cursor. */
export function TypewriterEffect({
  words,
  cursorClassName,
  typingSpeed = 42,
  startDelay = 240,
  loop = false,
  loopDelay = 1400,
  className,
  ...props
}: TypewriterEffectProps) {
  const segments = React.useMemo(() => buildSegments(words), [words]);
  const wordsSignature = React.useMemo(
    () => words.map((word) => `${word.text}:${word.className ?? ''}`).join('|'),
    [words],
  );
  const totalLength = segments.at(-1)?.end ?? 0;
  const [visibleCount, setVisibleCount] = React.useState(0);

  React.useEffect(() => {
    setVisibleCount(0);
  }, [totalLength, wordsSignature]);

  React.useEffect(() => {
    if (totalLength <= 0) return;

    const done = visibleCount >= totalLength;
    if (done && !loop) return;

    const timeout = window.setTimeout(
      () => {
        setVisibleCount((current) => {
          if (current >= totalLength) return 0;
          return current + 1;
        });
      },
      visibleCount === 0 ? startDelay : done ? loopDelay : typingSpeed,
    );

    return () => window.clearTimeout(timeout);
  }, [loop, loopDelay, startDelay, totalLength, typingSpeed, visibleCount]);

  return (
    <span className={cn('inline-flex items-baseline', className)} {...props}>
      <span className="inline">
        {segments.map((segment, index) => (
          <React.Fragment key={`${segment.text}-${segment.start}`}>
            <span className={segment.className}>
              {getVisibleSegmentText(segment, visibleCount)}
            </span>
            {index < segments.length - 1 && visibleCount > segment.end ? ' ' : null}
          </React.Fragment>
        ))}
      </span>
      <span
        aria-hidden="true"
        className={cn(
          'ml-1 inline-block h-[0.9em] w-[0.08em] translate-y-[0.08em] animate-pulse rounded-full bg-current',
          cursorClassName,
        )}
      />
    </span>
  );
}

function buildSegments(words: readonly TypewriterWord[]): TypewriterSegment[] {
  let cursor = 0;

  return words.map((word) => {
    const start = cursor;
    const end = start + word.text.length;
    cursor = end + 1;
    return { ...word, start, end };
  });
}

function getVisibleSegmentText(segment: TypewriterSegment, visibleCount: number): string {
  if (visibleCount <= segment.start) return '';
  const count = Math.min(segment.text.length, visibleCount - segment.start);
  return segment.text.slice(0, count);
}
