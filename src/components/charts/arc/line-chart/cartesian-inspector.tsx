'use client';
/** Composes analytical readouts with Zero's tooltip ownership, portal and collision handling. */
import type { ReactNode, RefObject } from 'react';
import { motion, type MotionValue } from 'motion/react';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../../tooltip';

/** A noninteractive virtual plot anchor; the shared tooltip remains above stacked overlays. */
export function CartesianInspector({open,content,x,y,plot,className,onDismiss,contentRef}: {
 open:boolean;content:ReactNode;x:number|MotionValue<number>;y:number|MotionValue<number>;
 plot:HTMLElement|null;className:string;onDismiss:()=>void;contentRef?:RefObject<HTMLDivElement|null>;
}) {
 // Inspection intent is owned by the chart's pointer/keyboard state. A hover-only
 // tooltip manager request must not clear controlled chart intent on retarget.
 return <Tooltip open={open && content!==null} delayDuration={0} motion="blur" arrow={false} disableHoverableContent>
  <TooltipTrigger asChild><motion.span className="zero-arc-cartesian-inspection-anchor" tabIndex={-1} aria-hidden="true" style={{position:'absolute',left:0,top:0,width:1,height:1,pointerEvents:'none',x,y}}/></TooltipTrigger>
  <TooltipContent ref={contentRef} className={className} side="right" sideOffset={14} align="center" collisionPadding={8} collisionBoundary={plot??undefined} arrow={false} onEscapeKeyDown={event=>{event.preventDefault();onDismiss();}}>{content}</TooltipContent>
 </Tooltip>;
}
