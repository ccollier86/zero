'use client';

/**
 * faq.tsx
 *
 * Renders a tokenized public FAQ section with accordion-style disclosure and
 * optional generated answer text. This file owns FAQ interaction and animation
 * only; callers own copy, routing, and support/contact actions.
 */

import * as React from 'react';
import { AnimatePresence, motion } from 'motion/react';

import { AnimateIcon } from '@/components/animate-ui/icons/icon';
import { ZeroIcon } from '@/components/animate-ui/icons/zero-icon';
import { TextGenerateEffect } from '@/components/text-effects';
import { cn } from '@/lib/utils';

import type { FaqItem, FaqProps } from './faq.types';

/** Render a public FAQ section with tokenized surfaces and animated answers. */
export function Faq({
  items,
  title = 'Frequently asked questions',
  description,
  defaultOpenIds = [],
  allowMultiple = false,
  animateAnswers = true,
  className,
  headerClassName,
  listClassName,
  itemClassName,
  questionClassName,
  answerClassName,
  emptyState,
  ...props
}: FaqProps) {
  const hasHeader = Boolean(title || description);
  const [openIds, setOpenIds] = React.useState<Set<string>>(
    () => new Set(defaultOpenIds),
  );

  const toggleItem = React.useCallback(
    (id: string) => {
      setOpenIds((current) => {
        const next = allowMultiple ? new Set(current) : new Set<string>();
        if (current.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
        }
        return next;
      });
    },
    [allowMultiple],
  );

  return (
    <section
      data-zero-surface="public"
      className={cn('zero-public mx-auto w-full max-w-5xl px-4 py-16 sm:px-6 lg:px-8', className)}
      {...props}
    >
      {hasHeader ? (
        <div className={cn('mx-auto max-w-2xl text-center', headerClassName)}>
          {title ? (
            <h2 className="text-balance text-4xl font-semibold leading-tight text-public-foreground sm:text-5xl">
              {title}
            </h2>
          ) : null}
          {description ? (
            <p className="mt-4 text-base leading-7 text-public-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className={cn('mx-auto grid max-w-3xl gap-3', hasHeader && 'mt-10', listClassName)}>
        {items.length === 0 ? (
          <div className="rounded-lg border border-public-border bg-public-surface p-6 text-sm text-public-muted-foreground shadow-[var(--public-shadow-floating)]">
            {emptyState ?? 'No questions have been added yet.'}
          </div>
        ) : (
          items.map((item) => (
            <FaqRow
              key={item.id}
              item={item}
              open={openIds.has(item.id)}
              animateAnswer={animateAnswers}
              itemClassName={itemClassName}
              questionClassName={questionClassName}
              answerClassName={answerClassName}
              onToggle={() => toggleItem(item.id)}
            />
          ))
        )}
      </div>
    </section>
  );
}

interface FaqRowProps {
  item: FaqItem;
  open: boolean;
  animateAnswer: boolean;
  itemClassName?: string;
  questionClassName?: string;
  answerClassName?: string;
  onToggle: () => void;
}

function FaqRow({
  item,
  open,
  animateAnswer,
  itemClassName,
  questionClassName,
  answerClassName,
  onToggle,
}: FaqRowProps) {
  const answerId = React.useId();

  return (
    <article
      className={cn(
        'overflow-hidden rounded-lg border border-public-border bg-public-glass text-public-glass-foreground shadow-[var(--public-shadow-floating)] backdrop-blur-xl',
        itemClassName,
      )}
    >
      <AnimateIcon asChild animateOnHover animateOnTap>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={answerId}
          onClick={onToggle}
          className={cn(
            'group flex w-full items-start gap-4 px-5 py-4 text-left outline-none transition-colors hover:bg-public-accent-soft/55 focus-visible:ring-2 focus-visible:ring-public-ring',
            questionClassName,
          )}
        >
          <FaqIcon item={item} />
          <span className="min-w-0 flex-1">
            {item.eyebrow ? (
              <span className="mb-1 block text-xs font-medium uppercase tracking-[0.12em] text-public-muted-foreground">
                {item.eyebrow}
              </span>
            ) : null}
            <span className="block text-base font-semibold leading-6 text-public-foreground">
              {item.question}
            </span>
          </span>
          <ZeroIcon
            name="chevron-down"
            aria-hidden
            className={cn(
              'mt-0.5 size-5 shrink-0 text-public-muted-foreground transition-transform duration-300',
              open ? 'rotate-180 text-public-foreground' : undefined,
            )}
          />
        </button>
      </AnimateIcon>

      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            id={answerId}
            key="answer"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div
              className={cn(
                'px-5 pb-5 pl-[4.25rem] text-sm leading-7 text-public-muted-foreground',
                answerClassName,
              )}
            >
              {renderAnswer(item.answer, animateAnswer)}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </article>
  );
}

function FaqIcon({ item }: { item: FaqItem }) {
  if (item.icon) {
    return (
      <span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-public-border bg-public-surface text-public-accent">
        {item.icon}
      </span>
    );
  }

  return (
    <span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-public-border bg-public-surface text-public-accent">
      <ZeroIcon name={item.iconName ?? 'message-circle'} aria-hidden className="size-4" />
    </span>
  );
}

function renderAnswer(answer: React.ReactNode, animateAnswer: boolean) {
  if (animateAnswer && typeof answer === 'string') {
    return (
      <TextGenerateEffect
        key={answer}
        words={answer}
        className="text-sm font-normal leading-7 text-public-muted-foreground"
        wordClassName="text-public-muted-foreground"
        duration={0.32}
        stagger={0.025}
      />
    );
  }

  return answer;
}
