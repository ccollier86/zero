'use client';

import * as React from 'react';

import { cn } from '@/lib/utils';

// ─── Types ───────────────────────────────────────────────────────────────────

interface AuthHeaderProps {
  title: string;
  description?: string;
  className?: string;
}

// ─── AuthHeader ──────────────────────────────────────────────────────────────

function AuthHeader({ title, description, className }: AuthHeaderProps) {
  return (
    <div className={cn('space-y-1 pb-3', className)}>
      <h2 className="text-lg font-semibold leading-none tracking-tight">{title}</h2>
      {description && (
        <p className="text-sm text-muted-foreground">{description}</p>
      )}
    </div>
  );
}

export { AuthHeader, type AuthHeaderProps };
