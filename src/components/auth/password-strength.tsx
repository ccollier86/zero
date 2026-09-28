'use client';

import * as React from 'react';

import { cn } from '#zero/lib/utils';
import { ValidationMeter } from '#zero/components/ui/validation-meter';
import { ValidationRules, type ValidationRule } from '#zero/components/ui/validation-rules';

// ─── Types ───────────────────────────────────────────────────────────────────

interface PasswordStrengthProps {
  password: string;
  className?: string;
}

// ─── Scoring ─────────────────────────────────────────────────────────────────

const strengthLabels = ['', 'Weak', 'Fair', 'Good', 'Strong'];

function getPasswordRules(password: string): ValidationRule[] {
  return [
    { label: 'At least 8 characters', met: password.length >= 8 },
    { label: 'Lowercase letter', met: /[a-z]/.test(password) },
    { label: 'Uppercase letter', met: /[A-Z]/.test(password) },
    { label: 'Number', met: /\d/.test(password) },
    { label: 'Special character', met: /[^a-zA-Z0-9]/.test(password) },
  ];
}

function calcPasswordStrength(password: string): number {
  if (!password) return 0;
  const rules = getPasswordRules(password);
  const metCount = rules.filter((r) => r.met).length;
  if (metCount <= 1) return 1;
  if (metCount <= 2) return 2;
  if (metCount <= 3) return 3;
  return 4;
}

// ─── PasswordStrength ────────────────────────────────────────────────────────

function PasswordStrength({ password, className }: PasswordStrengthProps) {
  const rules = getPasswordRules(password);
  const score = calcPasswordStrength(password);

  return (
    <div className={cn('space-y-2', className)}>
      <ValidationMeter
        score={score}
        labels={strengthLabels}
      />
      <ValidationRules
        rules={rules}
        staggerDelay={40}
        showOnlyWhenActive={false}
      />
    </div>
  );
}

export {
  PasswordStrength,
  calcPasswordStrength,
  getPasswordRules,
  type PasswordStrengthProps,
};
