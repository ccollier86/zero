/** Shared select presentation with optional trigger/menu type roles; Radix owns selection, focus and dismissal. */
'use client';

import * as React from "react"
import { Select as SelectPrimitive } from "radix-ui"
import { Check, ChevronDown, ChevronUp } from "lucide-react"

import { cn } from "#zero/lib/utils"
import { useOwnedFloatingOverlay, useOverlayTheme, composeOverlayRefs } from '../../overlays/overlay-scope'
import { ScrollViewportDecoration, type ScrollViewportDecorationProps } from '../../overlays/scroll-viewport-decoration'
import { useSelectMorphMotion, type SelectVisualSource } from './select-morph-motion'
import { useSelectMagnetic } from './select-magnetic'
import { selectPaintCopy } from './select-paint'
import './select-morph.css'

/** Source identity only; Radix still owns value, opening, focus, typeahead and form behavior. */
const SelectSourceContext = React.createContext<{
  trigger: HTMLButtonElement | null
  setTrigger: React.Dispatch<React.SetStateAction<HTMLButtonElement | null>>
  visual: SelectVisualSource
} | null>(null)

function Select(props: React.ComponentProps<typeof SelectPrimitive.Root>) {
  const [trigger, setTrigger] = React.useState<HTMLButtonElement | null>(null)
  const visual = React.useRef<SelectVisualSource>({ trigger: null, open: props.open ?? props.defaultOpen ?? false, alive: true, picked: null, cancelPaint: null }).current
  visual.trigger = trigger
  if (props.open !== undefined) visual.open = props.open
  React.useLayoutEffect(() => {
    visual.alive = true
    return () => { visual.alive = false; visual.cancelPaint?.(); visual.picked = null }
  }, [visual])
  const source = React.useMemo(() => ({ trigger, setTrigger, visual }), [trigger, visual])
  return <SelectSourceContext.Provider value={source}><SelectPrimitive.Root {...props} onOpenChange={open => {
    visual.open = open
    if (open) { visual.cancelPaint?.(); visual.picked = null }
    props.onOpenChange?.(open)
  }} /></SelectSourceContext.Provider>
}
Select.displayName = SelectPrimitive.Root.displayName
const SelectGroup = SelectPrimitive.Group
function SelectValue(props: React.ComponentProps<typeof SelectPrimitive.Value>) {
  return <SelectPrimitive.Value data-slot="select-value" {...props} />
}

