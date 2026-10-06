/** Measures visible browser geometry only; CSS tokens own palette presentation. */
import { useEffect, useState, type CSSProperties } from 'react';

/** Keep pinned input/footer within the visual viewport when a mobile keyboard opens. */
export function useDocsSearchViewport(open: boolean): CSSProperties {
  const [style, setStyle] = useState<CSSProperties>({});
  useEffect(() => {
    if (!open) return;
    const viewport = window.visualViewport;
    let frame = 0;
    const update = () => {
      frame = 0;
      setStyle({
        '--zero-docs-visual-height': `${viewport?.height ?? window.innerHeight}px`,
        '--zero-docs-visual-width': `${viewport?.width ?? window.innerWidth}px`,
        '--zero-docs-visual-top': `${viewport?.offsetTop ?? 0}px`,
        '--zero-docs-visual-left': `${viewport?.offsetLeft ?? 0}px`,
      } as CSSProperties);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    update();
    viewport?.addEventListener('resize', schedule);
    viewport?.addEventListener('scroll', schedule);
    window.addEventListener('resize', schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      viewport?.removeEventListener('resize', schedule);
      viewport?.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    };
  }, [open]);
  return style;
}
