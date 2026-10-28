'use client';

/** Native private media selection/upload using the supplied Zero facade and owned modal. Never exposes Storage paths or constructs upload grants. */
import * as React from 'react';
import { FileImage, FileAudio, FileVideo } from 'lucide-react';
import { Upload } from '../animate-ui/icons/upload';
import { Button } from '../ui/button';
import { ControlledModal } from '../../modals/modal-controlled';
import type { ModalContext } from '../../modals/modal-system.types';
import type { BlogBrowserMediaApi, BlogMediaKind, BlogMediaAsset } from '../../blog/media-types';
import type { BlogPage } from '../../blog/content-types';

export interface BlogMediaPickerProps { api: BlogBrowserMediaApi; kind: BlogMediaKind; value: string; onChange(id: string): void; disabled?: boolean }
/** Selection changes a draft only; publication remains a separate acknowledged post command. */
export function BlogMediaPicker({ api, kind, value, onChange, disabled }: BlogMediaPickerProps) {
  const [open, setOpen] = React.useState(false), [origin, setOrigin] = React.useState<HTMLButtonElement | null>(null);
  return <>{value && kind === 'image' && <BlogPrivateImage api={api} id={value} />}<Button ref={setOrigin} type="button" variant="outline" disabled={disabled} onClick={() => setOpen(true)}>{kind === 'image' ? <FileImage /> : kind === 'audio' ? <FileAudio /> : <FileVideo />}{value ? `Replace ${kind}` : `Choose ${kind}`}</Button>
    <ControlledModal open={open} onOpenChange={setOpen} descriptor={{ title: `${kind[0]!.toUpperCase() + kind.slice(1)} library`, size: 'lg', trigger: origin,
      body: context => <MediaLibrary api={api} kind={kind} context={context} onSelect={id => { onChange(id); context.accept(id); }} /> }} />
  </>;
}
const ACCEPT = { image: 'image/jpeg,image/png,image/webp', audio: 'audio/mpeg,audio/mp4,audio/ogg,audio/wav,audio/webm', video: 'video/mp4,video/webm' };
function MediaLibrary({ api, kind, context, onSelect }: { api: BlogBrowserMediaApi; kind: BlogMediaKind; context: ModalContext<unknown>; onSelect(id: string): void }) {
  const [page, setPage] = React.useState<BlogPage<BlogMediaAsset> | null>(null), [offset, setOffset] = React.useState(0), [version, setVersion] = React.useState(0);
  const [error, setError] = React.useState<string | null>(null), [progress, setProgress] = React.useState<string | null>(null);
  const pending = React.useRef<{ file: File; allocation: string; upload: string; id?: string } | null>(null), alive = React.useRef(true);
  React.useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  React.useEffect(() => {
    const owner = new AbortController(), signal = AbortSignal.any([owner.signal, context.signal]); setPage(null);
    void api.list({ kind, limit: 12, offset }, { signal }).then(result => { if (!signal.aborted) setPage(result); }).catch(() => { if (!signal.aborted) setError('The private media library could not be loaded.'); });
    return () => owner.abort();
  }, [api, kind, offset, version, context.signal]);
  const upload = async (file?: File) => {
    if (progress) return;
    if (file) pending.current = { file, allocation: crypto.randomUUID(), upload: crypto.randomUUID() };
    const attempt = pending.current; if (!attempt) return;
    const current = () => alive.current && !context.signal.aborted;
    setError(null); setProgress('Preparing upload…'); context.setBusy(true);
    try {
      if (!attempt.id) { const asset = await api.allocate({ kind, fileName: attempt.file.name, mimeType: attempt.file.type }, { requestId: attempt.allocation, signal: context.signal }); attempt.id = asset.id; }
      if (!current()) return; setProgress('Uploading and validating media…');
      const accepted = await api.upload(attempt.id, attempt.file, { requestId: attempt.upload, signal: context.signal });
      if (current()) { pending.current = null; context.setBusy(false); onSelect(accepted.id); }
    } catch { if (current()) setError('Upload was not confirmed. Retry uses the same file and request identities; a new upload is not silently created.'); }
    finally { if (current()) { setProgress(null); context.setBusy(false); } }
  };
  return <div className="zero-blog-media-library">
    <label className="zero-blog-upload"><Upload aria-hidden="true" />Upload {kind}<input aria-label={`Upload ${kind}`} type="file" accept={ACCEPT[kind]} disabled={Boolean(progress)} onChange={event => { const file = event.target.files?.[0]; if (file) void upload(file); event.target.value = ''; }} /></label>
    {progress && <p role="status">{progress}</p>}
    {error && <div role="alert"><p>{error}</p><Button type="button" variant="outline" disabled={Boolean(progress)} onClick={() => pending.current ? void upload() : setVersion(value => value + 1)}>Retry</Button></div>}
    {!page && !error && <p role="status">Loading private media…</p>}
    {page && <><ul>{page.items.map(asset => <li key={asset.id}><div><strong>{asset.fileName}</strong><span>{asset.state}{asset.sizeBytes !== null ? ` · ${Math.round(asset.sizeBytes / 1024)} KiB` : ''}{asset.width ? ` · ${asset.width} × ${asset.height}` : ''}</span></div>
      <Button type="button" variant="outline" size="sm" disabled={asset.state !== 'ready' || Boolean(progress)} onClick={() => onSelect(asset.id)}>Use {kind}</Button></li>)}</ul>
      {!page.items.length && <p>No media yet. Upload the first {kind}.</p>}
      <nav aria-label="Media pages"><Button type="button" variant="ghost" disabled={offset === 0 || Boolean(progress)} onClick={() => setOffset(Math.max(0, offset - 12))}>Previous</Button><Button type="button" variant="ghost" disabled={!page.hasMore || Boolean(progress)} onClick={() => setOffset(offset + 12)}>Next</Button></nav>
    </>}
  </div>;
}
/** Object URLs are scope/component-local and revoked on replacement. Private delivery never relies on a naked native img request. */
export function BlogPrivateImage({ api, id, alt = '' }: { api: BlogBrowserMediaApi; id: string; alt?: string }) {
  const [image, setImage] = React.useState<{ api: BlogBrowserMediaApi; id: string; url: string } | null>(null), [error, setError] = React.useState(false), [retry, setRetry] = React.useState(0);
  const [host, setHost] = React.useState<HTMLDivElement | null>(null), [visible, setVisible] = React.useState(false);
  React.useEffect(() => {
    if (!host) return;
    if (typeof IntersectionObserver === 'undefined') { setVisible(true); return; }
    const observer = new IntersectionObserver(entries => setVisible(entries.some(entry => entry.isIntersecting)), { rootMargin: '80px' }); observer.observe(host);
    return () => observer.disconnect();
  }, [host]);
  React.useEffect(() => {
    if (!visible || !id) return;
    const owner = new AbortController(); let url: string | null = null; setError(false);
    void api.imagePreview(id, { signal: owner.signal }).then(blob => { if (!owner.signal.aborted) { url = URL.createObjectURL(blob); setImage({ api, id, url }); } }).catch(() => { if (!owner.signal.aborted) setError(true); });
    return () => { owner.abort(); if (url) URL.revokeObjectURL(url); setImage(null); };
  }, [api, id, retry, visible]);
  return <div ref={setHost} className="zero-blog-private-image-slot">{visible && error ? <Button type="button" variant="ghost" onClick={() => setRetry(value => value + 1)}>Retry private image preview</Button>
    : visible && image?.id === id && image.api === api ? <img src={image.url} alt={alt} className="zero-blog-private-image" /> : <span role={visible ? 'status' : undefined}>{id ? visible ? 'Loading private image…' : 'Private image preview' : 'Choose an image to preview'}</span>}</div>;
}
