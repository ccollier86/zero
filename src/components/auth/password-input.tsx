'use client';

import * as React from 'react';

import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { AnimateIcon } from '@/components/animate-ui/icons/icon';
import { Eye } from '@/components/animate-ui/icons/eye';
import { EyeOff } from '@/components/animate-ui/icons/eye-off';
import { PasswordStrength } from '@/components/auth/password-strength';

// ─── Types ───────────────────────────────────────────────────────────────────

interface PasswordInputProps extends React.ComponentProps<typeof Input> {
  showStrength?: boolean;
  strengthClassName?: string;
}

// ─── PasswordInput ───────────────────────────────────────────────────────────

function PasswordInput({
  showStrength = false,
  strengthClassName,
  className,
  ...props
}: PasswordInputProps) {
  const [visible, setVisible] = React.useState(false);
  const value = typeof props.value === 'string' ? props.value : '';

  return (
    <div className="space-y-1.5">
      <div className="relative">
        <Input
          type={visible ? 'text' : 'password'}
          className={cn('pr-9', className)}
          {...props}
        />
        <button
          type="button"
          tabIndex={-1}
          className="absolute right-0 top-0 flex h-full items-center px-2 text-muted-foreground hover:text-foreground transition-colors"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? 'Hide password' : 'Show password'}
        >
          <AnimateIcon animate>
            {visible ? <EyeOff size={16} /> : <Eye size={16} />}
          </AnimateIcon>
        </button>
      </div>
      {showStrength && value.length > 0 && (
        <PasswordStrength password={value} className={strengthClassName} />
      )}
    </div>
  );
}

export { PasswordInput, type PasswordInputProps };
