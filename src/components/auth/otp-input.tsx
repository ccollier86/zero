'use client';

import * as React from 'react';
import { OTPInput as OTPInputHeadless, SlotProps } from 'input-otp';
import { motion, useReducedMotion } from 'motion/react';

import { cn } from '#zero/lib/utils';

// ─── Types ───────────────────────────────────────────────────────────────────

interface OTPInputProps {
  length?: number;
  value: string;
  onChange: (value: string) => void;
  onComplete?: (value: string) => void;
  /** Prevent editing or completing another code while an operation is pending. */
  disabled?: boolean;
  error?: boolean;
  className?: string;
}

// ─── Slot ────────────────────────────────────────────────────────────────────

function Slot({ char, isActive, hasFakeCaret }: SlotProps) {
  const reduceMotion = useReducedMotion() === true;
  return (
    <div
      className={cn(
        'relative flex size-9 items-center justify-center rounded-md border bg-transparent text-center text-sm font-medium transition-all motion-reduce:transition-none sm:size-10 sm:text-base',
        isActive && 'ring-2 ring-primary border-primary',
      )}
    >
      {char ? (
        <motion.span
          initial={reduceMotion ? false : { scale: 0.8 }}
          animate={reduceMotion ? { scale: 1 } : { scale: [1, 1.06, 1] }}
          transition={reduceMotion
            ? { duration: 0 }
            : { type: 'spring', stiffness: 400, damping: 20 }}
        >
          {char}
        </motion.span>
      ) : null}
      {hasFakeCaret && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="h-5 w-px animate-caret-blink bg-foreground motion-reduce:animate-none" />
        </div>
      )}
    </div>
  );
}

// ─── Separator ───────────────────────────────────────────────────────────────

function Separator() {
  return <div className="flex items-center text-muted-foreground px-0.5">-</div>;
}

// ─── OTPInput ────────────────────────────────────────────────────────────────

function OTPInput({
  length = 6,
  value,
  onChange,
  onComplete,
  disabled = false,
  error = false,
  className,
}: OTPInputProps) {
  const halfLength = Math.floor(length / 2);
  const reduceMotion = useReducedMotion() === true;

  return (
    <motion.div
      animate={error && !reduceMotion ? { x: [0, -8, 8, -4, 4, 0] } : { x: 0 }}
      transition={{ duration: reduceMotion ? 0 : 0.4 }}
      className={cn('max-w-full overflow-x-auto', className)}
    >
      <OTPInputHeadless
        value={value}
        onChange={onChange}
        onComplete={onComplete}
        disabled={disabled}
        maxLength={length}
        containerClassName="flex min-w-full w-max items-center justify-center gap-1 sm:gap-1.5"
        render={({ slots }) => (
          <div className="flex w-max items-center gap-1 sm:gap-1.5">
            {slots.map((slot, i) => (
              <React.Fragment key={i}>
                {i === halfLength && <Separator />}
                <div
                  className={cn(
                    error && 'ring-destructive border-destructive',
                    error && 'ring-1',
                  )}
                  style={{ borderRadius: '0.375rem' }}
                >
                  <Slot {...slot} />
                </div>
              </React.Fragment>
            ))}
          </div>
        )}
      />
    </motion.div>
  );
}

export { OTPInput, type OTPInputProps };
