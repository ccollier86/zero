/** Card-family native composition and optional title/body type roles; callers own heading semantics, content and layout overrides. */
import * as React from "react"
import { Slot } from "radix-ui"

import { cn } from "#zero/lib/utils"

export type CardDensity = 'compact' | 'default' | 'comfortable';
export interface CardProps extends React.ComponentProps<'div'> { asChild?: boolean; density?: CardDensity }

function Card({ className, asChild = false, density, style, ...props }: CardProps) {
  const Comp: React.ElementType = asChild ? Slot.Root : 'div';
  const densityStyle = density ? { '--zero-card-padding': `var(--zero-theme-card-padding-${density},${density === 'compact' ? '1rem' : density === 'comfortable' ? '1.5rem' : '1.25rem'})` } as React.CSSProperties : undefined;
  return (
    <Comp
      data-slot="card"
      data-zero-card-density={density}
      className={cn(
        "rounded-[var(--zero-card-radius,var(--zero-theme-card-radius,var(--radius-lg,.5rem)))] border border-border/85 bg-card text-card-foreground shadow-xs dark:shadow-none",
        className
      )}
      {...props}
      style={densityStyle ? { ...densityStyle, ...style } : style}
    />
  )
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn("flex flex-col gap-[var(--zero-card-header-gap,.375rem)] p-[var(--zero-card-padding,1.25rem)] has-[[data-slot=card-action]]:grid has-[[data-slot=card-action]]:grid-cols-[minmax(0,1fr)_auto]", className)}
      {...props}
    />
  )
}

function CardTitle({
  asChild = false,
  className,
  ...props
}: React.ComponentProps<"div"> & { asChild?: boolean }) {
  const Comp: React.ElementType = asChild ? Slot.Root : "div"

  return (
    <Comp
      data-slot="card-title"
      className={cn("col-start-1 min-w-0 text-[length:var(--zero-type-section-size,inherit)] font-[family-name:var(--zero-theme-font-body,inherit)] font-[number:var(--zero-type-section-weight,var(--font-weight-semibold,600))] leading-[var(--zero-type-section-leading,var(--leading-snug,1.375))] tracking-[var(--zero-type-section-tracking,var(--tracking-normal,0em))]", className)}
      {...props}
    />
  )
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-description"
      className={cn("col-start-1 min-w-0 text-[length:var(--zero-type-body-size,var(--text-sm,.875rem))] leading-[var(--zero-type-body-leading,var(--text-sm--line-height,1.4285714286))] font-[family-name:var(--zero-theme-font-body,inherit)] font-[number:var(--zero-type-body-weight,inherit)] tracking-[var(--zero-type-body-tracking,inherit)] text-muted-foreground", className)}
      {...props}
    />
  )
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-content"
      className={cn("p-[var(--zero-card-padding,1.25rem)] pt-0", className)}
      {...props}
    />
  )
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn("flex items-center p-[var(--zero-card-padding,1.25rem)] pt-0", className)}
      {...props}
    />
  )
}

/** Native custom action slot; header composition reserves a separate column automatically. */
function CardAction({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="card-action" className={cn('relative z-[1] col-start-2 row-span-2 row-start-1 flex shrink-0 items-center gap-[var(--zero-card-gap,var(--zero-theme-card-gap,.75rem))] self-start', className)} {...props} />;
}

/** Media remains caller-owned markup (image/video/custom graphic); sizing and clip are tokenized. */
function CardMedia({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="card-media" className={cn('relative grid min-h-[var(--zero-card-media-min-height,var(--zero-theme-card-media-min-height,7rem))] place-items-center overflow-hidden bg-muted [&>img]:h-full [&>img]:w-full [&>img]:object-cover', className)} {...props} />;
}

export interface CardBylineProps extends React.ComponentProps<'div'> { avatar?: React.ReactNode }
function CardByline({ className, avatar, children, ...props }: CardBylineProps) {
  return <div data-slot="card-byline" className={cn('flex min-w-0 flex-1 items-center gap-[var(--zero-card-gap,var(--zero-theme-card-gap,.75rem))]', className)} {...props}>
    {avatar != null && <span data-slot="card-avatar" className="grid size-8 shrink-0 place-items-center overflow-hidden rounded-full bg-muted [&>*]:h-full [&>*]:w-full [&>*]:object-cover">{avatar}</span>}
    <div className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)]">{children}</div>
  </div>;
}
function CardMeta({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="card-meta" className={cn('truncate text-[length:var(--zero-type-caption-size,var(--text-xs,.75rem))] font-[family-name:var(--zero-theme-font-body,inherit)] font-medium leading-[var(--zero-type-caption-leading,1.5)]', className)} {...props} />;
}
function CardSection({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="card-section" className={cn('border-t border-border p-[var(--zero-card-padding,1.25rem)] text-[length:var(--zero-type-body-size,var(--text-sm,.875rem))] leading-[var(--zero-type-body-leading,1.5)]', className)} {...props} />;
}

export { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle, CardAction, CardMedia, CardByline, CardMeta, CardSection }
export { CardStatus, type CardStatusProps } from './card-status';
