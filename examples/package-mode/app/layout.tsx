'use client';

/**
 * layout.tsx
 *
 * Root UI shell for the package-mode fixture. This file owns app layout only;
 * platform data, auth, and routing behavior stay in Zero providers.
 */

import type { ReactNode } from 'react';
import { ThemeProvider, Toaster } from '@zero/framework/react';

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider defaultTheme="system" storageKey="zero-theme">
      <div className="min-h-screen bg-background text-foreground font-sans antialiased">
        {children}
        <Toaster />
      </div>
    </ThemeProvider>
  );
}
