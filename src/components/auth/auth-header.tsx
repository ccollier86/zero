'use client';

import * as React from 'react';

import { cn } from '#zero/lib/utils';

// ─── Types ───────────────────────────────────────────────────────────────────

interface AuthHeaderProps {
  title: string;
  description?: string;
  className?: string;
}

// ─── AuthHeader ──────────────────────────────────────────────────────────────

function AuthHeader({ title, description, className }: AuthHeaderProps) {
  return (
    <div className={cn('space-y-1.5 pb-2', className)}>
      <h2 className="text-xl font-semibold leading-tight tracking-tight">{title}</h2>
      {description && (
        <p className="text-sm leading-relaxed text-muted-foreground">{description}</p>
      )}
    </div>
  );
}

export { AuthHeader, type AuthHeaderProps };
