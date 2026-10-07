/** Controlled presentation contracts; applications own integration data and authority. */
import type { HTMLAttributes, ReactNode } from 'react';

/** Semantic dot colors; labels, not color alone, communicate the connection state. */
export type IntegrationSettingsStatusTone = 'success' | 'warning' | 'destructive' | 'muted' | 'info';

/** An app-projected status. The list never infers provider readiness or connectivity. */
export interface IntegrationSettingsStatus {
  readonly label: string;
  readonly tone?: IntegrationSettingsStatusTone;
}

/** Optional app-owned copy for the existing AlertDialog confirmation. */
export interface IntegrationSettingsConfirmation {
  readonly title: string;
  readonly description: ReactNode;
  readonly confirmLabel?: string;
}

/** One row action; destructive actions always require confirmation. */
export interface IntegrationSettingsAction {
  readonly id: string;
  readonly label: string;
  readonly icon?: ReactNode;
  readonly destructive?: boolean;
  readonly disabled?: boolean;
  /** A nonempty reason also disables dispatch and remains visible in the menu. */
  readonly disabledReason?: string;
  readonly confirmation?: IntegrationSettingsConfirmation;
  readonly onSelect: (context: IntegrationSettingsActionContext) => void | Promise<void>;
}

/** One controlled row; change revision when the same ID represents a new action target. */
export interface IntegrationSettingsItem {
  readonly id: string;
  readonly revision?: string | number;
  readonly title: string;
  readonly description?: ReactNode;
  readonly icon?: ReactNode;
  readonly logo?: { readonly src: string; readonly alt?: string };
  readonly status?: IntegrationSettingsStatus;
  readonly actions?: readonly IntegrationSettingsAction[];
  readonly disabled?: boolean;
  readonly disabledReason?: string;
}

/** An optional named group. IDs must be unique; row IDs are unique within their group. */
export interface IntegrationSettingsGroup {
  readonly id: string;
  readonly title?: string;
  readonly description?: ReactNode;
  readonly items: readonly IntegrationSettingsItem[];
  readonly emptyMessage?: ReactNode;
}

/** Callback scope is app data plus cancellation, never invented Guardian identity. */
export interface IntegrationSettingsActionContext {
  readonly item: IntegrationSettingsItem;
  readonly groupId: string | null;
  readonly signal: AbortSignal;
}

/** Optional header action. Its label defaults to New Connection; null icon omits the default. */
export interface IntegrationSettingsPrimaryAction {
  readonly label?: string;
  readonly icon?: ReactNode;
  readonly disabled?: boolean;
  readonly disabledReason?: string;
  readonly onSelect: (context: { readonly signal: AbortSignal }) => void | Promise<void>;
}

/** Safe error notification context; applications may present their own domain errors. */
export interface IntegrationSettingsErrorContext {
  readonly itemId: string | null;
  readonly groupId: string | null;
  readonly actionId: string | null;
}

type IntegrationSettingsData =
  | { readonly items: readonly IntegrationSettingsItem[]; readonly groups?: never }
  | { readonly groups: readonly IntegrationSettingsGroup[]; readonly items?: never };

/**
 * Controlled integration settings, usable standalone or beneath a Zero provider.
 * Provider scope changes fence work automatically; operationScopeKey additionally
 * retires app-specific target/revision state. Callbacks still need server authority.
 */
export type IntegrationSettingsListProps = Omit<HTMLAttributes<HTMLElement>, 'title' | 'children' | 'onError' | 'contextMenu'>
  & IntegrationSettingsData & {
    readonly title?: string;
    readonly description?: ReactNode;
    readonly primaryAction?: IntegrationSettingsPrimaryAction;
    readonly emptyMessage?: ReactNode;
    /** Keep controlled connection data visible while disabling every mutation. */
    readonly readOnly?: boolean;
    readonly readOnlyReason?: string;
    readonly operationScopeKey?: string | number;
    /** Add native right-click/Shift+F10 access without removing the visible menu button. */
    readonly contextMenu?: boolean;
    readonly onActionError?: (error: unknown, context: IntegrationSettingsErrorContext) => void;
  };
