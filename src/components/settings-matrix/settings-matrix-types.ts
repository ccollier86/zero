/** Controlled presentation contracts for a compact, capability-aware settings table. */

import type { ReactNode } from 'react';

/** Capability hints supplied by the owning application; never server authority. */
export interface SettingsMatrixCapability {
  readonly readOnly?: boolean;
  readonly disabled?: boolean;
  readonly disabledReason?: string;
}

/** One of the matrix's one to three labeled choice columns. */
export interface SettingsMatrixColumn {
  readonly id: string;
  readonly label: string;
  readonly icon?: ReactNode;
  readonly description?: string;
}

/** A named setting with optional per-choice restrictions. */
export interface SettingsMatrixRow extends SettingsMatrixCapability {
  readonly id: string;
  readonly label: string;
  readonly description?: ReactNode;
  readonly cells?: Readonly<Record<string, SettingsMatrixCapability>>;
}

/** Boolean values are controlled; omitted/nonboolean cells are unavailable. */
export type SettingsMatrixValue = Readonly<Record<string, Readonly<Record<string, boolean>>>>;

/** A single proposed change. The app owns acknowledgement and updating value. */
export interface SettingsMatrixChange {
  readonly rowId: string;
  readonly columnId: string;
  readonly checked: boolean;
}

/** Advisory cancellation only; the backend must independently authorize writes. */
export interface SettingsMatrixChangeContext {
  readonly signal: AbortSignal;
}

/** Present controlled settings without implying storage or delivery services. */
export interface SettingsMatrixProps extends SettingsMatrixCapability {
  readonly columns: readonly SettingsMatrixColumn[];
  readonly rows: readonly SettingsMatrixRow[];
  readonly value: SettingsMatrixValue;
  readonly onChange?: (change: SettingsMatrixChange, context: SettingsMatrixChangeContext) => void | Promise<void>;
  readonly control?: 'checkbox' | 'switch';
  readonly title?: string;
  readonly description?: ReactNode;
  readonly help?: ReactNode;
  readonly emptyMessage?: string;
  /** Retire work when an app-specific target changes, in addition to Guardian. */
  readonly scopeKey?: string | number;
  readonly className?: string;
  readonly id?: string;
}
