import { useEffect, useState } from 'react';

/** JS-driven disclosures honor the same motion token and reduced-motion preference as CSS. */
export function useDocsMotionDuration(): number {
  const [duration, setDuration] = useState(0);
  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => {
      const value = getComputedStyle(document.documentElement).getPropertyValue('--zero-docs-motion-duration').trim();
      const number = Number.parseFloat(value), seconds = value.endsWith('ms') ? number / 1000 : number;
      setDuration(preference.matches ? 0 : Number.isFinite(seconds) ? Math.min(1, Math.max(0, seconds)) : .16);
    };
    update(); preference.addEventListener('change', update);
    return () => preference.removeEventListener('change', update);
  }, []);
  return duration;
}
