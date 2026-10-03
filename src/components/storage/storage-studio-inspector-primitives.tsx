'use client';

/** Shared visual primitives for the focused drive and file inspectors. */

import * as React from 'react';
import { Badge } from '../ui/badge';
import { TabsList, TabsTrigger } from '../animate-ui/components/radix/tabs';
import { cn } from '../../lib/utils';

export function StorageInspectorHeader({
  icon,
  title,
  subtitle,
  badges,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  badges: readonly string[];
}) {
  return (
    <div className="flex shrink-0 items-start gap-3 border-b border-border/85 p-4">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-border/80 bg-muted/45 text-primary">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <h3 className="truncate text-sm font-semibold">{title}</h3>
        <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
      </div>
      <div className="flex shrink-0 flex-wrap justify-end gap-1">
        {badges.map((badge) => (
          <Badge
            key={badge}
            variant={badge === 'failed' ? 'destructive' : badge === 'degraded' || badge === 'suspended' ? 'warning' : 'outline'}
            className="px-1.5 py-0 text-[10px] capitalize"
          >
            {badge}
          </Badge>
        ))}
      </div>
    </div>
  );
}
export function StorageInspectorTabs({ labels }: { labels: readonly string[] }) {
  return (
    <div className="shrink-0 overflow-x-auto border-b border-border/85 px-3 py-2">
      <TabsList className="w-max min-w-full">
        {labels.map((label) => (
          <TabsTrigger key={label} value={label} className="capitalize">
            {label}
          </TabsTrigger>
        ))}
      </TabsList>
    </div>
  );
}

export function StorageInspectorSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h4 className="text-sm font-semibold">{title}</h4>
      {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

export function StorageInspectorRows({
  rows,
}: {
  rows: readonly (readonly [string, React.ReactNode])[];
}) {
  return (
    <dl className="divide-y divide-border/70 rounded-lg border border-border/80">
      {rows.map(([label, value]) => (
        <div key={label} className="grid grid-cols-[minmax(5rem,0.75fr)_minmax(0,1.25fr)] gap-3 px-3 py-2 text-xs">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="min-w-0 break-words text-right font-medium">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function StorageCapability({ label, enabled }: { label: string; enabled: boolean }) {
  return (
    <div className={cn(
      'rounded-lg border px-3 py-2 text-xs',
      enabled ? 'border-primary/25 bg-primary/5 text-foreground' : 'border-border/70 bg-muted/25 text-muted-foreground',
    )}>
      <span className={cn('mr-1.5 inline-block size-1.5 rounded-full', enabled ? 'bg-success' : 'bg-muted-foreground/40')} />
      {label}
    </div>
  );
}

export function StorageInspectorEmpty({
  label,
  compact = false,
}: {
  label: string;
  compact?: boolean;
}) {
  return (
    <div className={cn(
      'flex items-center justify-center rounded-lg border border-dashed border-border px-4 text-center text-xs text-muted-foreground',
      compact ? 'min-h-16' : 'min-h-40',
    )}>
      {label}
    </div>
  );
}

export function capitalizeStorageLabel(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function formatStorageInspectorDate(value: number): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}
