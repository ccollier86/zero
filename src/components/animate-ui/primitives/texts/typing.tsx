'use client';

/**
 * Shared text-animation primitive. Owns the original typing sequence and an
 * opt-in, bounded replacement presentation; callers own accepted text and layout.
 */

import * as React from 'react';
import { motion, type HTMLMotionProps } from 'motion/react';

import {
  useIsInView,
  type UseIsInViewOptions,
} from '#zero/hooks/use-is-in-view';
import { getStrictContext } from '#zero/lib/get-strict-context';
import { useTypingTextReplacement } from './use-typing-text-replacement';

type TypingTextContextType = {
  isTyping: boolean;
  setIsTyping: (isTyping: boolean) => void;
};

const [TypingTextProvider, useTypingText] =
  getStrictContext<TypingTextContextType>('TypingTextContext');

type TypingTextSequenceProps = React.ComponentProps<'span'> & {
  mode?: 'type';
  duration?: number;
  delay?: number;
  loop?: boolean;
  holdDelay?: number;
  text: string | string[];
} & UseIsInViewOptions;

type TypingTextReplacementProps = React.ComponentProps<'span'> & {
  mode: 'replace';
  text: string;
  /** Per-grapheme cadence, bounded by maxDuration for long replacements. */
  duration?: number;
  /** Maximum erase-plus-type duration in milliseconds; initial mount is always final. */
  maxDuration?: number;
  /** Disabling replacement motion immediately exposes the latest canonical text. */
  enabled?: boolean;
};

/** Original sequences remain the default; replacement children are the canonical final presentation. */
type TypingTextProps = TypingTextSequenceProps | TypingTextReplacementProps;

/** Render original typing sequences or animate only subsequent accepted string replacements. */
function TypingText(props: TypingTextProps) {
  return props.mode === 'replace'
    ? <TypingTextReplacement {...props} />
    : <TypingTextSequence {...props} />;
}

function TypingTextReplacement({
  mode: _mode,
  text,
  duration = 24,
  maxDuration = 525,
  enabled = true,
  children,
  style,
  ...props
}: TypingTextReplacementProps) {
  const { displayedText, isTyping } = useTypingTextReplacement({ text, duration, maxDuration, enabled });

  return (
    <span data-slot="typing-text" data-typing={isTyping ? '' : undefined}
      style={{ position: 'relative', display: 'inline-block', maxWidth: '100%', verticalAlign: 'baseline', ...style }} {...props}>
      {/* Opacity preserves final layout, the accessibility tree, and canonical copy while glyphs change. */}
      <span data-slot="typing-text-value" style={{ opacity: isTyping ? 0 : undefined }}>{children ?? text}</span>
      {isTyping && <span data-slot="typing-text-visual" aria-hidden="true"
        style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none', userSelect: 'none', whiteSpace: 'inherit' }}>
        {displayedText}
      </span>}
    </span>
  );
}

function TypingTextSequence({
  mode: _mode,
  ref,
  children,
  duration = 100,
  delay = 0,
  inView = false,
  inViewMargin = '0px',
  inViewOnce = true,
  loop = false,
  holdDelay = 1000,
  text,
  ...props
}: TypingTextSequenceProps) {
  const { ref: localRef, isInView } = useIsInView(
    ref as React.Ref<HTMLElement>,
    {
      inView,
      inViewOnce,
      inViewMargin,
    },
  );

  const [isTyping, setIsTyping] = React.useState(false);
  const [started, setStarted] = React.useState(false);
  const [displayedText, setDisplayedText] = React.useState<string>('');

  React.useEffect(() => {
    if (isInView) {
      const timeoutId = setTimeout(() => {
        setStarted(true);
      }, delay);
      return () => clearTimeout(timeoutId);
    }
  }, [isInView, delay]);

  React.useEffect(() => {
    if (!started) return;

    const timeoutIds: Array<ReturnType<typeof setTimeout>> = [];
    const texts: string[] = typeof text === 'string' ? [text] : text;

    const typeText = (str: string, onComplete: () => void) => {
      setIsTyping(true);
      let currentIndex = 0;
      const type = () => {
        if (currentIndex <= str.length) {
          setDisplayedText(str.substring(0, currentIndex));
          currentIndex++;
          const id = setTimeout(type, duration);
          timeoutIds.push(id);
        } else {
          setIsTyping(false);
          onComplete();
        }
      };
      type();
    };

    const eraseText = (str: string, onComplete: () => void) => {
      setIsTyping(true);
      let currentIndex = str.length;
      const erase = () => {
        if (currentIndex >= 0) {
          setDisplayedText(str.substring(0, currentIndex));
          currentIndex--;
          const id = setTimeout(erase, duration);
          timeoutIds.push(id);
        } else {
          setIsTyping(false);
          onComplete();
        }
      };
      erase();
    };

    const animateTexts = (index: number) => {
      typeText(texts[index] ?? '', () => {
        const isLast = index === texts.length - 1;
        if (isLast && !loop) {
          return;
        }
        const id = setTimeout(() => {
          eraseText(texts[index] ?? '', () => {
            const nextIndex = isLast ? 0 : index + 1;
            animateTexts(nextIndex);
          });
        }, holdDelay);
        timeoutIds.push(id);
      });
    };

    animateTexts(0);

    return () => {
      timeoutIds.forEach(clearTimeout);
    };
  }, [text, duration, started, loop, holdDelay]);

  return (
    <TypingTextProvider value={{ isTyping, setIsTyping }}>
      <span ref={localRef} data-slot="typing-text" {...props}>
        <motion.span>{displayedText}</motion.span>
        {children}
      </span>
    </TypingTextProvider>
  );
}

type TypingTextCursorProps = Omit<HTMLMotionProps<'span'>, 'children'>;

/** Render the original sequence's cursor; replacement mode intentionally has no looping cursor. */
function TypingTextCursor({
  style,
  variants,
  ...props
}: TypingTextCursorProps) {
  const { isTyping } = useTypingText();

  return (
    <motion.span
      data-slot="typing-text-cursor"
      variants={{
        blinking: {
          opacity: [0, 0, 1, 1],
          transition: {
            duration: 1,
            repeat: Infinity,
            repeatDelay: 0,
            ease: 'linear',
            times: [0, 0.5, 0.5, 1],
          },
        },
        visible: {
          opacity: 1,
        },
        ...variants,
      }}
      animate={isTyping ? 'visible' : 'blinking'}
      style={{
        display: 'inline-block',
        height: '16px',
        transform: 'translateY(2px)',
        width: '1px',
        backgroundColor: 'currentColor',
        ...style,
      }}
      {...props}
    />
  );
}

export {
  TypingText,
  TypingTextCursor,
  type TypingTextProps,
  type TypingTextCursorProps,
};
