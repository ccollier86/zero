/**
 * tooltip/index.ts
 *
 * Exposes the tokenized tooltip family and explicit shared-group composition.
 */

export {
  TooltipProvider,
  TooltipGroup,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  type TooltipProps,
  type TooltipProviderProps,
  type TooltipTriggerProps,
  type TooltipContentProps,
} from '../animate-ui/components/radix/tooltip';
export type { TooltipGroupProps } from './tooltip-group';
export { TOOLTIP_MOTION_DEFAULTS, TOOLTIP_MOTION_TIMINGS, TOOLTIP_MOTION_EASING,
  TOOLTIP_MOTION_GEOMETRY, resolveTooltipMotion } from './tooltip-motion';
export type { TooltipMotionPreset, TooltipVariant, TooltipMotionOptions, TooltipMotionSettings,
  TooltipMotionTimings, TooltipMotionEasing, TooltipMotionGeometry, ResolvedTooltipMotion } from './tooltip-motion-types';
