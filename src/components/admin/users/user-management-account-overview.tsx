'use client';

import type { UserManagementUser } from './user-management-types';

export function UserManagementAccountOverview({
  user,
  roleLabel,
}: {
  user: UserManagementUser;
  roleLabel?: string;
}) {
  return (
    <section aria-labelledby={`account-overview-${user.userId}`}>
      <h3 id={`account-overview-${user.userId}`} className="text-sm font-semibold">
        Account information
      </h3>
      <dl className="mt-2 grid gap-x-4 gap-y-3 text-sm sm:grid-cols-2">
        <AccountValue label="Username" value={user.username} />
        <AccountValue label="Email" value={user.email} />
        <AccountValue label="First name" value={user.firstName || 'Not set'} />
        <AccountValue label="Last name" value={user.lastName || 'Not set'} />
        <AccountValue label="Global identity role" value={roleLabel ?? user.role} />
        <AccountValue label="Status" value={user.status} />
        <AccountValue label="Created" value={formatAccountTimestamp(user.createdAt)} />
        <AccountValue
          label="Last updated"
          value={user.updatedAt === null
            ? 'Not recorded'
            : formatAccountTimestamp(user.updatedAt)}
        />
        <AccountValue label="Account ID" value={user.userId} mono />
      </dl>
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

function formatAccountTimestamp(timestamp: number): string {
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
