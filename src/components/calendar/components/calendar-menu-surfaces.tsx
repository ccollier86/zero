/** Compact calendar menu anatomy, native Zero menu ownership/motion/magnetic highlight/scrolling. */
import { createContext, useContext, useRef, type ComponentProps, type ReactNode } from 'react';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from '@zero/framework/components/dropdown-menu';
interface MenuProps { children: ReactNode; opened?: boolean; onChange?(opened: boolean): void; width?: string | number; offset?: number | { mainAxis?: number }; returnFocus?: boolean; closeOnEscape?: boolean; closeOnClickOutside?: boolean; position?: string; floatingStrategy?: string; shadow?: string; radius?: string; withinPortal?: boolean; trapFocus?: boolean; loop?: boolean; withInitialFocusPlaceholder?: boolean; onExitComplete?(): void }
type Configuration = Pick<MenuProps, 'width' | 'offset' | 'returnFocus' | 'closeOnEscape'> & { live?: { current: { opened?: boolean; onExitComplete?(): void } } };
const Context = createContext<Configuration>({});
function Root({ children, opened, onChange, width, offset, returnFocus, closeOnEscape, onExitComplete }: MenuProps) {
  const live = useRef({ opened, onExitComplete }); live.current = { opened, onExitComplete };
  return <Context.Provider value={{ width, offset, returnFocus, closeOnEscape, live }}><DropdownMenu open={opened} onOpenChange={onChange}>{children}</DropdownMenu></Context.Provider>;
}
function Target({ children }: { children: ReactNode }) { return <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>; }
function Dropdown({ children, style, ...props }: ComponentProps<typeof DropdownMenuContent>) {
  const options = useContext(Context);
  return <DropdownMenuContent {...props} align="start" sideOffset={typeof options.offset === 'number' ? options.offset : options.offset?.mainAxis} style={{ width: options.width ?? undefined, ...style }}
    onAnimationComplete={definition => { props.onAnimationComplete?.(definition); if (typeof definition === 'object' && '--zero-anchored-presence' in definition && definition['--zero-anchored-presence'] === 1 && options.live?.current.opened === false) options.live.current.onExitComplete?.(); }}
    onEscapeKeyDown={event => { props.onEscapeKeyDown?.(event); if (options.closeOnEscape === false) event.preventDefault(); }}
    onCloseAutoFocus={event => { props.onCloseAutoFocus?.(event); if (options.returnFocus === false) event.preventDefault(); }}>{children}</DropdownMenuContent>;
}
function Item({ leftSection, children, onClick, color, ...props }: Omit<ComponentProps<typeof DropdownMenuItem>, 'onClick'> & { leftSection?: ReactNode; color?: string; onClick?(): void }) {
  return <DropdownMenuItem {...props} variant={color === 'red' ? 'destructive' : 'default'} onSelect={() => onClick?.()}>{leftSection}{children}</DropdownMenuItem>;
}
export const CalendarMenu = Object.assign(Root, { Target, Dropdown, Item, Divider: DropdownMenuSeparator });
