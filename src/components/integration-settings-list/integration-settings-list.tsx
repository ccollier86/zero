'use client';

/** Controlled grouped settings layout; callbacks remain app-owned and scope-fenced. */
import { useEffect, useId, useRef } from 'react';
import { Plus } from '../animate-ui/icons/plus';
import { cn } from '../../lib/utils';
import { Button } from '../ui/button';
import { useClientMaybe } from '../../frontend/client/client-context';
import type { InternalClient } from '../../frontend/client/sdk';
import {
  useAuthorizationScopeBoundary, readAuthorizationScopeBoundaryKey,
  isAuthorizationDataReady, isAuthorizationScopeReady,
} from '../../frontend/client/authorization-scope-hooks';
import { IntegrationSettingsRow } from './integration-settings-row';
import { integrationSettingsDisabled, integrationSettingsGroups } from './integration-settings-list-policy';
import { reportIntegrationSettingsActionError, useIntegrationSettingsAction } from './use-integration-settings-action';
import type { IntegrationSettingsListProps } from './integration-settings-list.types';

export interface IntegrationSettingsListOwner {
  readonly props: IntegrationSettingsListProps;
  readonly current: () => boolean;
}

/** Render flat rows or named groups without inventing integration or identity services. */
export function IntegrationSettingsList(props: IntegrationSettingsListProps) {
  const client = useClientMaybe();
  const boundary = useAuthorizationScopeBoundary(client);
  const current = useRef({ props, client }); current.current = { props, client };
  integrationSettingsGroups(props);
  const capturedKey = boundary.key;
  const capturedOperationKey = props.operationScopeKey;
  const capturedReadOnly = Boolean(props.readOnly);
  const owner: IntegrationSettingsListOwner = {
    get props() { return current.current.props; },
    current() {
      if (current.current.client !== client
        || !Object.is(current.current.props.operationScopeKey, capturedOperationKey)
        || Boolean(current.current.props.readOnly) !== capturedReadOnly) return false;
      const internal = client as InternalClient | null, auth = internal?.auth ?? null;
      const revision = internal?._authorizationDataBoundary.revision ?? 0;
      return readAuthorizationScopeBoundaryKey(auth, revision) === capturedKey
        && (!auth || isAuthorizationScopeReady(auth.sessionTransition, auth.isRestoring)
          && isAuthorizationDataReady(revision, auth.authorizationState.status, auth.isAuthenticated));
    },
  };
  if (!boundary.ready) {
    return <section className={cn('integration-settings-list', props.className)}
      aria-busy="true"><p role="status">Updating secure access…</p></section>;
  }
  return <IntegrationSettingsListContent
    key={JSON.stringify([boundary.key, props.operationScopeKey, capturedReadOnly])} props={props} owner={owner} />;
}

function IntegrationSettingsListContent({ props, owner }: {
  props: IntegrationSettingsListProps; owner: IntegrationSettingsListOwner;
}) {
  const titleId = useId();
  const {
    items: _items, groups: _groups, title, description, primaryAction, emptyMessage,
    operationScopeKey: _operationScopeKey, contextMenu, onActionError: _onActionError, readOnly, readOnlyReason,
    className, ...sectionProps
  } = props;
  const groups = integrationSettingsGroups(props);
  return <section {...sectionProps} className={cn('integration-settings-list', className)}
    aria-labelledby={title ? titleId : sectionProps['aria-labelledby']}>
    {(title || description || primaryAction) && <header className="integration-settings-list__header">
      <div className="integration-settings-list__heading">
        {title && <h2 id={titleId} className="integration-settings-list__title">{title}</h2>}
        {description && <div className="integration-settings-list__description">{description}</div>}
      </div>
      {primaryAction && <PrimaryAction owner={owner} />}
    </header>}
    {readOnly && <p className="integration-settings-list__reason">{readOnlyReason ?? 'Read-only connections'}</p>}
    <div className="integration-settings-list__groups">
      {groups.map(group => <section key={JSON.stringify([props.groups ? 'group' : 'flat', group.id])}
        className={props.groups ? 'integration-settings-list__group' : 'integration-settings-list__flat'}>
        {props.groups && (group.title || group.description) && <header className="integration-settings-list__group-header">
          {group.title && <h3 className="integration-settings-list__group-title">{group.title}</h3>}
          {group.description && <div className="integration-settings-list__description">{group.description}</div>}
        </header>}
        {group.items.length ? <ul className="integration-settings-list__rows">
          {group.items.map(item => <IntegrationSettingsRow
            key={JSON.stringify([item.id, item.revision])} item={item} groupId={group.id}
            owner={owner} contextMenu={contextMenu ?? false} />)}
        </ul> : <p className="integration-settings-list__empty">{group.emptyMessage ?? emptyMessage ?? 'No connections yet.'}</p>}
      </section>)}
      {!groups.length && <p className="integration-settings-list__empty">{emptyMessage ?? 'No connections yet.'}</p>}
    </div>
  </section>;
}

function PrimaryAction({ owner }: { owner: IntegrationSettingsListOwner }) {
  const action = owner.props.primaryAction!;
  const { session, pending, error } = useIntegrationSettingsAction();
  const allowed = () => owner.current() && Boolean(owner.props.primaryAction)
    && !owner.props.readOnly && !integrationSettingsDisabled(owner.props.primaryAction!);
  const disabled = Boolean(owner.props.readOnly) || integrationSettingsDisabled(action);
  useEffect(() => { if (disabled) session.invalidate(); }, [disabled, session]);
  const run = () => {
    void session.run({
      isCurrent: allowed,
      onSelect: signal => owner.props.primaryAction!.onSelect({ signal }),
      onFailed: cause => reportIntegrationSettingsActionError(cause,
        { itemId: null, groupId: null, actionId: null }, owner.props.onActionError),
    });
  };
  return <div className="integration-settings-list__primary">
    <Button type="button" size="sm" className="integration-settings-list__new" disabled={pending || disabled}
      aria-busy={pending || undefined} onClick={run}>
      {action.icon === undefined ? <Plus aria-hidden="true" /> : action.icon}
      {pending ? 'Working…' : action.label ?? 'New Connection'}
    </Button>
    {action.disabledReason && <p className="integration-settings-list__reason">{action.disabledReason}</p>}
    {pending && <span role="status" className="sr-only">Creating connection…</span>}
    {error && <p role="alert" className="integration-settings-list__error">{error}</p>}
  </div>;
}
