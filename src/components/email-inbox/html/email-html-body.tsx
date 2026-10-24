'use client';

import * as React from 'react';
import { ImageOff, ShieldCheck } from 'lucide-react';
import { Button } from '../../ui/button';
import { ScrollArea } from '../../ui/scroll-area';
import { cn } from '../../../lib/utils';
import { prepareEmailHtml, type EmailInlineImage } from './prepare-email-html';
import { createEmailDocument } from './email-document';
import { emailInlineImage } from './email-inline-image';
import { emailUrl, normalizedContentId } from './email-html-policy';

export interface EmailHtmlBodyProps {
  html: string;
  text?: string;
  /** Must change when the account, message revision or authorization scope changes. */
  contentKey: string;
  className?: string;
  title?: string;
  /** Authorized loader for a CID in this message; never a raw remote URL fetcher. */
  loadInlineImage?: (contentId: string, signal: AbortSignal) => Promise<Uint8Array>;
  onOpenLink?: (url: string) => void;
  allowRemoteImages?: boolean;
}

export function EmailPlainTextBody({ text, className }: { text: string; className?: string }) {
  return <div data-slot="email-plain-text" className={cn('whitespace-pre-wrap break-words text-[14px] leading-7', className)} dir="auto">{text}</div>;
}

/** Scriptless, CSS-isolated mail. Same-origin is exclusively for parent sizing/link listeners. */
export function EmailHtmlBody({ html, text = '', contentKey, className, title = 'Email content', loadInlineImage, onOpenLink,
  allowRemoteImages = true }: EmailHtmlBodyProps) {
  const [remoteKey, setRemoteKey] = React.useState<string | null>(null);
  const [state, setState] = React.useState<{ key: string; document: string; blocked: number; error?: string } | null>(null);
  const [height, setHeight] = React.useState(80);
  const [contentWidth, setContentWidth] = React.useState(0);
  const [inlineNotice, setInlineNotice] = React.useState(false);
  const frame = React.useRef<HTMLIFrameElement>(null), viewport = React.useRef<HTMLDivElement>(null), host = React.useRef<HTMLDivElement>(null), generation = React.useRef(0), cleanup = React.useRef<() => void>(() => {});
  const remote = allowRemoteImages && remoteKey === contentKey;
  React.useEffect(() => {
    const abort = new AbortController(), current = ++generation.current;
    setState(null); setHeight(80); setContentWidth(0); setInlineNotice(false); cleanup.current();
    const options = { appOrigin: window.location.origin, loadRemoteImages: remote };
    void (async () => {
      try {
        const initial = prepareEmailHtml(html, options);
        const publish = (images: EmailInlineImage[]) => {
          if (abort.signal.aborted || generation.current !== current) return;
          const prepared = images.length ? prepareEmailHtml(html, { ...options, inlineImages: images }) : initial;
          setState({ key: contentKey, document: createEmailDocument(prepared, window), blocked: prepared.blockedImages });
        };
        publish([]);
        if (!loadInlineImage || !initial.contentIds.length) return;
        const images: EmailInlineImage[] = [];
        // Bound concurrency and aggregate bytes. Do not open 100 simultaneous mailbox reads.
        let loadedBytes = 0;
        for (const id of initial.contentIds) {
          if (abort.signal.aborted) return;
          try {
            const bytes = await loadInlineImage(normalizedContentId(id), abort.signal);
            loadedBytes += bytes.byteLength;
            if (abort.signal.aborted || generation.current !== current) return;
            if (loadedBytes > 12 * 1024 * 1024) { setInlineNotice(true); break; }
            images.push({ contentId: id, url: emailInlineImage(bytes).url });
          } catch { if (!abort.signal.aborted && generation.current === current) setInlineNotice(true); }
        }
        publish(images);
      } catch (error) {
        if (!abort.signal.aborted && generation.current === current) setState({ key: contentKey, document: '', blocked: 0,
          error: error instanceof Error ? error.message : 'This message could not be safely displayed.' });
      }
    })();
    return () => { abort.abort(); generation.current++; cleanup.current(); };
  }, [html, contentKey, remote, loadInlineImage]);

  React.useEffect(() => {
    const element = host.current; if (!element) return;
    let previous = element.clientWidth;
    const observer = new ResizeObserver(() => { if (element.clientWidth !== previous) { previous = element.clientWidth; setContentWidth(0); } });
    observer.observe(element); return () => observer.disconnect();
  }, []);

  const ready = state?.key === contentKey ? state : null;
  const loaded = React.useCallback(() => {
    cleanup.current();
    const iframe = frame.current, doc = iframe?.contentDocument, view = doc?.defaultView;
    if (!iframe || !doc?.body || !view) return;
    let raf = 0, previous = -1, repeats = 0;
    const measure = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        if (frame.current !== iframe || !iframe.isConnected) return;
        const next = Math.ceil(Math.max(doc.body.scrollHeight, doc.body.getBoundingClientRect().height));
        if (!Number.isFinite(next) || next < 0) return;
        // A sender's layout must never create an unbounded iframe resize feedback loop.
        repeats = Math.abs(next - previous) <= 1 ? 0 : repeats + 1; previous = next;
        if (repeats < 20) setHeight(Math.max(24, Math.min(200_000, next + 2)));
        const width = Math.ceil(doc.body.scrollWidth), available = viewport.current?.clientWidth ?? width;
        if (width > available + 2) setContentWidth(Math.min(10_000, width));
      });
    };
    const links = (event: Event) => {
      if (!(event.target instanceof view.Element)) return;
      const anchor = event.target.closest('a[href]'); if (!anchor) return;
      const value = anchor.getAttribute('href') ?? '';
      if (value.startsWith('#')) return;
      event.preventDefault(); event.stopPropagation();
      const url = emailUrl(value, 'link');
      if (url) { if (onOpenLink) onOpenLink(url); else window.open(url, '_blank', 'noopener,noreferrer'); }
    };
    const observer = new view.ResizeObserver(measure); observer.observe(doc.body);
    doc.addEventListener('click', links, true); doc.addEventListener('auxclick', links, true);
    doc.addEventListener('load', measure, true); view.addEventListener('resize', measure); measure();
    cleanup.current = () => { observer.disconnect(); cancelAnimationFrame(raf); doc.removeEventListener('click', links, true);
      doc.removeEventListener('auxclick', links, true); doc.removeEventListener('load', measure, true); view.removeEventListener('resize', measure); };
  }, [onOpenLink]);

  return <div ref={host} data-slot="email-html-body" className={cn('min-w-0', className)}>
    {ready?.error ? <><div role="status" className="mb-4 flex items-start gap-2 rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground"><ShieldCheck className="mt-0.5 size-4 shrink-0" />{ready.error} Showing plain text.</div><EmailPlainTextBody text={text || 'No plain-text alternative was provided.'} /></>
      : <>
        {!!ready?.blocked && <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-muted/25 px-3 py-2 text-xs text-muted-foreground" role="status">
          <span className="flex items-center gap-2"><ImageOff className="size-3.5" />Remote images are blocked to protect your privacy.</span>
          {allowRemoteImages && <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setRemoteKey(contentKey)}>Load images</Button>}
        </div>}
        {remote && <p className="mb-3 text-[11px] text-muted-foreground" role="status">Remote images are enabled for this message. The sender may learn it was opened.</p>}
        {inlineNotice && <p className="mb-3 text-xs text-muted-foreground" role="status">Some inline images could not be safely loaded.</p>}
        {!ready && <p className="py-6 text-xs text-muted-foreground" role="status">Preparing message…</p>}
        {ready && <ScrollArea orientation="horizontal" viewportRef={viewport} style={{ height }} className="w-full" scrollChaining="auto"><iframe ref={frame} title={title} sandbox="allow-same-origin" referrerPolicy="no-referrer" srcDoc={ready.document}
          onLoad={loaded} scrolling="no" className="block w-full border-0 bg-white" style={{ height, minWidth: contentWidth || undefined }} /></ScrollArea>}
      </>}
  </div>;
}
