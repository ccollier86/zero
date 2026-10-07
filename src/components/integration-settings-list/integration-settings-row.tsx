'use client';

/** Compact controlled row, optional context menu, and current-target action lifetime. */
import { useEffect, useRef, useState } from 'react';
import { Ellipsis } from 'lucide-react';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Avatar, AvatarImage, AvatarFallback } from '../ui/avatar';
import { DropdownMenu, DropdownMenuTrigger } from '../dropdown-menu';
import { ContextMenu, ContextMenuTrigger } from '../context-menu';
import { IntegrationSettingsMenu } from './integration-settings-menus';
import { IntegrationSettingsConfirmationDialog } from './integration-settings-confirmation';
import { findIntegrationSettingsAction, integrationSettingsDisabled } from './integration-settings-list-policy';
import { reportIntegrationSettingsActionError, useIntegrationSettingsAction } from './use-integration-settings-action';
import type { IntegrationSettingsListOwner } from './integration-settings-list';
import type { IntegrationSettingsItem } from './integration-settings-list.types';

/** IDs/revisions and capabilities, not descriptor object references, fence retained handlers. */
export function IntegrationSettingsRow({ item, groupId, owner, contextMenu }: {
  item: IntegrationSettingsItem; groupId: string; owner: IntegrationSettingsListOwner; contextMenu: boolean;
}) {
  const { session, pending, error } = useIntegrationSettingsAction();
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmationId, setConfirmationId] = useState<string | null>(null);
  const confirming = useRef(false), buttonRef = useRef<HTMLButtonElement>(null), rowRef = useRef<HTMLLIElement>(null);
  const origin = useRef<'dropdown' | 'context'>('dropdown');
  const actions = item.actions ?? [];
  const lookup = (actionId: string) => owner.current()
    ? findIntegrationSettingsAction(owner.props, groupId, item.id, item.revision, actionId) : null;
  const capabilityKey = JSON.stringify([integrationSettingsDisabled(item), actions.map(action =>
    [action.id, integrationSettingsDisabled(action), Boolean(action.destructive), Boolean(action.confirmation)])]);
  useEffect(() => {
    session.invalidate(); setConfirmationId(null); confirming.current = false; setMenuOpen(false);
  }, [capabilityKey, session]);
  const confirmation = confirmationId ? lookup(confirmationId)?.action ?? null : null;
  confirming.current = Boolean(confirmation);
  const close = () => { setConfirmationId(null); confirming.current = false; };
  const run = (actionId: string) => {
    void session.run({
      isCurrent: () => Boolean(lookup(actionId)),
      onSelect: signal => {
        const current = lookup(actionId)!;
        return current.action.onSelect({ item: current.item, groupId: groupId || null, signal });
      },
      onCompleted: close,
      onFailed: cause => reportIntegrationSettingsActionError(cause,
        { itemId: item.id, groupId: groupId || null, actionId }, owner.props.onActionError),
    });
  };
  const request = (actionId: string) => {
    const current = lookup(actionId);
    if (!current || pending) return;
    if (current.action.destructive || current.action.confirmation) {
      confirming.current = true; setConfirmationId(actionId);
    } else run(actionId);
  };
  const restoreFocus = (event: Event) => {
    event.preventDefault();
    if (owner.current()) (origin.current === 'context' ? rowRef.current : buttonRef.current)?.focus();
  };
  const closeMenuFocus = (event: Event) => { if (confirming.current) event.preventDefault(); };
  const disabled = Boolean(owner.props.readOnly) || integrationSettingsDisabled(item);
  const row = <li ref={rowRef} className="integration-settings-list__row"
    tabIndex={contextMenu && actions.length && !disabled ? 0 : undefined}
    aria-label={contextMenu ? item.title : undefined}
    onContextMenu={() => { origin.current = 'context'; }} onKeyDown={event => {
      if (event.key === 'ContextMenu' || event.key === 'F10' && event.shiftKey) origin.current = 'context';
    }}>
    <div className="integration-settings-list__identity">
      <Avatar className="integration-settings-list__logo">
        {item.logo && <AvatarImage src={item.logo.src} alt={item.logo.alt ?? ''} />}
        <AvatarFallback className="integration-settings-list__logo-fallback" aria-hidden="true">
          {item.icon ?? item.title.slice(0, 1)}
        </AvatarFallback>
      </Avatar>
      <div className="integration-settings-list__copy">
        <span className="integration-settings-list__item-title">{item.title}</span>
        {item.description && <div className="integration-settings-list__description">{item.description}</div>}
        {item.disabledReason && <p className="integration-settings-list__reason">{item.disabledReason}</p>}
      </div>
    </div>
    <div className="integration-settings-list__tools">
      {item.status && <Badge variant="outline" className="integration-settings-list__status" data-tone={item.status.tone ?? 'muted'}>
        <span className="integration-settings-list__dot" aria-hidden="true" />{item.status.label}
      </Badge>}
      {actions.length > 0 && <DropdownMenu modal={false} open={menuOpen} onOpenChange={open => {
        if (!open || !pending && !disabled) setMenuOpen(open);
      }}>
        <DropdownMenuTrigger asChild>
          <Button ref={buttonRef} type="button" size="icon-sm" variant="outline"
            aria-label={`Actions for ${item.title}`} disabled={pending || disabled}
            onPointerDown={() => { origin.current = 'dropdown'; }} onKeyDown={() => { origin.current = 'dropdown'; }}>
            <Ellipsis aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <IntegrationSettingsMenu kind="dropdown" actions={actions} pending={pending}
          onSelect={request} onCloseAutoFocus={closeMenuFocus} />
      </DropdownMenu>}
    </div>
    {pending && !confirmation && <p role="status" className="integration-settings-list__row-feedback">Working…</p>}
    {error && !confirmation && <p role="alert" className="integration-settings-list__error integration-settings-list__row-feedback">{error}</p>}
  </li>;
  return <>
    {contextMenu && actions.length ? <ContextMenu modal={false}>
      <ContextMenuTrigger asChild disabled={disabled || pending}>{row}</ContextMenuTrigger>
      <IntegrationSettingsMenu kind="context" actions={actions} pending={pending}
        onSelect={request} onCloseAutoFocus={closeMenuFocus} />
    </ContextMenu> : row}
    <IntegrationSettingsConfirmationDialog item={item} action={confirmation} pending={pending} error={error}
      onClose={close} onConfirm={() => { if (confirmationId) run(confirmationId); }} onCloseAutoFocus={restoreFocus} />
  </>;
}
