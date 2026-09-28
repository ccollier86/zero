'use client';

/**
 * theme-toggler.tsx
 *
 * Public Zero wrapper for Animate UI's theme transition primitive. This file
 * owns the button affordance only; ThemeProvider owns theme persistence and app
 * shells decide where the control is rendered.
 */

import * as React from 'react';
import { useTheme } from 'next-themes';
import { Monitor, Moon, Sun } from 'lucide-react';
import { VariantProps } from 'class-variance-authority';

import {
  ThemeToggler as ThemeTogglerPrimitive,
  type ThemeTogglerProps as ThemeTogglerPrimitiveProps,
  type ThemeSelection,
  type Resolved,
} from '#zero/components/animate-ui/primitives/effects/theme-toggler';
import { buttonVariants } from '#zero/components/animate-ui/components/buttons/icon';
import { cn } from '#zero/lib/utils';

const getIcon = (
  effective: ThemeSelection,
  resolved: Resolved,
  modes: ThemeSelection[],
) => {
  const theme = modes.includes('system') ? effective : resolved;
  return theme === 'system' ? (
    <Monitor />
  ) : theme === 'dark' ? (
    <Moon />
  ) : (
    <Sun />
  );
};

const getNextTheme = (
  effective: ThemeSelection,
  modes: ThemeSelection[],
): ThemeSelection => {
  const i = modes.indexOf(effective);
  if (i === -1) return modes[0];
  return modes[(i + 1) % modes.length];
};

type ThemeTogglerButtonProps = React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    modes?: ThemeSelection[];
    onImmediateChange?: ThemeTogglerPrimitiveProps['onImmediateChange'];
    direction?: ThemeTogglerPrimitiveProps['direction'];
  };

function ThemeTogglerButton({
  variant = 'default',
  size = 'default',
  modes = ['light', 'dark', 'system'],
  direction = 'ltr',
  onImmediateChange,
  onClick,
  className,
  type = 'button',
  title,
  'aria-label': ariaLabel,
  ...props
}: ThemeTogglerButtonProps) {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const currentTheme = resolveCurrentTheme(theme, resolvedTheme, modes);

  return (
    <ThemeTogglerPrimitive
      theme={currentTheme}
      resolvedTheme={resolvedTheme as Resolved}
      setTheme={setTheme}
      direction={direction}
      onImmediateChange={onImmediateChange}
    >
      {({ effective, resolved, toggleTheme }) => (
        <button
          data-slot="theme-toggler-button"
          className={cn(buttonVariants({ variant, size, className }))}
          type={type}
          title={title ?? 'Switch theme'}
          aria-label={ariaLabel ?? `Switch theme from ${effective}`}
          onClick={(e) => {
            onClick?.(e);
            toggleTheme(getNextTheme(effective, modes));
          }}
          {...props}
        >
          {getIcon(effective, resolved, modes)}
        </button>
      )}
    </ThemeTogglerPrimitive>
  );
}

function resolveCurrentTheme(
  theme: string | undefined,
  resolvedTheme: string | undefined,
  modes: ThemeSelection[],
): ThemeSelection {
  if (modes.includes('system') && theme === 'system') return 'system';
  if (theme === 'light' || theme === 'dark') return theme;
  if (resolvedTheme === 'dark') return 'dark';
  return 'light';
}

export { ThemeTogglerButton, type ThemeTogglerButtonProps };
