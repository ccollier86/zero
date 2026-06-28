'use client';

import { ThemeProvider as NextThemesProvider } from 'next-themes';
import type { ComponentProps } from 'react';

type ThemeProviderProps = ComponentProps<typeof NextThemesProvider>;

/**
 * Theme provider for dark/light/system mode.
 * Wraps next-themes with sensible defaults for the platform.
 *
 * @example
 * ```tsx
 * <ThemeProvider defaultTheme="dark" storageKey="platform-theme">
 *   <App />
 * </ThemeProvider>
 * ```
 */
function ThemeProvider({ children, ...props }: ThemeProviderProps) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem
      disableTransitionOnChange
      {...props}
    >
      {children}
    </NextThemesProvider>
  );
}

export { ThemeProvider, type ThemeProviderProps };
