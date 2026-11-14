import { useLayoutEffect, useRef, useState, type FocusEvent, type PointerEvent } from 'react';

/** One travelling hover/focus highlight, with fades only at actual scroll boundaries. */
export function useListChrome(contentKey: string, active = true) {
  const ref = useRef<HTMLDivElement>(null);
  const [highlight, setHighlight] = useState<{ top: number; height: number } | null>(null);
  const [edges, setEdges] = useState({ top: false, bottom: false });
  function measure() {
    const element = ref.current;
    if (element) setEdges({ top: element.scrollTop > 2, bottom: element.scrollTop + element.clientHeight < element.scrollHeight - 2 });
  }
  function follow(event: FocusEvent<HTMLDivElement> | PointerEvent<HTMLDivElement>) {
    if ('pointerType' in event && event.pointerType !== 'mouse') return;
    const row = (event.target as Element).closest<HTMLElement>('[data-list-item]');
    const element = ref.current;
    if (!row || !element?.contains(row)) return;
    const box = row.getBoundingClientRect(), frame = element.getBoundingClientRect();
    setHighlight({ top: box.top - frame.top + element.scrollTop, height: box.height });
  }
  useLayoutEffect(() => {
    setHighlight(null);
    if (!active || !ref.current) return;
    const element = ref.current;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    if (element.firstElementChild) observer.observe(element.firstElementChild);
    const frame = requestAnimationFrame(measure);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, [contentKey, active]);
  return { ref, highlight, edges, handlers: { onPointerMove: follow, onFocusCapture: follow, onPointerLeave: () => setHighlight(null), onScroll: () => { measure(); setHighlight(null); } } };
}
