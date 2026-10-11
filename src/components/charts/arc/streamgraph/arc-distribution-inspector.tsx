'use client';
/** Shared Zero tooltip adapter for Arc distribution charts; positioning and portals belong to Tooltip, never to SVG hit regions. */
import type { ReactNode, Ref } from "react";
import { Tooltip, TooltipTrigger, TooltipContent } from "../../../tooltip";
/** An inert point anchor gives the shared collision engine exact chart-local coordinates. */
export function ArcDistributionInspector({ open, point, content, className, plot, side="top", onDismiss, contentRef }: {
 open:boolean;point:readonly [number,number];content:ReactNode;className:string;
 plot?:HTMLElement|null;side?:"top"|"bottom"|"left"|"right";onDismiss:()=>void;contentRef?:Ref<HTMLDivElement>;
}) {
 return <Tooltip open={open&&content!==null&&content!==undefined} delayDuration={0} motion="blur" arrow={false} disableHoverableContent>
  <TooltipTrigger asChild><span aria-hidden="true" tabIndex={-1} style={{position:"absolute",left:point[0],top:point[1],width:1,height:1,pointerEvents:"none"}} /></TooltipTrigger>
  <TooltipContent ref={contentRef} className={className} side={side} sideOffset={14} collisionBoundary={plot??undefined} collisionPadding={8} arrow={false} onEscapeKeyDown={event=>{event.preventDefault();onDismiss();}}>{content}</TooltipContent>
 </Tooltip>;
}
