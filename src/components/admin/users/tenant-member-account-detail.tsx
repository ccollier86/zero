'use client';

import type { AuthAdminConfig, AuthAdminUserMfaStatus } from '../../../frontend/client/auth-client';
import { Badge } from '../../ui/badge';
import { Button } from '../../ui/button';
import { UserManagementPropertiesForm } from './user-management-properties-form';
import { UserManagementSecurityPanel } from './user-management-security-panel';
import type { UserManagementUser } from './user-management-types';

export interface TenantMemberAccountDetailProps {
  user: UserManagementUser | null;
  config: AuthAdminConfig | null;
  loading: boolean;
  error: string | null;
  mfaStatus: AuthAdminUserMfaStatus | null;
  mfaLoading: boolean;
  mfaError: string | null;
  canManage: boolean;
  onRetry(): void;
  onUpdateProperties(properties: Record<string, unknown>): Promise<void>;
  onDeleteProperty?(key: string): Promise<void>;
}

/** Account-scoped information composed below tenant membership and roles. */
export function TenantMemberAccountDetail({
  user,
  config,
  loading,
  error,
  mfaStatus,
  mfaLoading,
  mfaError,
  canManage,
  onRetry,
  onUpdateProperties,
  onDeleteProperty,
}: TenantMemberAccountDetailProps) {
  if (loading && !user) {
    return <p className="text-sm text-muted-foreground" role="status">Loading account controls…</p>;
  }
  if (error && !user) {
    return (
      <div className="flex items-center justify-between gap-3 text-sm" role="alert">
        <span className="text-destructive">{error}</span>
        <Button type="button" size="sm" variant="outline" onClick={onRetry}>Retry</Button>
      </div>
    );
  }
  if (!user || !config) return null;

  return (
    <section aria-labelledby={`account-${user.userId}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={`account-${user.userId}`} className="text-sm font-semibold">Account</h3>
        <Badge variant={user.status === 'active' ? 'secondary' : 'warning'}>
          {user.status}
        </Badge>
      </div>
      <dl className="mt-2 grid gap-x-4 gap-y-3 text-sm sm:grid-cols-2">
        <AccountValue label="Global identity role" value={user.role} />
        <AccountValue label="Created" value={formatAccountDate(user.createdAt)} />
        <AccountValue
          label="Last updated"
          value={user.updatedAt === null ? 'Not recorded' : formatAccountDate(user.updatedAt)}
        />
        <AccountValue label="Account ID" value={user.userId} mono />
      </dl>
      <UserManagementSecurityPanel
        user={user}
        mfaStatus={mfaStatus}
        loading={mfaLoading}
        error={mfaError}
      />
      {canManage && config.capabilities.userProperties && (
        <UserManagementPropertiesForm
          key={user.userId}
          user={user}
          config={config}
          onSubmit={onUpdateProperties}
          onDeleteProperty={onDeleteProperty}
        />
      )}
    </section>
  );
}

function AccountValue({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className={mono ? 'mt-0.5 truncate font-mono text-xs' : 'mt-0.5 truncate'} title={value}>
        {value}
      </dd>
    </div>
  );
}

/** @internal Stable UTC formatting keeps server and browser markup aligned. */
export function formatAccountDate(timestamp: number): string {
  if (!Number.isFinite(timestamp)) return 'Unknown';
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}
