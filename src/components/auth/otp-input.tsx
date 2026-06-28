'use client';

import * as React from 'react';
import { OTPInput as OTPInputHeadless, SlotProps } from 'input-otp';
import { motion } from 'motion/react';

import { cn } from '@/lib/utils';

// ─── Types ───────────────────────────────────────────────────────────────────

interface OTPInputProps {
  length?: number;
  value: string;
  onChange: (value: string) => void;
  onComplete?: (value: string) => void;
  error?: boolean;
  className?: string;
}

// ─── Slot ────────────────────────────────────────────────────────────────────

function Slot({ char, isActive, hasFakeCaret }: SlotProps) {
  return (
    <div
      className={cn(
        'relative flex h-10 w-10 items-center justify-center rounded-md border bg-transparent text-center text-base font-medium transition-all',
        isActive && 'ring-2 ring-primary border-primary',
      )}
    >
      {char ? (
        <motion.span
          initial={{ scale: 0.8 }}
          animate={{ scale: [1, 1.06, 1] }}
          transition={{ type: 'spring', stiffness: 400, damping: 20 }}
        >
          {char}
        </motion.span>
      ) : null}
      {hasFakeCaret && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="h-5 w-px animate-caret-blink bg-foreground" />
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
  error = false,
  className,
}: OTPInputProps) {
  const halfLength = Math.floor(length / 2);

  return (
    <motion.div
      animate={error ? { x: [0, -8, 8, -4, 4, 0] } : { x: 0 }}
      transition={{ duration: 0.4 }}
      className={className}
    >
      <OTPInputHeadless
        value={value}
        onChange={onChange}
        onComplete={onComplete}
        maxLength={length}
        containerClassName="flex items-center gap-1.5"
        render={({ slots }) => (
          <div className="flex items-center gap-1.5">
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
