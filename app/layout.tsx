import type { ReactNode } from 'react';
import { ThemeProvider, Toaster } from '../src/frontend';

export default function RootLayout({ children }: { children?: ReactNode }) {
  return (
    <ThemeProvider defaultTheme="system" storageKey="zero-theme">
      <div className="min-h-screen bg-background text-foreground font-sans antialiased">
        {children}
        <Toaster />
      </div>
    </ThemeProvider>
  );
}
