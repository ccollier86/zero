'use client';
/** Observe the owning chart's actual axis font, including token/theme and webfont changes. No module-time DOM or data transport. */
import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { observePresentationTheme } from '../../../../lib/observe-presentation-theme';
import type { ChartTextMetrics } from './chart-text-layout';
export function useChartTextMetrics(ref: RefObject<Element | null>, selector = 'text'): ChartTextMetrics {
  const [metrics, setMetrics] = useState<ChartTextMetrics>({ fontSize: 11.5 });
  const refresh = useRef<() => void>(() => {});
  useLayoutEffect(() => {
    const node = ref.current, document = node?.ownerDocument, view = document?.defaultView;
    if (!node || !document || !view) return;
    const context = document.createElement('canvas').getContext('2d');
    let alive = true, previous = '';
    const measure = (force = false) => {
      if (!alive) return;
      const target = node.querySelector(selector); if (!target) return;
      const style = view.getComputedStyle(target), fontSize = parseFloat(style.fontSize), font = style.font || `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`, spacing = parseFloat(style.letterSpacing) || 0;
      if (!Number.isFinite(fontSize) || fontSize <= 0 || fontSize > 96) return;
      const key = `${font}|${spacing}`; if (!force && previous === key) return; previous = key;
      setMetrics({ fontSize, ...(context ? { measureText: (text: string) => { context.font = font; return context.measureText(text).width + Math.max(0, Array.from(text).length - 1) * spacing; } } : {}) });
    };
    refresh.current = measure; measure();
    const resize = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(() => measure()); resize?.observe(node);
    const releaseTheme = observePresentationTheme(node, () => measure());
    const loaded = () => measure(true); document.fonts?.addEventListener('loadingdone', loaded); void document.fonts?.ready.then(() => { if (alive) measure(true); });
    return () => { alive = false; refresh.current = () => {}; resize?.disconnect(); releaseTheme(); document.fonts?.removeEventListener('loadingdone', loaded); };
  }, [ref, selector]);
  // A chart may mount without any SVG text, then receive data without resizing.
  // Recheck after commits; the font key prevents an unchanged metrics update.
  useLayoutEffect(() => { refresh.current(); });
  return metrics;
}
