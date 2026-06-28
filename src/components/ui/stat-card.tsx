'use client';

import * as React from 'react';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { SlidingNumber } from '@/components/animate-ui/primitives/texts/sliding-number';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface StatCardProps {
  label: string;
  value: number;
  /** Prefix shown before the number (e.g. "$") */
  prefix?: string;
  /** Suffix shown after the number (e.g. "%", "ms") */
  suffix?: string;
  /** Trend indicator */
  trend?: {
    value: number;
    direction: 'up' | 'down' | 'flat';
  };
  /** Icon displayed in the top-right corner */
  icon?: React.ReactNode;
  /** Decimal places for the value. Default: 0 */
  decimalPlaces?: number;
  className?: string;
}

// ─── Component ──────────────────────────────────────────────────────────────

const TREND_STYLES = {
  up: 'text-emerald-600 dark:text-emerald-400',
  down: 'text-red-600 dark:text-red-400',
  flat: 'text-muted-foreground',
} as const;

const TREND_ICONS = {
  up: TrendingUp,
  down: TrendingDown,
  flat: Minus,
} as const;

function StatCard({
  label,
  value,
  prefix,
  suffix,
  trend,
  icon,
  decimalPlaces = 0,
  className,
}: StatCardProps) {
  const TrendIcon = trend ? TREND_ICONS[trend.direction] : null;

  return (
    <Card data-slot="stat-card" className={cn('relative overflow-hidden', className)}>
      <CardContent className="p-6">
        {/* Header row: label + icon */}
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-muted-foreground">{label}</p>
          {icon && (
            <span className="text-muted-foreground/60">{icon}</span>
          )}
        </div>

        {/* Value */}
        <div className="mt-2 flex items-baseline gap-1">
          {prefix && <span className="text-2xl font-bold">{prefix}</span>}
          <SlidingNumber
            number={value}
            decimalPlaces={decimalPlaces}
            className="text-2xl font-bold tabular-nums"
          />
          {suffix && <span className="text-sm font-medium text-muted-foreground">{suffix}</span>}
        </div>

        {/* Trend */}
        {trend && TrendIcon && (
          <div className={cn('mt-2 flex items-center gap-1 text-xs font-medium', TREND_STYLES[trend.direction])}>
            <TrendIcon size={14} />
            <span>{trend.direction === 'down' ? '' : '+'}{trend.value}%</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export { StatCard };
