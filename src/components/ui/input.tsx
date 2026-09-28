'use client';

import * as React from 'react';
import { motion, useMotionTemplate, useMotionValue } from 'motion/react';

import { cn } from '#zero/lib/utils';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

/** Render Zero's token-aware input with animated pointer border feedback. */
const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, disabled, onFocus, onBlur, ...props }, ref) => {
    const radius = 100;
    const [visible, setVisible] = React.useState(false);
    const [focused, setFocused] = React.useState(false);
    const mouseX = useMotionValue(0);
    const mouseY = useMotionValue(0);

    function handleMouseMove(event: React.MouseEvent<HTMLDivElement>) {
      const { left, top } = event.currentTarget.getBoundingClientRect();
      mouseX.set(event.clientX - left);
      mouseY.set(event.clientY - top);
    }

    const borderBackground = useMotionTemplate`
      radial-gradient(
        ${visible && !disabled ? `${radius}px` : '0px'} circle at ${mouseX}px ${mouseY}px,
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
          data-slot="input"
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
        onMouseEnter={() => setVisible(true)}
        onMouseLeave={() => setVisible(false)}
        className="group/input w-full rounded-lg p-[2px] transition duration-300"
      >
        <input
          ref={ref}
          type={type}
          disabled={disabled}
          data-slot="input"
          className={cn(
            "h-9 w-full min-w-0 rounded-md border-none bg-background px-3 py-1 text-base shadow-xs transition-[border-color,box-shadow,color] outline-none selection:bg-primary selection:text-primary-foreground file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground group-hover/input:shadow-none disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-bg-inset/90",
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
