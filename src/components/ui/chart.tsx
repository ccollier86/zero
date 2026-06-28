'use client';

import * as React from 'react';
import { ResponsiveContainer, Tooltip, Legend } from 'recharts';

import { cn } from '@/lib/utils';

// ─── Chart Config ────────────────────────────────────────────────────────────

type ChartConfig = Record<
  string,
  {
    label?: React.ReactNode;
    icon?: React.ComponentType;
    color?: string;
    theme?: Record<string, string>;
  }
>;

type ChartContextProps = {
  config: ChartConfig;
};

const ChartContext = React.createContext<ChartContextProps | null>(null);

function useChart() {
  const context = React.useContext(ChartContext);
  if (!context) {
    throw new Error('useChart must be used within a <ChartContainer />');
  }
  return context;
}

// ─── ChartContainer ──────────────────────────────────────────────────────────

type ChartContainerProps = React.ComponentProps<'div'> & {
  config: ChartConfig;
  children: React.ComponentProps<typeof ResponsiveContainer>['children'];
};

function ChartContainer({
  id,
  className,
  children,
  config,
  ...props
}: ChartContainerProps) {
  const uniqueId = React.useId();
  const chartId = `chart-${id || uniqueId.replace(/:/g, '')}`;

  return (
    <ChartContext.Provider value={{ config }}>
      <div
        data-slot="chart"
        data-chart={chartId}
        className={cn(
          "[&_.recharts-cartesian-axis-tick_text]:fill-muted-foreground [&_.recharts-cartesian-grid_line[stroke='#ccc']]:stroke-border/50 flex aspect-video justify-center text-xs [&_.recharts-dot[stroke='#fff']]:stroke-transparent [&_.recharts-layer]:outline-hidden [&_.recharts-polar-grid_[stroke='#ccc']]:stroke-border [&_.recharts-radial-bar-background-sector]:fill-muted [&_.recharts-rectangle.recharts-tooltip-cursor]:fill-muted [&_.recharts-reference-line_[stroke='#ccc']]:stroke-border [&_.recharts-sector[stroke='#fff']]:stroke-transparent [&_.recharts-sector]:outline-hidden [&_.recharts-surface]:outline-hidden",
          className,
        )}
        {...props}
      >
        <ChartStyle id={chartId} config={config} />
        <ResponsiveContainer>{children}</ResponsiveContainer>
      </div>
    </ChartContext.Provider>
  );
}

// ─── ChartStyle ──────────────────────────────────────────────────────────────

function ChartStyle({ id, config }: { id: string; config: ChartConfig }) {
  const colorConfig = Object.entries(config).filter(([, c]) => c.color || c.theme);

  if (!colorConfig.length) return null;

  return (
    <style
      dangerouslySetInnerHTML={{
        __html: `
[data-chart="${id}"] {
${colorConfig
  .map(([key, itemConfig]) => {
    const color = itemConfig.color ?? itemConfig.theme?.['dark'] ?? '';
    return color ? `  --color-${key}: ${color};` : null;
  })
  .filter(Boolean)
  .join('\n')}
}
`,
      }}
    />
  );
}

// ─── ChartTooltip ────────────────────────────────────────────────────────────

const ChartTooltip = Tooltip;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PayloadItem = Record<string, any>;

type ChartTooltipContentProps = React.ComponentProps<'div'> & {
  active?: boolean;
  payload?: PayloadItem[];
  label?: string;
  hideLabel?: boolean;
  hideIndicator?: boolean;
  indicator?: 'line' | 'dot' | 'dashed';
  nameKey?: string;
  labelKey?: string;
  labelFormatter?: (label: string, payload: PayloadItem[]) => React.ReactNode;
  formatter?: (
    value: unknown,
    name: string,
    item: PayloadItem,
    index: number,
    payload: PayloadItem,
  ) => React.ReactNode;
};

function ChartTooltipContent({
  active,
  payload,
  className,
  indicator = 'dot',
  hideLabel = false,
  hideIndicator = false,
  label,
  labelFormatter,
  nameKey,
  formatter,
}: ChartTooltipContentProps) {
  const { config } = useChart();

  if (!active || !payload?.length) return null;

  const tooltipLabel = hideLabel
    ? null
    : labelFormatter
      ? labelFormatter(String(label), payload)
      : label;

  return (
    <div
      className={cn(
        'grid min-w-[8rem] items-start gap-1.5 rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl',
        className,
      )}
    >
      {tooltipLabel && (
        <div className="font-medium">{tooltipLabel}</div>
      )}
      <div className="grid gap-1.5">
        {payload.map((item, index) => {
          const key = String(nameKey ? item[nameKey] : item.dataKey ?? item.name);
          const itemConfig = config[key] ?? {};
          const indicatorColor =
            item.fill !== 'none'
              ? (item.fill as string)
              : (item.color as string) || (item.stroke as string);

          return (
            <div
              key={`${key}-${index}`}
              className="flex w-full flex-wrap items-center gap-1.5 [&>svg]:size-2.5 [&>svg]:text-muted-foreground"
            >
              {!hideIndicator && (
                <div
                  className={cn(
                    'shrink-0 rounded-[2px] border-(--color-border)',
                    indicator === 'dot' && 'size-2.5',
                    indicator === 'line' && 'h-0.5 w-3.5',
                    indicator === 'dashed' && 'h-0.5 w-3.5 border-dashed',
                  )}
                  style={{
                    backgroundColor: indicatorColor,
                    borderColor: indicatorColor,
                  }}
                />
              )}
              {itemConfig.icon && <itemConfig.icon />}
              <div className="flex flex-1 items-baseline justify-between gap-2 leading-none">
                <span className="text-muted-foreground">
                  {(itemConfig.label || key) as React.ReactNode}
                </span>
                <span className="font-mono font-medium tabular-nums text-foreground">
                  {formatter
                    ? formatter(item.value, key, item, index, item.payload)
                    : typeof item.value === 'number'
                      ? item.value.toLocaleString()
                      : String(item.value ?? '')}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── ChartLegend ─────────────────────────────────────────────────────────────

const ChartLegend = Legend;

type ChartLegendContentProps = React.ComponentProps<'div'> & {
  payload?: PayloadItem[];
  hideIcon?: boolean;
  nameKey?: string;
};

function ChartLegendContent({
  className,
  hideIcon = false,
  payload,
  nameKey,
}: ChartLegendContentProps) {
  const { config } = useChart();

  if (!payload?.length) return null;

  return (
    <div className={cn('flex items-center justify-center gap-4', className)}>
      {payload.map((item) => {
        const key = String(nameKey ? item[nameKey] : (item.dataKey ?? item.value));
        const itemConfig = config[key] ?? {};

        return (
          <div
            key={key}
            className="flex items-center gap-1.5 [&>svg]:size-3 [&>svg]:text-muted-foreground"
          >
            {!hideIcon && (
              itemConfig.icon ? (
                <itemConfig.icon />
              ) : (
                <div
                  className="size-2 shrink-0 rounded-[2px]"
                  style={{ backgroundColor: item.color as string }}
                />
              )
            )}
            <span className="text-muted-foreground">
              {(itemConfig.label || key) as React.ReactNode}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
  ChartStyle,
  useChart,
  type ChartConfig,
};
