/** Calendar/resource identity presentation over Zero's own Avatar primitive. */
import type { ComponentProps, CSSProperties, ReactNode } from 'react';
import { Avatar as Root, AvatarImage, AvatarFallback } from '@zero/framework/components/ui/avatar';
import { calendarLength } from './calendar-layout';
export function Avatar({ size = 'md', color = 'blue', radius = 'xl', src, alt = '', children, style, ...props }: ComponentProps<'span'> & { size?: string | number; color?: string; radius?: string; src?: string | null; alt?: string }) {
  const length = ['sm', 'md', 'lg'].includes(String(size)) ? `var(--calendar-avatar-${size})` : calendarLength(size);
  return <Root {...props} style={{ width: length, height: length, flex: 'none', borderRadius: radius === 'xl' ? '50%' : `var(--calendar-radius-${radius})`, ...style }}>
    {src && <AvatarImage src={src} alt={alt} />}<AvatarFallback style={{ background: `var(--calendar-color-${color}-0)`, color: `var(--calendar-color-${color}-6)`, fontSize: 'var(--calendar-font-size-xs)', fontWeight: 'var(--calendar-weight-heading)', borderRadius: 'inherit' }}>{children}</AvatarFallback>
  </Root>;
}
export function Indicator({ children, color = 'blue', size = 'var(--calendar-size-8)', offset = 0 }: { children: ReactNode; color?: string; size?: string | number; offset?: number | string; position?: string }) {
  return <span className="calendar-avatar-indicator"><span>{children}</span><i aria-hidden="true" style={{ width: calendarLength(size), height: calendarLength(size), right: calendarLength(offset), bottom: calendarLength(offset), background: `var(--calendar-color-${color}-6)` } as CSSProperties} /></span>;
}
