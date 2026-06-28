'use client';

import * as React from 'react';
import { motion, AnimatePresence } from 'motion/react';

import { cn } from '@/lib/utils';
import { Fade } from '@/components/animate-ui/primitives/effects/fade';

// ─── Types ───────────────────────────────────────────────────────────────────

interface ValidationRule {
  label: string;
  met: boolean;
}

interface ValidationRulesProps {
  rules: ValidationRule[];
  /** Show rules only when input is focused/dirty. Default: true */
  showOnlyWhenActive?: boolean;
  /** Stagger delay between rules in ms. Default: 50 */
  staggerDelay?: number;
  className?: string;
}

// ─── Rule Item ───────────────────────────────────────────────────────────────

function RuleItem({ rule, index, staggerDelay }: {
  rule: ValidationRule;
  index: number;
  staggerDelay: number;
}) {
  const [wasMetOnce, setWasMetOnce] = React.useState(false);
  const prevMetRef = React.useRef(rule.met);

  React.useEffect(() => {
    if (rule.met && !prevMetRef.current) {
      setWasMetOnce(true);
    }
    prevMetRef.current = rule.met;
  }, [rule.met]);

  const justBecameMet = rule.met && wasMetOnce;

  return (
    <Fade delay={index * staggerDelay}>
      <div className="flex items-center gap-1.5">
        <motion.div
          className="flex-shrink-0"
          animate={justBecameMet ? { scale: [1, 1.15, 1] } : { scale: 1 }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            className={cn(
              'transition-colors duration-300',
              rule.met ? 'text-green-500' : 'text-muted-foreground/40',
            )}
          >
            <motion.circle
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="2"
              fill="none"
            />
            <motion.path
              d="m9 12 2 2 4-4"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              initial={{ pathLength: rule.met ? 1 : 0, opacity: rule.met ? 1 : 0 }}
              animate={{
                pathLength: rule.met ? 1 : 0,
                opacity: rule.met ? 1 : 0,
              }}
              transition={{ duration: 0.4, ease: 'easeInOut' }}
            />
          </svg>
        </motion.div>
        <motion.span
          className="text-xs leading-none"
          animate={{
            color: rule.met
              ? 'var(--color-foreground)'
              : 'var(--color-muted-foreground)',
          }}
          transition={{ type: 'spring', stiffness: 200, damping: 20 }}
        >
          {rule.label}
        </motion.span>
      </div>
    </Fade>
  );
}

// ─── ValidationRules ─────────────────────────────────────────────────────────

function ValidationRules({
  rules,
  showOnlyWhenActive = true,
  staggerDelay = 50,
  className,
}: ValidationRulesProps) {
  return (
    <AnimatePresence>
      {rules.length > 0 && (
        <motion.div
          className={cn('flex flex-col gap-1.5', className)}
          initial={showOnlyWhenActive ? { opacity: 0, height: 0 } : undefined}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ type: 'spring', stiffness: 300, damping: 25 }}
        >
          {rules.map((rule, index) => (
            <RuleItem
              key={rule.label}
              rule={rule}
              index={index}
              staggerDelay={staggerDelay}
            />
          ))}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export { ValidationRules, type ValidationRulesProps, type ValidationRule };
