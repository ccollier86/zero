'use client';

/**
 * data-studio-dialog-field.tsx
 *
 * Shared field framing and safe user-facing error text for Data Studio dialogs.
 */

import * as React from 'react';
import { Label } from '../ui/label';

export function DataStudioDialogField({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function dataStudioDialogErrorMessage(value: unknown): string {
  return value instanceof Error && value.message ? value.message : 'The operation failed.';
}
