'use client';

import * as React from 'react';
import { cn } from '../../lib/utils';

export interface ReadingProgressOptions { target?: HTMLElement | null; container?: HTMLElement | null }
export interface ReadingProgressState { progress: number; scrollable: boolean }
const Context = React.createContext<ReadingProgressState | null>(null);
/** Article-relative progress. An unscrollable document has no scroll progress to invent. */
export function calculateReadingProgress(scroll: number, extent: number): ReadingProgressState {
  if (!Number.isFinite(scroll) || !Number.isFinite(extent) || extent <= 0) return { progress: 0, scrollable: false };
  return { progress: Math.round(Math.max(0, Math.min(1, scroll / extent)) * 10000) / 100, scrollable: true };
}
function useObservedProgress({ target, container }: ReadingProgressOptions, enabled = true): ReadingProgressState {
  const [value, setValue] = React.useState<ReadingProgressState>({ progress: 0, scrollable: false });
  React.useEffect(() => {
    if (!enabled) return;
    const document = target?.ownerDocument ?? container?.ownerDocument ?? window.document, view = document.defaultView;
    if (!view) return;
    const scrollRoot = container ?? document.scrollingElement ?? document.documentElement;
    let frame = 0;
    const read = () => {
      frame = 0;
      const viewport = container ? container.clientHeight : view.innerHeight;
      const rootTop = container ? container.getBoundingClientRect().top + container.clientTop : 0;
      const rect = target?.getBoundingClientRect();
      const next = rect ? calculateReadingProgress(rootTop - rect.top, rect.height - viewport) : calculateReadingProgress(scrollRoot.scrollTop, scrollRoot.scrollHeight - viewport);
      setValue(previous => previous.progress === next.progress && previous.scrollable === next.scrollable ? previous : next);
    };
    const schedule = () => { if (!frame) frame = view.requestAnimationFrame(read); };
    const source = container ?? view;
    source.addEventListener('scroll', schedule, { passive: true }); view.addEventListener('resize', schedule, { passive: true });
    const observer = new ResizeObserver(schedule); observer.observe(target ?? document.body); if (container) observer.observe(container);
    read(); return () => { source.removeEventListener('scroll', schedule); view.removeEventListener('resize', schedule); observer.disconnect(); view.cancelAnimationFrame(frame); };
  }, [enabled, target, container]);
  return value;
}
export function ReadingProgressProvider({ children, ...options }: ReadingProgressOptions & { children: React.ReactNode }) {
  return <Context.Provider value={useObservedProgress(options)}>{children}</Context.Provider>;
}
export function useReadingProgress(options: ReadingProgressOptions = {}): ReadingProgressState {
  const inherited = React.useContext(Context), own = useObservedProgress(options, !inherited);
  return inherited ?? own;
}
function useIndicatorProgress(options: ReadingProgressOptions, controlled: boolean) {
  const inherited = React.useContext(Context), own = useObservedProgress(options, !controlled && !inherited);
  return inherited ?? own;
}
export interface ReadingProgressProps extends ReadingProgressOptions { value?: number; label?: string; showPercentage?: boolean; hideWhenUnscrollable?: boolean; className?: string; style?: React.CSSProperties }
export function ReadingProgressBar({ value, label = 'Reading progress', showPercentage = false, hideWhenUnscrollable = true, position = 'top', className, style, ...options }: ReadingProgressProps & { position?: 'top' | 'bottom' | 'inline' }) {
  const observed = useIndicatorProgress(options, value !== undefined), progress = value === undefined ? observed.progress : Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
  return <div className={cn('zero-blog-reading-bar', className)} data-position={position} hidden={value === undefined && hideWhenUnscrollable && !observed.scrollable}
    role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} style={style}>
    <div style={{ transform: `scaleX(${progress / 100})` }} />{showPercentage && <span>{Math.round(progress)}%</span>}
  </div>;
}
export function ReadingProgressCircle({ value, label = 'Reading progress', showPercentage = true, hideWhenUnscrollable = true, className, style, ...options }: ReadingProgressProps) {
  const observed = useIndicatorProgress(options, value !== undefined), progress = value === undefined ? observed.progress : Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
  return <div className={cn('zero-blog-reading-circle', className)} hidden={value === undefined && hideWhenUnscrollable && !observed.scrollable}
    role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress} style={style}>
    <svg viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="17" /><circle cx="20" cy="20" r="17" pathLength="100" strokeDasharray={`${progress} 100`} /></svg>
    {showPercentage && <span>{Math.round(progress)}</span>}
  </div>;
}
