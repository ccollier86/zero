'use client';

import * as React from 'react';

import { cn } from '#zero/lib/utils';
import { Button } from '#zero/components/ui/button';
import { Separator } from '#zero/components/ui/separator';

// ─── Types ───────────────────────────────────────────────────────────────────

interface SocialProvider {
  name: string;
  label?: string;
  icon: React.ReactNode;
  onClick: () => void;
}

interface SocialLoginGroupProps {
  providers: SocialProvider[];
  dividerText?: string;
  className?: string;
}

// ─── SocialLoginGroup ────────────────────────────────────────────────────────

function SocialLoginGroup({
  providers,
  dividerText = 'OR',
  className,
}: SocialLoginGroupProps) {
  if (providers.length === 0) return null;

  return (
    <div className={cn('space-y-3', className)}>
      <div className="relative flex items-center justify-center">
        <Separator className="absolute w-full" />
        <span className="relative bg-card px-2 text-xs text-muted-foreground">
          {dividerText}
        </span>
      </div>
      <div className={cn(
        providers.length > 1 ? 'grid grid-cols-2 gap-2' : 'flex',
      )}>
        {providers.map((provider) => (
          <Button
            key={provider.name}
            type="button"
            variant="outline"
            size="sm"
            className="w-full h-8"
            onClick={provider.onClick}
          >
            {provider.icon}
            <span>{provider.label ?? provider.name}</span>
          </Button>
        ))}
      </div>
    </div>
  );
}

export { SocialLoginGroup, type SocialLoginGroupProps, type SocialProvider };
