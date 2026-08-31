/**
 * layout.tsx
 *
 * Root UI shell for a package-mode Zero app. This file owns app layout only;
 * platform data, auth, and routing behavior stay in Zero providers.
 */

import type { ReactNode } from 'react';
import { ThemeProvider } from '@zero/framework/components/ui/theme-provider';
import { Toaster } from '@zero/framework/components/ui/sonner';
import { AppProvider } from '@zero/framework/react/app-provider';
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
