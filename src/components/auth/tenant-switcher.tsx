'use client';

import * as React from 'react';
import {
  useTenantSwitchPresentation,
} from '../../frontend/client/tenant-switch-presentation';
export {
  parseTenantSwitcherHandoff,
  runTenantSwitch,
  type TenantSwitcherHandoff,
} from '../../frontend/client/tenant-switch-presentation';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#zero/components/ui/select';
import { Button } from '#zero/components/ui/button';
import { cn } from '#zero/lib/utils';

export interface TenantSwitcherProps {
  className?: string;
  label?: string;
  onSwitched?: (tenantId: string) => void;
}

/** Refresh-proof-backed active-tenant switcher. */
export function TenantSwitcher({
  className,
  label,
  onSwitched,
}: TenantSwitcherProps) {
  const tenant = useTenantSwitchPresentation({ onSwitched });
  const tenantSingular = tenant.terminology.singular;
  const tenantPlural = tenant.terminology.plural;
  const resolvedLabel = label ?? capitalize(tenantSingular);
  const switcherId = React.useId();
  const triggerId = `${switcherId}-trigger`;
  const errorId = `${switcherId}-error`;
  const triggerRef = React.useRef<HTMLButtonElement | null>(null);
  const activeTenant = tenant.activeTenant;
  const tenants = tenant.tenants;
  const switching = tenant.isSwitching;

  React.useEffect(() => {
    if (tenant.focusRevision < 1) return;
    focusTenantSwitcher(triggerRef);
  }, [tenant.focusRevision]);

  if (!tenant.isAvailable || !activeTenant) return null;

  return (
    <div
      className={cn('grid gap-1.5', className)}
      aria-busy={tenant.isLoading || switching}
    >
      <label className="text-xs font-medium text-muted-foreground" htmlFor={triggerId}>
        {resolvedLabel}
      </label>
      <Select
        value={activeTenant.tenantId}
        onValueChange={(value) => void tenant.switchTenant(value)}
        disabled={tenant.isLoading || switching || tenants.length < 2}
      >
        <SelectTrigger
          ref={triggerRef}
          id={triggerId}
          aria-label={resolvedLabel}
          aria-describedby={tenant.error ? errorId : undefined}
        >
          <SelectValue
            placeholder={tenant.isLoading
              ? `Loading ${tenantPlural}…`
              : resolvedLabel}
          />
        </SelectTrigger>
        <SelectContent>
          {tenants.map((item) => (
            <SelectItem key={item.tenantId} value={item.tenantId}>
              <span>{item.name}</span>
              {item.role && (
                <span className="ml-2 text-xs text-muted-foreground">{item.role}</span>
              )}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {tenant.error && (
        <div className="flex items-center justify-between gap-2">
          <p id={errorId} role="alert" className="text-xs text-destructive">
            {tenant.error}
          </p>
          <Button
            type="button"
            size="xs"
            variant="ghost"
            disabled={tenant.isLoading || switching}
            onClick={tenant.reload}
          >
            Retry
          </Button>
        </div>
      )}
      <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {switching ? `Switching ${tenantSingular}` : tenant.announcement}
      </span>
    </div>
  );
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function focusTenantSwitcher(ref: React.RefObject<HTMLButtonElement | null>): void {
  if (typeof window === 'undefined') return;
  window.requestAnimationFrame(() => {
    if (ref.current?.isConnected) ref.current.focus();
  });
}
