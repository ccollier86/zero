'use client';
/** Supported tooltip composition: shared tokens/content over existing Radix and group primitives. */
import * as React from 'react';
import {
  TooltipProvider as RadixProvider, Tooltip as RadixTooltip, TooltipTrigger as RadixTrigger,
  TooltipContent as RadixContent, TooltipArrow as RadixArrow, TooltipPortal as RadixPortal, useTooltip, useTooltipProviderSettings,
  type TooltipProviderProps, type TooltipProps, type TooltipTriggerProps,
  type TooltipContentProps as RadixContentProps,
} from '#zero/components/animate-ui/primitives/radix/tooltip';
import {
  TooltipGroup as SharedGroup, useTooltipGroup, GroupTooltip, GroupTooltipTrigger, GroupTooltipContent,
  type TooltipGroupProps,
  type GroupTooltipProps, type GroupTooltipTriggerProps, type GroupTooltipContentProps,
} from '../../../tooltip/tooltip-group';
import { useTooltip as useSharedTooltip, useGlobalTooltip } from '#zero/components/animate-ui/primitives/animate/tooltip';
import { resolveTooltipMotion } from '../../../tooltip/tooltip-motion';
import { TooltipBody, tooltipText } from '../../../tooltip/tooltip-body';
import { cn } from '#zero/lib/utils';

function TooltipProvider(props: TooltipProviderProps) { return <RadixProvider {...props} />; }

/** An explicit group inherits an outer provider unless its own props override it. */
function TooltipGroup(props: TooltipGroupProps) {
  const inherited = useTooltipProviderSettings();
  return <SharedGroup {...inherited} {...props} />;
}

/** An explicit group opts into one sliding surface; ordinary controls keep Radix semantics. */
function Tooltip(props: TooltipProps) {
  const group = useTooltipGroup();
  return group ? <GroupTooltip {...props as GroupTooltipProps} /> : <RadixTooltip {...props} />;
}
function TooltipTrigger(props: TooltipTriggerProps) {
  const group = useTooltipGroup();
  return group ? <GroupTooltipTrigger {...props as GroupTooltipTriggerProps} /> : <RadixTrigger {...props} />;
}
type TooltipContentProps = Omit<RadixContentProps, 'title'> & {
  title?: React.ReactNode;
  description?: React.ReactNode;
  shortcut?: string | readonly string[] | React.ReactNode;
  /** Same-document portal destination; ownership and theme still follow the trigger. */
  container?: HTMLElement | null;
};
function TooltipContent(props: TooltipContentProps) {
  const group = useTooltipGroup();
  return group ? <SharedContent {...props} /> : <StandaloneContent {...props} />;
}
function StandaloneContent({ className, children, title, description, shortcut, container, arrow, ...props }: TooltipContentProps) {
  const { options, trigger, overflowOnly } = useTooltip();
  const showArrow = resolveTooltipMotion(trigger, { ...options, ...(arrow === undefined ? {} : { arrow }) }).arrow;
  const fallback = children ?? (title == null && description == null ? trigger?.textContent?.trim() : undefined);
  const accessible = props['aria-label'] ?? (tooltipText([title ?? fallback, description, shortcut]) || undefined);
  return <RadixPortal container={container}><RadixContent {...props} arrow={showArrow} aria-label={accessible}
    className={cn('zero-tooltip', overflowOnly && 'zero-tooltip-mono', className)}>
    <TooltipBody title={title} description={description} shortcut={shortcut}>{fallback}</TooltipBody>
    {showArrow && <RadixArrow className="zero-tooltip-arrow" width={9} height={5} />}
  </RadixContent></RadixPortal>;
}
function SharedContent({ className, children, title, description, shortcut, container, ...props }: TooltipContentProps) {
  const local = useSharedTooltip();
  const global = useGlobalTooltip();
  const fallback = children ?? (title == null && description == null && global.currentTooltip?.id === local.id
    ? global.currentTooltip.reference.textContent?.trim() : undefined);
  return <GroupTooltipContent {...props as GroupTooltipContentProps} container={container}
    className={cn(local.overflowOnly && 'zero-tooltip-mono', className)}>
    <TooltipBody title={title} description={description} shortcut={shortcut}>{fallback}</TooltipBody>
  </GroupTooltipContent>;
}
export { TooltipProvider, TooltipGroup, Tooltip, TooltipTrigger, TooltipContent,
  type TooltipProviderProps, type TooltipProps, type TooltipTriggerProps, type TooltipContentProps };
