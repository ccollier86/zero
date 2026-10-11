'use client';

/** Composable content-card façade. The existing modal manager alone owns quick-look frame, origin morph, focus, dismissal, portal and scroll lock. */
import * as React from 'react';
import { useMediaQuery } from '../../../hooks/use-media-query';
import { cn } from '../../../lib/utils';
import { modals } from '../../../modals/modal-events';
import { emitFrontendCode } from '../../../frontend/client/observability';
import { OBS_CODES } from '../../../observability/codes';
import type { ModalBody, ModalContext, ModalDescriptorBase, ModalHandle } from '../../../modals/modal-system.types';
import { useOverlayScope, composeOverlayRefs } from '../../overlays/overlay-scope';
import { Card, CardAction, CardByline, CardContent, CardDescription, CardFooter, CardHeader, CardMedia,
  CardMeta, CardStatus, CardTitle, type CardDensity } from './card';
import { useCardFeedback, useCardHoverFeedback } from './card-presentation';
import './content-card.css';

export type ContentCardDetailsOptions = Pick<ModalDescriptorBase,
  'size' | 'customSize' | 'placement' | 'height' | 'scrollbar' | 'initialFocus' | 'motion' | 'className'>;
export interface ContentCardProps extends Omit<React.ComponentProps<'article'>, 'title'> {
  title: React.ReactNode;
  /** Native HTML title attribute, separate from the visible card heading. */
  htmlTitle?: string;
  description?: React.ReactNode;
  media?: React.ReactNode;
  action?: React.ReactNode;
  avatar?: React.ReactNode;
  meta?: React.ReactNode;
  status?: string;
  density?: CardDensity;
  /** Deliberate quick-look body, not a clone of children/action. Requires the application's existing ModalManager. */
  details?: ModalBody;
  /** Visible managed heading for complex/nontext card titles. */
  detailsTitle?: string;
  /** Frame choices are admitted for the next opening; body/status updates remain live without replacing its generation. */
  detailsOptions?: ContentCardDetailsOptions;
  identity?: string | number;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

type Presentation = Pick<ContentCardProps, 'title' | 'description' | 'meta' | 'details' | 'detailsTitle'>;
function presentation(props: Presentation): Presentation { return { title: props.title, description: props.description, meta: props.meta,
  details: props.details, detailsTitle: props.detailsTitle }; }
function createPresentationStore(initial: Presentation) {
  let snapshot = initial;
  const listeners = new Set<() => void>();
  return { read: () => snapshot, subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    publish: (next: Presentation) => { if (Object.keys(next).every(key => next[key as keyof Presentation] === snapshot[key as keyof Presentation])) return;
      snapshot = next; for (const listener of listeners) listener(); } };
}
type PresentationStore = ReturnType<typeof createPresentationStore>;
interface Opening {
  handle: ModalHandle;
  identity: string | number;
  parentId?: string;
  suppressNotification: boolean;
}
function modalTitle(value: Presentation): string {
  if (value.detailsTitle?.trim()) return value.detailsTitle;
  return (typeof value.title === 'string' || typeof value.title === 'number') && String(value.title).trim() ? String(value.title) : 'Card details';
}
function Byline({ value }: { value: Pick<ContentCardProps, 'avatar' | 'meta' | 'status'> }) {
  if (value.avatar == null && value.meta == null && !value.status) return null;
  return <CardByline avatar={value.avatar}>{value.meta != null && <CardMeta>{value.meta}</CardMeta>}
    {value.status && <CardStatus>{value.status}</CardStatus>}</CardByline>;
}
function Details({ store, context }: { store: PresentationStore; context: ModalContext }) {
  const value = React.useSyncExternalStore(store.subscribe, store.read, store.read);
  React.useLayoutEffect(() => { modals.projectPresentation(context.id, context.signal, {
    title: modalTitle(value), description: modalDescription(value), meta: modalMeta(value),
  }); }, [context.id, context.signal, value.title, value.detailsTitle, value.description, value.meta]);
  return <div data-slot="content-card-details">
    {typeof value.details === 'function' ? value.details(context) : value.details}
  </div>;
}
const safePreviewText = (node: React.ReactNode) => typeof node === 'string' || typeof node === 'number' ? node : undefined;
function modalDescription(value: Presentation) { return safePreviewText(value.description); }
function modalMeta(value: Presentation) { return safePreviewText(value.meta); }
function reportNotificationFailure(): void {
  emitFrontendCode(OBS_CODES.FRONTEND_MODAL_CALLBACK_FAILED, { metadata: { surface: 'content-card', stage: 'notification' } });
}
function notifyOpenChange(callback: ContentCardProps['onOpenChange'], open: boolean): void {
  try { void Promise.resolve(callback?.(open)).catch(reportNotificationFailure); } catch { reportNotificationFailure(); }
}

/** Compact Arc-inspired content composition; title trigger is the only activation surface, custom actions stay native. */
export function ContentCard({ title, htmlTitle, description, media, action, avatar, meta, status, children,
  density = 'compact', details, detailsTitle, detailsOptions, identity: suppliedIdentity, open: controlledOpen,
  defaultOpen = false, onOpenChange, className, style, ref, onPointerEnter, onPointerLeave, ...props }: ContentCardProps) {
  const generatedId = React.useId(), identity = suppliedIdentity ?? generatedId;
  const owner = useOverlayScope();
  const [element, setElement] = React.useState<HTMLElement | null>(null), [hovered, setHovered] = React.useState(false);
  const rootRef = React.useMemo(() => composeOverlayRefs<HTMLElement>(setElement, ref), [ref]);
  const titleRef = React.useRef<HTMLButtonElement>(null), [mediaElement, setMediaElement] = React.useState<HTMLDivElement | null>(null);
  const capturedTrigger = React.useRef<Element | null>(null), capturedFocus = React.useRef<HTMLElement | null>(null);
  const [internalOpen, setInternalOpen] = React.useState(defaultOpen), [presented, setPresented] = React.useState(false);
  const isOpen = details != null && (controlledOpen ?? internalOpen);
  const reduced = Boolean(useMediaQuery('(prefers-reduced-motion: reduce)'));
  const feedback = useCardFeedback(element, reduced);
  useCardHoverFeedback(element, mediaElement, hovered, reduced, feedback);
  const snapshot = presentation({ title, description, meta, details, detailsTitle });
  const storeRef = React.useRef<PresentationStore | null>(null);
  if (!storeRef.current) storeRef.current = createPresentationStore(snapshot);
  const store = storeRef.current;
  const latestSnapshot = React.useRef(snapshot); latestSnapshot.current = snapshot;
  const live = React.useRef({ controlledOpen, onOpenChange, mounted: true });
  live.current = { controlledOpen, onOpenChange, mounted: live.current.mounted };
  const opening = React.useRef<Opening | null>(null);
  const closed = React.useRef<{ identity: string | number; parentId?: string } | null>(null);

  React.useLayoutEffect(() => {
    // Never briefly project a replacement record into the previous record's still-owned body.
    const current = opening.current;
    if (!current || (current.identity === identity && current.parentId === owner?.id)) store.publish(snapshot);
  });
  React.useEffect(() => {
    const parentId = owner?.id;
    if (!isOpen || (closed.current && (closed.current.identity !== identity || closed.current.parentId !== parentId))) closed.current = null;
    const previous = opening.current;
    if (previous && (!isOpen || previous.identity !== identity || previous.parentId !== parentId)) {
      previous.suppressNotification = true; opening.current = null; setPresented(false);
      modals.disposeHost([previous.handle.id]);
    }
    if (!isOpen || opening.current || closed.current || !element) return;
    // Delay only admission, not geometry. StrictMode cleanup can cancel the first setup before it creates a writer.
    const view = element.ownerDocument.defaultView;
    if (!view) return;
    const frame = view.requestAnimationFrame(() => {
      if (!live.current.mounted || !element.isConnected || opening.current) return;
      const parent = parentId ? modals.getContext(parentId) : undefined;
      if (parentId && (!parent || parent.signal.aborted)) return;
      const trigger = capturedTrigger.current?.isConnected ? capturedTrigger.current : element;
      const focus = capturedFocus.current?.isConnected ? capturedFocus.current : titleRef.current;
      store.publish(latestSnapshot.current);
      const descriptor = { ...detailsOptions, title: modalTitle(store.read()), description: modalDescription(store.read()),
        meta: modalMeta(store.read()), trigger, dataSlot: 'content-card-quick-look',
        onCloseAutoFocus: (event: Event) => { if (focus?.isConnected) { event.preventDefault(); focus.focus({ preventScroll: true }); } },
        body: (context: ModalContext) => <Details store={store} context={context} />,
      };
      const handle = parent ? parent.show(descriptor) : modals.show(descriptor);
      const record: Opening = { handle, identity, parentId, suppressNotification: false }; opening.current = record;
      setPresented(true);
      void handle.result.then(() => {
        if (opening.current !== record) return;
        opening.current = null;
        if (!live.current.mounted || record.suppressNotification) return;
        setPresented(false);
        closed.current = { identity: record.identity, parentId: record.parentId };
        if (live.current.controlledOpen === undefined) setInternalOpen(false);
        notifyOpenChange(live.current.onOpenChange, false);
      });
    });
    return () => view.cancelAnimationFrame(frame);
  }, [isOpen, identity, element, owner?.id, store]);

  React.useEffect(() => {
    live.current.mounted = true;
    return () => {
      live.current.mounted = false;
      const record = opening.current; opening.current = null;
      if (record) { record.suppressNotification = true; modals.disposeHost([record.handle.id]); }
    };
  }, []);

  const requestOpen = () => {
    capturedTrigger.current = element; capturedFocus.current = titleRef.current;
    if (controlledOpen === undefined) setInternalOpen(true);
    notifyOpenChange(onOpenChange, true);
  };
  return <Card asChild density={density} data-slot="content-card" className={cn('zero-content-card', className)} style={style}>
    <article {...props} title={htmlTitle} ref={rootRef} data-zero-card-hovered={hovered || undefined}
      onPointerEnter={event => { onPointerEnter?.(event); if (!event.defaultPrevented && event.pointerType === 'mouse') setHovered(true); }}
      onPointerLeave={event => { onPointerLeave?.(event); setHovered(false); }}>
      {media != null && <CardMedia><div ref={setMediaElement} className="zero-content-card-media">{media}</div></CardMedia>}
      <CardHeader><CardTitle asChild><h3>{details != null ? <button ref={titleRef} type="button" className="zero-content-card-trigger"
        aria-haspopup="dialog" aria-expanded={presented} onClick={requestOpen}>{title}</button> : title}</h3></CardTitle>
        {description != null && <CardDescription className="max-w-[34ch]">{description}</CardDescription>}
      </CardHeader>
      {children != null && <CardContent>{children}</CardContent>}
      {(avatar != null || meta != null || status || action != null) && <CardFooter className="justify-between gap-3">
        <Byline value={{ avatar, meta, status }} />{action != null && <CardAction className="ml-auto">{action}</CardAction>}
      </CardFooter>}
    </article>
  </Card>;
}
