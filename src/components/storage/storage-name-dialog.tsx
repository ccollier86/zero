'use client';

/**
 * storage-name-dialog.tsx
 *
 * Provides a small promise-based naming dialog for storage UI actions. This
 * file owns only the modal form; storage mutations are performed by callers.
 */

import * as React from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { modals } from '../../modals';

export interface StorageNameDialogOptions {
  title: string;
  label: string;
  description?: string;
  initialValue?: string;
  placeholder?: string;
  submitLabel?: string;
}

interface StorageNameDialogContentProps {
  options: StorageNameDialogOptions;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}

/** Open a storage naming dialog and resolve with the trimmed value or null. */
export function openStorageNameDialog(options: StorageNameDialogOptions): Promise<string | null> {
  return new Promise((resolve) => {
    let settled = false;
    let modalId = '';

    const finish = (value: string | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
      if (modalId) modals.close(modalId);
    };

    modalId = modals.open({
      title: options.title,
      size: 'sm',
      onClose: () => finish(null),
      content: (
        <StorageNameDialogContent
          options={options}
          onSubmit={(value) => finish(value)}
          onCancel={() => finish(null)}
        />
      ),
    });
  });
}

function StorageNameDialogContent({
  options,
  onSubmit,
  onCancel,
}: StorageNameDialogContentProps) {
  const [value, setValue] = React.useState(options.initialValue ?? '');
  const trimmed = value.trim();

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (trimmed) onSubmit(trimmed);
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="storage-name-dialog-input">{options.label}</Label>
        {options.description && (
          <p className="text-sm text-muted-foreground">{options.description}</p>
        )}
        <Input
          id="storage-name-dialog-input"
          value={value}
          placeholder={options.placeholder}
          autoFocus
          onChange={(event) => setValue(event.target.value)}
        />
      </div>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={!trimmed}>
          {options.submitLabel ?? 'Save'}
        </Button>
      </div>
    </form>
  );
}
