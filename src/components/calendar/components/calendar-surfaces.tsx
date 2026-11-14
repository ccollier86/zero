/** Calendar anatomy, native Zero overlay lifecycle. No calendar-specific motion presets. */
import { createContext, useContext, useRef, type ComponentProps, type CSSProperties, type ReactNode } from 'react';
import { ControlledModal, type ModalContext } from '@zero/framework/modals';
import { Popover as Root, PopoverAnchor, PopoverTrigger, PopoverContent } from '@zero/framework/components/popover';
import '../styles/calendar-overlays.css';
export interface CalendarPopoverProps {
  children: ReactNode; opened?: boolean; onChange?(opened: boolean): void; width?: CSSProperties['width'];
  position?: string; offset?: number | { mainAxis?: number }; returnFocus?: boolean; closeOnEscape?: boolean;
  onExitTransitionEnd?(): void; trapFocus?: boolean; radius?: string; shadow?: string; withinPortal?: boolean; withRoles?: boolean;
}
const DialogContext = createContext<ModalContext<unknown> | null>(null);
export function CalendarModal({ opened, onClose, title, size = 'var(--calendar-size-420)', children, closeOnEscape = true, trigger, classNames, className, padding = 'md', radius = 'md' }: {
  opened: boolean; onClose(): void; title: string; size?: string | number; children: ReactNode;
  closeOnEscape?: boolean; trigger?: HTMLElement | null; radius?: string; padding?: string | number;
  classNames?: { body?: string }; className?: string;
}) {
  // Snapshot the real initiating control once per mounted opening. Programmatic opens use native Rise.
  const opening = useRef(trigger ?? null);
  return <ControlledModal open={opened} onOpenChange={open => { if (!open) onClose(); }} descriptor={{
    title, size: 'sm', customSize: { width: typeof size === 'number' ? `${size}px` : size },
    trigger: opening.current, closeOnEscape, className: `calendar-managed-dialog calendar-managed-radius-${radius} ${className ?? ''}`,
    body: context => <DialogContext.Provider value={context}><div className={`calendar-dialog-body ${classNames?.body ?? ''}`} style={{ padding: typeof padding === 'number' ? padding : `var(--calendar-space-${padding})` }}>{children}</div></DialogContext.Provider>,
  }} />;
}
/** Managed form acceptance closes through Zero, rather than retiring the dialog before its exit. */
export function CalendarManagedForm({ onAccept, children, ...props }: Omit<ComponentProps<'form'>, 'onSubmit'> & { onAccept(): boolean | void }) {
  const context = useContext(DialogContext), pending = useRef(false);
  return <form {...props} onSubmit={event => { event.preventDefault(); if (pending.current || context?.signal.aborted) return;
    pending.current = true;
    try { if (onAccept() !== false) context?.accept(true); } finally { pending.current = false; }
  }}>{children}</form>;
}
export function CalendarDismiss({ children }: { children: ReactNode }) {
  const context = useContext(DialogContext);
  return <span className="calendar-dismiss" onClickCapture={event => { if (!context) return; event.preventDefault(); event.stopPropagation(); void context.requestClose('cancel'); }}>{children}</span>;
}

type Placement = { side: 'bottom' | 'top' | 'left' | 'right'; align: 'start' | 'end' | 'center' };
type PopoverConfiguration = Pick<CalendarPopoverProps, 'width' | 'position' | 'offset' | 'returnFocus' | 'closeOnEscape'>;
type PopupState = { opened?: boolean; onExitTransitionEnd?(): void };
const PopupContext = createContext<PopoverConfiguration & { live?: { current: PopupState } }>({});
function CalendarPopoverRoot({ opened, onChange, children, width, position, offset, returnFocus, closeOnEscape, onExitTransitionEnd, trapFocus }: CalendarPopoverProps) {
  const live = useRef<PopupState>({ opened, onExitTransitionEnd });
  live.current = { opened, onExitTransitionEnd };
  return <PopupContext.Provider value={{ width, position, offset, returnFocus, closeOnEscape, live }}><Root open={opened} onOpenChange={onChange} modal={trapFocus}>{children}</Root></PopupContext.Provider>;
}
function CalendarPopoverTarget({ children }: { children: ReactNode }) { return <PopoverTrigger asChild>{children}</PopoverTrigger>; }
function CalendarPopoverAnchor({ children }: { children: ReactNode }) { return <PopoverAnchor asChild>{children}</PopoverAnchor>; }
function CalendarPopoverDropdown({ children, style, ...props }: ComponentProps<typeof PopoverContent>) {
  const config = useContext(PopupContext);
  const [side = 'bottom', align = 'center'] = (config.position ?? 'bottom').split('-') as [Placement['side'], Placement['align']?];
  const offset = typeof config.offset === 'number' ? config.offset : config.offset?.mainAxis;
  return <PopoverContent {...props} className={`calendar-popover ${props.className ?? ''}`} side={side} align={align} sideOffset={offset} style={{ width: config.width, ...style } as CSSProperties}
    onAnimationComplete={definition => { props.onAnimationComplete?.(definition); if (typeof definition === 'object' && '--zero-anchored-presence' in definition && definition['--zero-anchored-presence'] === 1 && config.live?.current.opened === false) config.live.current.onExitTransitionEnd?.(); }}
    onKeyDownCapture={event => { const target = event.target as HTMLElement; if (event.key === 'Escape' && (target.closest('[data-slot="select-content"]') || target.closest('[data-slot="popover-content"]') && target.closest('[data-slot="popover-content"]') !== event.currentTarget)) return; props.onKeyDownCapture?.(event); }}
    onCloseAutoFocus={event => { props.onCloseAutoFocus?.(event); if (config.returnFocus === false) event.preventDefault(); }}
    onEscapeKeyDown={event => { props.onEscapeKeyDown?.(event); if (config.closeOnEscape === false) event.preventDefault(); }}>{children}</PopoverContent>;
}
export const CalendarPopover = Object.assign(CalendarPopoverRoot, { Target: CalendarPopoverTarget, Anchor: CalendarPopoverAnchor, Dropdown: CalendarPopoverDropdown });
