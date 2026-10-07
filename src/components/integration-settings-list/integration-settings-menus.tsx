'use client';

/** Existing menu primitives with one shared current-capability action policy. */
import { Fragment, type ReactNode } from 'react';
import {
  DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from '../dropdown-menu';
import { ContextMenuContent, ContextMenuItem, ContextMenuSeparator } from '../context-menu';
import { integrationSettingsDisabled } from './integration-settings-list-policy';
import type { IntegrationSettingsAction } from './integration-settings-list.types';

/** Render the same descriptors in either menu; disabled reasons remain readable. */
export function IntegrationSettingsMenu({ actions, kind, pending, onSelect, onCloseAutoFocus }: {
  actions: readonly IntegrationSettingsAction[];
  kind: 'dropdown' | 'context';
  pending: boolean;
  onSelect: (actionId: string) => void;
  onCloseAutoFocus: (event: Event) => void;
}) {
  const entries: ReactNode[] = actions.map((action, index) => <Fragment key={action.id}>
    {action.destructive && index > 0 && !actions[index - 1]?.destructive
      && (kind === 'dropdown' ? <DropdownMenuSeparator /> : <ContextMenuSeparator />)}
    {kind === 'dropdown'
      ? <DropdownMenuItem disabled={pending || integrationSettingsDisabled(action)}
        variant={action.destructive ? 'destructive' : 'default'}
        onSelect={() => onSelect(action.id)}>
        {action.icon}<ActionLabel action={action} />
      </DropdownMenuItem>
      : <ContextMenuItem disabled={pending || integrationSettingsDisabled(action)}
        variant={action.destructive ? 'destructive' : 'default'} icon={action.icon}
        onSelect={() => onSelect(action.id)}><ActionLabel action={action} /></ContextMenuItem>}
  </Fragment>);
  return kind === 'dropdown'
    ? <DropdownMenuContent align="end" className="integration-settings-list__menu"
      onCloseAutoFocus={onCloseAutoFocus}>{entries}</DropdownMenuContent>
    : <ContextMenuContent className="integration-settings-list__menu"
      onCloseAutoFocus={onCloseAutoFocus}>{entries}</ContextMenuContent>;
}

function ActionLabel({ action }: { action: IntegrationSettingsAction }) {
  return <span className="integration-settings-list__action-label">
    <span>{action.label}</span>
    {action.disabledReason && <span className="integration-settings-list__reason">{action.disabledReason}</span>}
  </span>;
}
