'use client';

import * as React from 'react';
import { ExternalLink } from '../animate-ui/icons/external-link';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Popover, PopoverTrigger, PopoverContent, PopoverViewport } from '../surfaces/popover';
import { cn } from '../../lib/utils';
import { BlogLink } from './blog-provider';
import { safeBlogHref } from './blog-utils';

export function InlineLink({ children, href, ...props }: React.ComponentProps<typeof BlogLink>) {
  return <BlogLink {...props} href={href} className={cn('zero-blog-inline-link', props.className)}>{children}{/^https?:/u.test(href) && <ExternalLink aria-hidden="true" />}</BlogLink>;
}
export function InlineLinkPreview({ href, children, title, description, image }: { href: string; children?: React.ReactNode; title?: string; description?: string; image?: string }) {
  return <span className="zero-blog-link-preview"><InlineLink href={href}>{children ?? title ?? href}</InlineLink><Popover><PopoverTrigger asChild><Button type="button" variant="ghost" size="icon-xs" aria-label={`Preview ${title ?? 'link'}`}><ExternalLink /></Button></PopoverTrigger>
    <PopoverContent className="zero-blog-overlay zero-blog-preview"><PopoverViewport>{safeBlogHref(image) && <img src={safeBlogHref(image)} alt="" loading="lazy" />}{title && <strong>{title}</strong>}{description && <p>{description}</p>}<InlineLink href={href}>Open link</InlineLink></PopoverViewport></PopoverContent>
  </Popover></span>;
}
export function DemoLink({ label = 'View demo', children }: { label?: string; children: React.ReactNode }) {
  return <details className="zero-blog-demo"><summary>{label}</summary><div>{children}</div></details>;
}
export interface BlogCitation { id: string; text?: string; source: string; url?: string; author?: string; date?: string }
const CitationContext = React.createContext<{ entries: readonly BlogCitation[]; prefix: string }>({ entries: [], prefix: 'citation' });
export function CitationProvider({ citations, children }: { citations: readonly BlogCitation[]; children: React.ReactNode }) {
  const prefix = React.useId().replace(/[^a-zA-Z0-9]/gu, '');
  return <CitationContext.Provider value={{ entries: citations, prefix }}>{children}</CitationContext.Provider>;
}
export function CitationRef({ id }: { id: string }) {
  const { entries, prefix } = React.useContext(CitationContext), index = entries.findIndex(entry => entry.id === id), entry = entries[index];
  if (!entry) return null;
  return <sup><a href={`#citation-${prefix}-${index + 1}`} aria-label={`Reference ${index + 1}`}>[{index + 1}]</a></sup>;
}
export function CitationsList({ title = 'References' }: { title?: string }) {
  const { entries, prefix } = React.useContext(CitationContext); if (!entries.length) return null;
  return <section className="zero-blog-citations"><h2>{title}</h2><ol>{entries.map((entry, index) => <li key={entry.id} id={`citation-${prefix}-${index + 1}`}>{entry.author && `${entry.author}. `}{entry.url ? <InlineLink href={entry.url}>{entry.source}</InlineLink> : entry.source}{entry.date && ` (${entry.date})`}</li>)}</ol></section>;
}
export function Glimpse({ term, definition, children }: { term: string; definition: React.ReactNode; children?: React.ReactNode }) {
  return <Popover><PopoverTrigger asChild><button type="button" className="zero-blog-glimpse">{children ?? term}</button></PopoverTrigger><PopoverContent className="zero-blog-overlay"><PopoverViewport><strong>{term}</strong><div>{definition}</div></PopoverViewport></PopoverContent></Popover>;
}
export interface NewsletterSignupProps {
  title?: string; description?: string; buttonLabel?: string; consent?: React.ReactNode; className?: string;
  onSubscribe?: (email: string, context: { signal: AbortSignal }) => void | Promise<void>;
  onError?: (error: unknown) => void;
}
/** No fabricated success: missing integration omits the form; success follows the caller's resolved callback. */
export function NewsletterSignup({ title = 'Stay in the loop', description, buttonLabel = 'Subscribe', consent, className, onSubscribe, onError }: NewsletterSignupProps) {
  const [pending, setPending] = React.useState(false), [status, setStatus] = React.useState<'idle' | 'success' | 'error'>('idle'), [email, setEmail] = React.useState('');
  const id = React.useId(), operation = React.useRef<AbortController | null>(null);
  React.useEffect(() => () => { operation.current?.abort(); }, []);
  if (!onSubscribe) return null;
  return <section className={cn('zero-blog-newsletter', className)}><h2>{title}</h2>{description && <p>{description}</p>}
    <form onSubmit={event => {
      event.preventDefault(); if (operation.current) return;
      const controller = new AbortController(); operation.current = controller; setPending(true); setStatus('idle');
      void (async () => {
        try { await onSubscribe(email, { signal: controller.signal }); if (!controller.signal.aborted) setStatus('success'); }
        catch (cause) { if (!controller.signal.aborted) { setStatus('error'); try { onError?.(cause); } catch { /* Observer only. */ } } }
        finally { if (operation.current === controller) { operation.current = null; if (!controller.signal.aborted) setPending(false); } }
      })();
    }}><label className="sr-only" htmlFor={id}>Email address</label><Input id={id} type="email" name="email" autoComplete="email" required disabled={pending} placeholder="you@example.com" value={email} onChange={event => { setEmail(event.currentTarget.value); setStatus('idle'); }} /><Button type="submit" disabled={pending}>{pending ? 'Subscribing…' : buttonLabel}</Button></form>
    {consent}<p role="status">{status === 'success' ? 'You’re subscribed.' : status === 'error' ? 'Subscription could not be completed. Please try again.' : ''}</p>
  </section>;
}
export { NewsletterSignup as NewsletterSignupCompact };
