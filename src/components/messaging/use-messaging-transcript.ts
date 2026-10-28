'use client';
/** Real viewport/focus observations drive following and the optional displayed-end read policy. */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { MessagingWorkspaceController } from './messaging-workspace-controller';
import type { MessagingWorkspaceState } from './workspace-state';
export function useMessagingTranscript(controller: MessagingWorkspaceController, state: MessagingWorkspaceState, readPolicy: 'visible-end' | 'manual') {
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null), end = useRef<HTMLDivElement>(null);
  const position = useRef<{ id: string | null; following: boolean; anchorId: string | null; anchorTop: number }>({ id: null, following: true, anchorId: null, anchorTop: 0 });
  const [following, setFollowing] = useState(true), [readAttempt, setReadAttempt] = useState(0);
  const focusFence = useRef<boolean | null>(null);
  const last = state.messages.at(-1)?.sequence;
  useLayoutEffect(() => {
    if (!viewport) return;
    const old = position.current;
    if (old.id !== state.selectedId || old.following) viewport.scrollTop = viewport.scrollHeight;
    else if (old.anchorId) {
      const anchor = [...viewport.querySelectorAll<HTMLElement>('[data-message-id]')].find(element => element.dataset.messageId === old.anchorId);
      if (anchor) viewport.scrollTop += anchor.getBoundingClientRect().top - old.anchorTop;
    }
    capture();
    function capture() {
      if (!viewport) return;
      const following = viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop < 48;
      const top = viewport.getBoundingClientRect().top;
      const anchor = visibleAnchor(viewport, top);
      position.current = { id: state.selectedId, following, anchorId: anchor?.dataset.messageId ?? null, anchorTop: anchor?.getBoundingClientRect().top ?? 0 };
      controller.setFollowing(following, state.selectedId); setFollowing(following);
      if (anchor) controller.observeVisible(Number(anchor.dataset.messageSequence), state.selectedId);
    }
  }, [viewport, controller, state.selectedId, state.messages]);
  useEffect(() => {
    if (!viewport) return;
    const capture = () => {
      const nearEnd = viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop < 48, top = viewport.getBoundingClientRect().top;
      const anchor = visibleAnchor(viewport, top);
      position.current = { id: state.selectedId, following: nearEnd, anchorId: anchor?.dataset.messageId ?? null, anchorTop: anchor?.getBoundingClientRect().top ?? 0 };
      controller.setFollowing(nearEnd, state.selectedId); setFollowing(nearEnd);
      if (anchor) controller.observeVisible(Number(anchor.dataset.messageSequence), state.selectedId);
    };
    viewport.addEventListener('scroll', capture, { passive: true }); return () => viewport.removeEventListener('scroll', capture);
  }, [viewport, controller, state.selectedId]);
  useEffect(() => {
    if (!viewport || !end.current || !last || readPolicy !== 'visible-end' || state.loading || !state.conversation) return;
    if (focusFence.current === null) focusFence.current = document.hasFocus();
    let visible = false, timer: ReturnType<typeof setTimeout> | undefined;
    const onScreen = () => {
      if (!end.current) return false;
      const rect = end.current.getBoundingClientRect(), root = viewport.getBoundingClientRect();
      return rect.top >= Math.max(0, root.top) && rect.bottom <= Math.min(window.innerHeight, root.bottom);
    };
    const eligible = () => visible && focusFence.current === true && onScreen() && document.visibilityState === 'visible' && document.hasFocus() && viewport.clientHeight > 0
      && viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop < 48;
    const check = () => {
      clearTimeout(timer);
      if (eligible()) timer = setTimeout(() => { if (eligible()) void controller.markPresented(last, state.selectedId); }, 750);
    };
    // A blur event cancels admission immediately, even if the browser's focus
    // getter has not caught up in this event turn. Only a fresh focus restores it.
    const blur = () => { focusFence.current = false; check(); }, focus = () => { focusFence.current = document.hasFocus(); check(); };
    const observer = new IntersectionObserver(entries => { visible = entries[0]?.isIntersecting === true && entries[0].intersectionRatio === 1; check(); }, { root: viewport, threshold: 1 });
    observer.observe(end.current); document.addEventListener('visibilitychange', check); document.addEventListener('focusin', focus); window.addEventListener('focus', focus); window.addEventListener('blur', blur);
    window.addEventListener('scroll', check, { passive: true, capture: true }); window.addEventListener('resize', check);
    return () => { clearTimeout(timer); observer.disconnect(); document.removeEventListener('visibilitychange', check); document.removeEventListener('focusin', focus); window.removeEventListener('focus', focus); window.removeEventListener('blur', blur);
      window.removeEventListener('scroll', check, true); window.removeEventListener('resize', check); };
  }, [viewport, controller, state.selectedId, state.conversation?.unreadCount, state.loading, last, readPolicy, readAttempt]);
  const latest = () => { if (controller.getSnapshot().selectedId !== state.selectedId) return;
    position.current.following = true; controller.setFollowing(true, state.selectedId); controller.latest(state.selectedId); if (viewport) viewport.scrollTop = viewport.scrollHeight; };
  return { viewport, viewportRef: setViewport, endRef: end, following, latest, retryRead: () => setReadAttempt(value => value + 1) };
}
function visibleAnchor(viewport: HTMLElement, top: number): HTMLElement | undefined {
  const rows = viewport.querySelectorAll<HTMLElement>('[data-message-id]'); let low = 0, high = rows.length;
  while (low < high) { const middle = (low + high) >>> 1; if (rows[middle]!.getBoundingClientRect().bottom <= top) low = middle + 1; else high = middle; }
  return rows[low];
}
