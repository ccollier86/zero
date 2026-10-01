'use client';

import type { ReactNode } from 'react';

import { ThemeProvider } from '@zero/framework/components/ui/theme-provider';
import { Toaster } from '@zero/framework/components/ui/sonner';
import { ConfirmProvider } from '@zero/framework/react';
import { AppProvider } from '@zero/framework/react/app-provider';

import { tables } from '../db/schema';
import { InvitationHandoffExpiry } from './components/invitation-handoff-expiry';

/** Own the single browser runtime shared by every public and protected route. */
export default function RootLayout({ children }: { children?: ReactNode }) {
  return (
    <ThemeProvider defaultTheme="system" storageKey="guardian-fabric-proof-theme">
      <AppProvider
        url={typeof window !== 'undefined' ? window.location.origin : ''}
        tables={tables}
        auth
      >
        <InvitationHandoffExpiry />
        <ConfirmProvider>
          <div className="min-h-screen bg-background font-sans text-foreground antialiased">
            {children}
            <Toaster />
          </div>
        </ConfirmProvider>
      </AppProvider>
    </ThemeProvider>
  );
}
