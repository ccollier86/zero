/** Calendar content with Zero's default tooltip behavior. Forward trigger refs/handlers through composition. */
import type { ComponentProps, ReactNode } from 'react';
import { Tooltip, TooltipTrigger, TooltipContent } from '@zero/framework/components/tooltip';
type Props = Omit<ComponentProps<typeof TooltipTrigger>, 'children'> & {
  children: ReactNode; label: ReactNode; openDelay?: number; withArrow?: boolean;
  events?: { hover?: boolean; focus?: boolean; touch?: boolean };
};
export function CalendarTooltip({ children, label, openDelay, withArrow, events, ...trigger }: Props) {
  return <Tooltip delayDuration={openDelay} arrow={withArrow}><TooltipTrigger {...trigger} asChild>{children}</TooltipTrigger><TooltipContent>{label}</TooltipContent></Tooltip>;
}
