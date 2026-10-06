/** Owns search-dialog invocation and focus return, including a nested mobile drawer. */
import { useCallback, useEffect, useRef, useState } from 'react';

/** Remember the actual invoking control rather than forcing focus into a hidden header. */
export function useDocsSearchDialog() {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const invoker = useRef<HTMLElement | null>(null);
  const afterNavigation = useRef<(() => void) | null>(null);
  const changeOpen = useCallback((next: boolean) => {
    if (next) {
      const active = document.activeElement;
      invoker.current = active instanceof HTMLElement && active !== document.body
        && active !== document.documentElement ? active : trigger.current;
    }
    setOpen(next);
  }, []);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.repeat) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        changeOpen(!open);
      }
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [open, changeOpen]);

  return {
    open, trigger, changeOpen,
    /** Defer same-page landing until the search modal releases its focus trap. */
    closeForNavigation(afterClose?: () => void) {
      afterNavigation.current = afterClose ?? (() => {});
      setOpen(false);
    },
    onCloseAutoFocus(event: Event) {
      event.preventDefault();
      const navigate = afterNavigation.current;
      afterNavigation.current = null;
      if (navigate) { navigate(); return; }
      const target = invoker.current;
      if (target?.isConnected && !target.closest('[aria-hidden="true"], [inert]')) {
        target.focus({ preventScroll: true });
      } else {
        // A closing drawer can remove the original invoker before this dialog.
        const drawer = document.querySelector<HTMLElement>('[data-mobile="true"] [aria-label="Close documentation navigation"]');
        (drawer ?? trigger.current)?.focus({ preventScroll: true });
      }
    },
  };
}
