/** Root browser providers shared by public auth pages and the protected app. */

import type { ReactNode } from 'react';
import { ThemeProvider } from '@zero/framework/components/ui/theme-provider';
import { Toaster } from '@zero/framework/components/ui/sonner';
import { AppProvider } from '@zero/framework/react/app-provider';
import { tables } from '../db/schema';

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider defaultTheme="system" storageKey="fabric-tenancy-theme">
      <AppProvider
        url={typeof window !== 'undefined' ? window.location.origin : ''}
        tables={tables}
        auth
      >
        <div className="min-h-screen bg-background font-sans text-foreground antialiased">
          {children}
        </div>
        <Toaster />
      </AppProvider>
    </ThemeProvider>
  );
}
