/** Shared Zero-token menu surface/item styles; no positioning or behavior belongs here. */
export const contextMenuSurfaceClass = [
  'z-50 min-w-48 max-w-[min(24rem,var(--radix-context-menu-content-available-width,calc(100vw-1rem)))]',
  'max-h-[var(--radix-context-menu-content-available-height,calc(100vh-1rem))] overflow-x-hidden overflow-y-auto overscroll-contain',
  'origin-[var(--radix-context-menu-content-transform-origin)] rounded-lg border border-border/85 bg-popover p-1 text-popover-foreground shadow-lg outline-none dark:shadow-none',
].join(' ');

export const contextMenuItemClass = [
  'relative flex min-w-0 cursor-default select-none items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none',
  'data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
  'data-[inset=true]:ps-8 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*=size-])]:size-4',
  '[&_svg:not([class*=text-])]:text-muted-foreground',
].join(' ');
