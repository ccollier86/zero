/** Private calendar layout anatomy. No alternate theme provider or UI runtime is required. */
import type { ComponentProps, CSSProperties, ReactNode } from 'react';
export interface LayoutAliases {
  p?: string | number; px?: string | number; py?: string | number; pt?: string | number; pb?: string | number;
  m?: string | number; mx?: string | number; my?: string | number; mt?: string | number; mb?: string | number;
  w?: CSSProperties['width']; h?: CSSProperties['height']; gap?: CSSProperties['gap'];
}
export function calendarLength(value: string | number | undefined): string | number | undefined {
  return typeof value === 'number' ? value === 0 ? 0 : `var(--calendar-size-${String(value).replace('.', '-')}, ${value}px)`
    : value && ['xs', 'sm', 'md', 'lg', 'xl'].includes(value) ? `var(--calendar-space-${value})` : value;
}
export function calendarColor(value?: string) {
  if (!value) return undefined;
  if (value === 'dimmed') return 'var(--calendar-muted)';
  if (value === 'white') return 'var(--calendar-on-accent)';
  if (value === 'dark' || value === 'black') return 'var(--calendar-text)';
  if (/^[a-z]+(?:\.[0-9])?$/.test(value)) { const [hue, level = '6'] = value.split('.'); return `var(--calendar-color-${hue}-${level})`; }
  return value;
}
export function layoutProps<T extends LayoutAliases & { style?: CSSProperties }>(props: T) {
  const { p, px, py, pt, pb, m, mx, my, mt, mb, w, h, gap, style, ...rest } = props;
  return { rest, style: {
    ...(p !== undefined ? { padding: calendarLength(p) } : {}),
    ...(px !== undefined ? { paddingInline: calendarLength(px) } : {}), ...(py !== undefined ? { paddingBlock: calendarLength(py) } : {}),
    ...(pt !== undefined ? { paddingTop: calendarLength(pt) } : {}), ...(pb !== undefined ? { paddingBottom: calendarLength(pb) } : {}),
    ...(m !== undefined ? { margin: calendarLength(m) } : {}), ...(mx !== undefined ? { marginInline: calendarLength(mx) } : {}),
    ...(my !== undefined ? { marginBlock: calendarLength(my) } : {}), ...(mt !== undefined ? { marginTop: calendarLength(mt) } : {}),
    ...(mb !== undefined ? { marginBottom: calendarLength(mb) } : {}), ...(w !== undefined ? { width: calendarLength(w) } : {}),
    ...(h !== undefined ? { height: calendarLength(h) } : {}), ...(gap !== undefined ? { gap: calendarLength(gap) } : {}), ...style,
  } satisfies CSSProperties };
}
type Props = ComponentProps<'div'> & LayoutAliases;
export function Box(props: Props) { const { rest, style } = layoutProps(props); return <div {...rest} style={style} />; }
export function Stack({ gap = 'md', ...props }: Props) { const { rest, style } = layoutProps({ ...props, gap }); return <div {...rest} style={{ display: 'flex', flexDirection: 'column', ...style }} />; }
export function Group({ gap = 'md', justify, align = 'center', wrap = 'wrap', ...props }: Props & { justify?: CSSProperties['justifyContent']; align?: CSSProperties['alignItems']; wrap?: CSSProperties['flexWrap'] }) {
  const { rest, style } = layoutProps({ ...props, gap }); return <div {...rest} style={{ display: 'flex', flexDirection: 'row', alignItems: align, justifyContent: justify, flexWrap: wrap, ...style }} />;
}
export function Paper({ radius = 'md', withBorder, ...props }: Props & { radius?: string; withBorder?: boolean }) { const { rest, style } = layoutProps(props); return <div {...rest} style={{ background: 'var(--calendar-surface)', color: 'var(--calendar-text)', borderRadius: `var(--calendar-radius-${radius})`, ...(withBorder ? { border: 'var(--calendar-border-width) solid var(--calendar-line)' } : {}), ...style }} />; }
type TextVisual = LayoutAliases & { size?: string; fw?: CSSProperties['fontWeight']; c?: string; ta?: CSSProperties['textAlign']; truncate?: boolean; lineClamp?: number };
type TextProps = TextVisual & (({ component: 'button' } & ComponentProps<'button'>) | ({ component?: undefined } & ComponentProps<'div'>));
export function Text(props: TextProps) {
  const { size = 'sm', fw, c, ta, truncate, lineClamp } = props;
  const { style } = layoutProps(props);
  const paint: CSSProperties = { fontSize: ['xs', 'sm', 'md', 'lg', 'xl'].includes(size) ? `var(--calendar-font-size-${size})` : calendarLength(size), fontWeight: typeof fw === 'number' ? `var(--calendar-weight-${fw === 600 ? 'heading' : fw === 500 ? 'medium' : fw === 700 ? 'strong' : 'normal'})` : fw, color: calendarColor(c), textAlign: ta, lineHeight: 'var(--calendar-leading-body)',
    ...(truncate ? { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } : {}),
    ...(lineClamp ? { display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: lineClamp, overflow: 'hidden' } : {}), ...style };
  if (props.component === 'button') {
    const { component, size, fw, c, ta, truncate, lineClamp, ...attributes } = props;
    const { rest } = layoutProps(attributes); return <button {...rest} type={props.type ?? 'button'} style={paint} />;
  }
  const { component, size: ignoredSize, fw: ignoredWeight, c: ignoredColor, ta: ignoredAlign, truncate: ignoredTruncate, lineClamp: ignoredClamp, ...attributes } = props;
  const { rest } = layoutProps(attributes); return <div {...rest} style={paint} />;
}
export function Title({ order = 1, children, ...props }: Props & { order?: 1 | 2 | 3 | 4 | 5 | 6 }) {
  const { rest, style } = layoutProps(props), Tag = `h${order}` as 'h1';
  return <Tag {...rest} style={{ margin: 0, fontSize: `var(--calendar-title-${order}-size)`, fontWeight: 'var(--calendar-weight-strong)', lineHeight: 'var(--calendar-leading-heading)', ...style }}>{children}</Tag>;
}
export function Divider(props: Props) { const { rest, style } = layoutProps(props); return <div {...rest} role="separator" style={{ borderTop: 'var(--calendar-border-width) solid var(--calendar-line)', ...style }} />; }
export function SimpleGrid({ cols = 1, spacing = 'md', ...props }: Props & { cols?: number; spacing?: string | number }) { const { rest, style } = layoutProps(props); return <div {...rest} style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap: calendarLength(spacing), ...style }} />; }
export function Collapse({ in: opened, children }: { in: boolean; children: ReactNode }) { return <div className="calendar-collapse" style={{ gridTemplateRows: opened ? '1fr' : '0fr' }}><div inert={!opened} aria-hidden={!opened || undefined}>{children}</div></div>; }
export function Badge({ size = 'xs', color = 'blue', variant, radius = 'sm', children, ...props }: Props & { size?: string; color?: string; variant?: string; radius?: string }) {
  const { rest, style } = layoutProps(props); return <span {...rest} className={`calendar-badge ${props.className ?? ''}`} style={{ borderRadius: `var(--calendar-radius-${radius})`, color: `var(--calendar-color-${color}-7)`, background: `var(--calendar-color-${color}-0)`, ...style }}>{children}</span>;
}
