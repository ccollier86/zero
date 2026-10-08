/**
 * Selects a readable tooltip side using Floating UI's existing collision engine.
 * Radix remains the owner of final coordinates, arrow positioning, descriptions
 * and dismissal. This helper never installs listeners or retains inline styles.
 */
import { computePosition, flip, offset, platform, type Boundary, type Padding, type Platform, type Placement } from '@floating-ui/react';
import type { TooltipSide } from './tooltip-motion-types';

/** Inputs to side selection; main-axis offset should include the resolved arrow extension. */
export interface TooltipPlacementOptions {
  readonly side: TooltipSide;
  readonly align?: 'start' | 'center' | 'end';
  readonly sideOffset?: number;
  readonly collisionBoundary?: Element | null | Array<Element | null>;
  readonly collisionPadding?: Padding;
  readonly signal?: AbortSignal;
}

/** Platform injection keeps geometry qualification isolated from browser/application state. */
export function createTooltipPlacementResolver(geometryPlatform: Platform = platform) {
  return async function resolve(trigger: Element, visual: HTMLElement, options: TooltipPlacementOptions): Promise<TooltipSide> {
    if (options.signal?.aborted || !trigger.isConnected || !visual.isConnected || trigger.ownerDocument !== visual.ownerDocument) return options.side;
    const requested: Placement = options.align && options.align !== 'center' ? `${options.side}-${options.align}` : options.side;
    const boundary: Boundary = Array.isArray(options.collisionBoundary)
      ? options.collisionBoundary.filter((element): element is Element => element !== null)
      : options.collisionBoundary ?? 'clippingAncestors';
    const padding = options.collisionPadding ?? 8;
    const inset = sides(padding);
    let measured = false;
    let comfortable: { width: number; height: number } | null = null;
    const scopedPlatform: Platform = { ...geometryPlatform,
      getDimensions(element) {
        return element === visual && comfortable ? comfortable : geometryPlatform.getDimensions.call(this, element);
      },
    };
    const result = await computePosition(trigger, visual, { strategy: 'fixed', placement: requested, platform: scopedPlatform,
      middleware: [
        {
          name: 'tooltipComfortableFootprint',
          async fn(state) {
            if (measured || options.signal?.aborted) return {};
            measured = true;
            const clipping = await state.platform.getClippingRect({ element: visual, boundary, rootBoundary: 'viewport', strategy: 'fixed' });
            const width = Math.max(0, clipping.width - inset.left - inset.right);
            const height = Math.max(0, clipping.height - inset.top - inset.bottom);
            if (!Number.isFinite(width) || !Number.isFinite(height)) return {};
            // Current Radix side sizing can be an unreadable sliver. Probe against
            // the full scoped boundary, not that side's already-clamped width.
            // No await occurs while the temporary styles are installed.
            const names = ['--radix-tooltip-content-available-width', '--radix-tooltip-content-available-height'] as const;
            const previous = names.map(name => ({ name, value: visual.style.getPropertyValue(name), priority: visual.style.getPropertyPriority(name) }));
            try {
              visual.style.setProperty(names[0], `${width}px`, 'important');
              visual.style.setProperty(names[1], `${height}px`, 'important');
              comfortable = {
                width: Math.min(width, Math.max(0, visual.offsetWidth)),
                height: Math.min(height, Math.max(0, visual.offsetHeight, visual.scrollHeight)),
              };
            } finally {
              for (const old of previous) {
                if (old.value) visual.style.setProperty(old.name, old.value, old.priority);
                else visual.style.removeProperty(old.name);
              }
            }
            return comfortable.width > 0 && comfortable.height > 0 ? { reset: { rects: true } } : {};
          },
        },
        offset(options.sideOffset ?? 9),
        // Try the opposite side first, then the other axis, before accepting an
        // unreadable narrow sliver. Floating UI retains RTL/alignment semantics.
        flip({ boundary, padding, fallbackAxisSideDirection: 'start', flipAlignment: true }),
      ],
    });
    if (options.signal?.aborted || !trigger.isConnected || !visual.isConnected) return options.side;
    return result.placement.split('-')[0] as TooltipSide;
  };
}

/** Select an adaptive side without changing Radix's placement or interaction ownership. */
export const resolveTooltipPlacement = createTooltipPlacementResolver();

function sides(padding: Padding): { top: number; right: number; bottom: number; left: number } {
  return typeof padding === 'number' ? { top: padding, right: padding, bottom: padding, left: padding }
    : { top: padding.top ?? 0, right: padding.right ?? 0, bottom: padding.bottom ?? 0, left: padding.left ?? 0 };
}
