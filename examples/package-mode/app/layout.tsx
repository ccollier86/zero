'use client';

/**
 * layout.tsx
 *
 * Root UI shell for the package-mode fixture. This file owns app layout only;
 * platform data, auth, and routing behavior stay in Zero providers.
 */

import type { ReactNode } from 'react';
import { AppProvider, ThemeProvider, Toaster } from '@zero/framework/react';
import { tables } from '../db/schema';

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider defaultTheme="system" storageKey="zero-theme">
      <AppProvider
        url={typeof window !== 'undefined' ? window.location.origin : ''}
        tables={tables}
      >
        <div className="min-h-screen bg-background text-foreground font-sans antialiased">
          {children}
        </div>
        <Toaster />
      </AppProvider>
    </ThemeProvider>
  );
}
