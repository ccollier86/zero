'use client';

import type { ReactNode } from 'react';
import { AppProvider, ThemeProvider, Toaster } from '../src/frontend';
import { tables } from './launchboard/schema';

export default function RootLayout({ children }: { children?: ReactNode }) {
  return (
    <ThemeProvider defaultTheme="system" storageKey="zero-theme">
      <AppProvider
        url={typeof window !== 'undefined' ? window.location.origin : ''}
        tables={tables}
      >
        <div className="min-h-screen bg-background text-foreground font-sans antialiased">
          {children}
          <Toaster />
        </div>
      </AppProvider>
    </ThemeProvider>
  );
}