function SelectTrigger({
  className,
  children,
  ref,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger>) {
  const setTrigger = React.useContext(SelectSourceContext)?.setTrigger
  const triggerRef = React.useMemo(() => composeOverlayRefs<HTMLButtonElement>(setTrigger, ref), [setTrigger, ref])
  return (
    <SelectPrimitive.Trigger
      ref={triggerRef}
      data-slot="select-trigger"
      className={cn(
        "zero-select-trigger flex w-full items-center justify-between gap-2 border border-border/85 bg-popover text-popover-foreground text-[length:var(--zero-type-control-size,var(--text-sm,.875rem))] leading-[var(--zero-type-control-leading,var(--text-sm--line-height,1.4285714286))] font-[family-name:var(--zero-theme-font-body,inherit)] font-[number:var(--zero-type-control-weight,inherit)] tracking-[var(--zero-type-control-tracking,inherit)] shadow-xs transition-[border-color,box-shadow,color] outline-none whitespace-nowrap placeholder:text-muted-foreground hover:border-border disabled:cursor-not-allowed disabled:opacity-50 [&>span]:line-clamp-1",
        "focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30",
        "aria-invalid:border-destructive aria-invalid:ring-destructive/20",
        className
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDown className="size-4 opacity-70" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  )
}

function SelectScrollUpButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollUpButton>) {
  return (
    <SelectPrimitive.ScrollUpButton
      className={cn("zero-select-scroll-button flex cursor-default items-center justify-center py-1", className)}
      {...props}
    >
      <ChevronUp className="size-4" />
    </SelectPrimitive.ScrollUpButton>
  )
}

function SelectScrollDownButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollDownButton>) {
  return (
    <SelectPrimitive.ScrollDownButton
      className={cn("zero-select-scroll-button flex cursor-default items-center justify-center py-1", className)}
      {...props}
    >
      <ChevronDown className="size-4" />
    </SelectPrimitive.ScrollDownButton>
  )
}

export interface SelectContentProps extends React.ComponentProps<typeof SelectPrimitive.Content> {
  /** The exact native Radix viewport, never a nested ScrollArea. */
  viewportRef?: React.Ref<HTMLDivElement>
  fadeEdges?: boolean
  scrollbars?: ScrollViewportDecorationProps['scrollbars']
}

function SelectContent({
  className,
  children,
  position = "popper",
  ref,
  style,
  viewportRef,
  fadeEdges = true,
  scrollbars = 'hover',
  sideOffset,
  ...props
}: SelectContentProps) {
  const floating = useOwnedFloatingOverlay()
  const source = React.useContext(SelectSourceContext)
  const projectedTheme = useOverlayTheme(source?.trigger ?? null)
  // A parent Popper's geometry is not a theme and must not shadow this Select's own placement.
  const sourceTheme = React.useMemo(() => Object.fromEntries(Object.entries(projectedTheme).filter(([name]) => !name.startsWith('--radix-') && name !== '--zero-anchored-presence')), [projectedTheme])
  const orphanVisual = React.useRef<SelectVisualSource>({ trigger: null, open: true, alive: true, picked: null, cancelPaint: null }).current
  const motionRef = useSelectMorphMotion({ source: source?.visual ?? orphanVisual, active: floating.owner?.active ?? true,
    container: floating.owner?.container, popper: position === 'popper' })
  const contentRef = React.useMemo(() => composeOverlayRefs<HTMLDivElement>(motionRef, floating.ref, ref), [motionRef, floating.ref, ref])
  const [viewport, setViewport] = React.useState<HTMLDivElement | null>(null)
  const captureViewport = React.useCallback((element: HTMLDivElement | null) => { setViewport(element?.isConnected ? element : null) }, [])
  const nativeViewportRef = React.useMemo(() => composeOverlayRefs<HTMLDivElement>(captureViewport, viewportRef), [captureViewport, viewportRef])
  useSelectMagnetic(viewport)
  const [triggerHeight, setTriggerHeight] = React.useState(0)
  React.useLayoutEffect(() => {
    if (!source?.trigger) return
    const update = () => setTriggerHeight(source.trigger!.getBoundingClientRect().height)
    update(); const observer = new ResizeObserver(update); observer.observe(source.trigger)
    return () => observer.disconnect()
  }, [source?.trigger])
  return (
    <SelectPrimitive.Portal container={floating.owner?.container}>
      <SelectPrimitive.Content
        {...floating.contentProps}
        ref={contentRef}
        data-slot="select-content"
        data-zero-select-position={position}
        className={cn(
          "zero-select-content relative z-50 min-w-[8rem] overflow-hidden border border-border/85 bg-popover text-popover-foreground",
          className
        )}
        position={position}
        sideOffset={sideOffset ?? (position === 'popper' ? -triggerHeight : undefined)}
        {...props}
        inert={floating.owner && !floating.owner.active ? true : props.inert}
        style={{ ...floating.contentProps.style, ...sourceTheme, ...style,
          ...(floating.owner ? { zIndex: floating.owner.zIndex + 2,
            ...(!floating.owner.active ? { pointerEvents: 'none' as const } : {}) } : {}) }}
      >
        {position === 'popper' && <div className="zero-select-lid" aria-hidden="true" inert><span className="zero-select-lid-label" /><ChevronUp className="size-4 opacity-70" /></div>}
        <SelectScrollUpButton />
        <SelectPrimitive.Viewport
          ref={nativeViewportRef}
          className="zero-select-viewport"
        >
          {children}
        </SelectPrimitive.Viewport>
        <SelectScrollDownButton />
        <ScrollViewportDecoration viewport={viewport} fadeEdges={fadeEdges} scrollbars={scrollbars} />
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  )
}

function SelectLabel({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Label>) {
  return (
    <SelectPrimitive.Label
      data-slot="select-label"
      className={cn("px-2 py-1.5 text-[length:var(--zero-type-navigation-size,var(--text-sm,.875rem))] leading-[var(--zero-type-navigation-leading,var(--text-sm--line-height,1.4285714286))] font-[family-name:var(--zero-theme-font-body,inherit)] font-[number:var(--zero-type-label-weight,var(--font-weight-semibold,600))] tracking-[var(--zero-type-navigation-tracking,inherit)]", className)}
      {...props}
    />
  )
}

export interface SelectItemProps extends React.ComponentProps<typeof SelectPrimitive.Item> {
  /** Presentational icon/avatar; the native ItemText remains the title and typeahead source. */
  leading?: React.ReactNode
  description?: React.ReactNode
  /** Presentational metadata/badge, not independent controls. */
  trailing?: React.ReactNode
}

function SelectItem({
  className,
  children,
  leading,
  description,
  trailing,
  ref,
  onPointerUp,
  onKeyDown,
  'aria-describedby': describedBy,
  ...props
}: SelectItemProps) {
  const visual = React.useContext(SelectSourceContext)?.visual
  const element = React.useRef<HTMLDivElement | null>(null)
  const itemRef = React.useMemo(() => composeOverlayRefs<HTMLDivElement>(element, ref), [ref])
  const descriptionId = React.useId()
  const remember = () => {
    const text = element.current?.querySelector<HTMLElement>('[data-zero-select-item-text]')
    if (!visual || props.disabled || !text?.isConnected) return
    visual.picked = { text: text.textContent?.trim() ?? '', rect: text.getBoundingClientRect(), element: selectPaintCopy(text) }
  }
  return (
    <SelectPrimitive.Item
      ref={itemRef}
      data-slot="select-item"
      className={cn(
        "zero-select-item relative flex w-full cursor-default items-center text-[length:var(--zero-type-navigation-size,var(--text-sm,.875rem))] leading-[var(--zero-type-navigation-leading,var(--text-sm--line-height,1.4285714286))] font-[family-name:var(--zero-theme-font-body,inherit)] font-[number:var(--zero-type-navigation-weight,inherit)] tracking-[var(--zero-type-navigation-tracking,inherit)] outline-none select-none",
        "focus:text-accent-foreground",
        "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
      aria-describedby={[describedBy, description != null ? descriptionId : undefined].filter(Boolean).join(' ') || undefined}
      onPointerUp={event => { onPointerUp?.(event); if (!event.defaultPrevented) remember() }}
      onKeyDown={event => { onKeyDown?.(event); if (!event.defaultPrevented && (event.key === 'Enter' || event.key === ' ')) remember() }}
    >
      {leading != null && <span className="zero-select-item-leading" aria-hidden="true">{leading}</span>}
      <span className="zero-select-item-copy">
        <SelectPrimitive.ItemText data-zero-select-item-text="">{children}</SelectPrimitive.ItemText>
        {description != null && <span id={descriptionId} className="zero-select-item-description">{description}</span>}
      </span>
      {trailing != null && <span className="zero-select-item-trailing" aria-hidden="true">{trailing}</span>}
      <span className="zero-select-item-check" aria-hidden="true">
        <SelectPrimitive.ItemIndicator>
          <Check className="size-4" />
        </SelectPrimitive.ItemIndicator>
      </span>
    </SelectPrimitive.Item>
  )
}

function SelectSeparator({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Separator>) {
  return (
    <SelectPrimitive.Separator
      data-slot="select-separator"
      className={cn("-mx-1 my-1 h-px bg-muted", className)}
      {...props}
    />
  )
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
}
