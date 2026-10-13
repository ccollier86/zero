'use client';

/** Storage naming is a decision-only standard prompt; callers own authorized mutations. */
import { modals } from '../../modals';

export interface StorageNameDialogOptions {
  trigger?: Element | null;
  title: string;
  label: string;
  description?: string;
  initialValue?: string;
  placeholder?: string;
  submitLabel?: string;
}

/** A trimmed name or null, including authoritative retirement; no waiter is orphaned. */
export function openStorageNameDialog(options: StorageNameDialogOptions): Promise<string | null> {
  return modals.prompt({ title: options.title, label: options.label, description: options.description,
    value: options.initialValue, placeholder: options.placeholder, confirmLabel: options.submitLabel,
    required: true, trigger: options.trigger });
}
