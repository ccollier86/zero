'use client';

/**
 * Shared token-aware native input presentation and pointer-border feedback.
 * Owns native attribute/ref forwarding, including readonly form semantics;
 * it does not validate domain data or authorize changes to stored records.
 */

import * as React from 'react';
import { motion, useMotionTemplate, useMotionValue } from 'motion/react';

import { cn } from '#zero/lib/utils';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /** Style the existing outer border wrapper when composing an attached control. */
  wrapperClassName?: string;
}

/** Render Zero's token-aware input with animated pointer border feedback. */
const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, wrapperClassName, type, disabled, readOnly, onFocus, onBlur, ...props }, ref) => {
    const radius = 100;
    const [visible, setVisible] = React.useState(false);
    const [focused, setFocused] = React.useState(false);
    const mouseX = useMotionValue(0);
    const mouseY = useMotionValue(0);

    function handleMouseMove(event: React.MouseEvent<HTMLDivElement>) {
      if (disabled || readOnly) return;
      const { left, top } = event.currentTarget.getBoundingClientRect();
      mouseX.set(event.clientX - left);
      mouseY.set(event.clientY - top);
    }

    const borderBackground = useMotionTemplate`
      radial-gradient(
        ${visible && !disabled && !readOnly ? `${radius}px` : '0px'} circle at ${mouseX}px ${mouseY}px,
        var(--primary),
        transparent 80%
      ),
      ${focused && !disabled ? 'color-mix(in oklab, var(--primary) 34%, var(--border))' : 'var(--border)'}
    `;

    if (type === 'hidden') {
      return (
        <input
          ref={ref}
          type={type}
          disabled={disabled}
          readOnly={readOnly}
          data-slot="input"
          data-readonly={readOnly ? 'true' : undefined}
          className={className}
          {...props}
        />
      );
    }

    return (
      <motion.div
        style={{
          background: borderBackground,
        }}
        onMouseMove={handleMouseMove}
        onMouseEnter={() => { if (!disabled && !readOnly) setVisible(true); }}
        onMouseLeave={() => setVisible(false)}
        data-slot="input-wrapper"
        data-readonly={readOnly ? 'true' : undefined}
        className={cn('group/input w-full rounded-lg p-[2px] transition duration-300', wrapperClassName)}
      >
        <input
          ref={ref}
          type={type}
          disabled={disabled}
          readOnly={readOnly}
          data-slot="input"
          data-readonly={readOnly ? 'true' : undefined}
          className={cn(
            "h-9 w-full min-w-0 rounded-md border-none bg-background px-3 py-1 text-base shadow-xs transition-[border-color,box-shadow,color] outline-none selection:bg-primary selection:text-primary-foreground file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-bg-inset/90",
            readOnly ? 'cursor-default' : 'group-hover/input:shadow-none',
            "focus-visible:ring-0",
            "aria-invalid:ring-[1px] aria-invalid:ring-destructive/25",
            className
          )}
          onFocus={(event) => {
            setFocused(true);
            onFocus?.(event);
          }}
          onBlur={(event) => {
            setFocused(false);
            onBlur?.(event);
          }}
          {...props}
        />
      </motion.div>
    );
  }
);

Input.displayName = 'Input';

export { Input };
