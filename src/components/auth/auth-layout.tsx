'use client';

import * as React from 'react';

import { cn } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';
import { GradientText } from '@/components/animate-ui/primitives/texts/gradient';

// ─── Types ───────────────────────────────────────────────────────────────────

interface AuthLayoutProps {
  appName?: string;
  logo?: React.ReactNode;
  gradient?: string;
  children: React.ReactNode;
  className?: string;
}

// ─── AuthLayout ──────────────────────────────────────────────────────────────

function AuthLayout({
  appName,
  logo,
  gradient,
  children,
  className,
}: AuthLayoutProps) {
  return (
    <div className={cn('min-h-screen flex items-center justify-center bg-background p-4', className)}>
      <div className="flex w-full max-w-sm flex-col items-center gap-5">
        {logo ? (
          <div className="flex-shrink-0">{logo}</div>
        ) : appName ? (
          <GradientText
            text={appName}
            className="text-2xl font-bold"
            {...(gradient ? { gradient } : {})}
          />
        ) : null}
        <Card className="w-full">
          <CardContent className="px-6 py-5">
            {children}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export { AuthLayout, type AuthLayoutProps };
