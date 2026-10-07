'use client';

/** Tokenized accessible react-easy-crop wrapper. Owns one local crop draft; the caller owns acknowledged avatar persistence. */
import { useEffect, useRef, useState } from 'react';
import Cropper, { type Area } from 'react-easy-crop';
import { Minus, Plus } from 'lucide-react';
import { useReducedMotion } from 'motion/react';
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogFooter, type DialogContentProps } from '../animate-ui/components/radix/dialog';
import { Button } from '../ui/button';
import { cn } from '../../lib/utils';
import type { UserAvatarCapabilities } from '../../auth/auth-user-avatar-types';
import { exportAvatarCrop } from './avatar-crop-image';
import { userAvatarError } from '../../frontend/client/user-avatar-errors';
import { reportAuthClientActionFailure } from '../../frontend/client/auth-action-observability';

export interface AvatarCropDialogProps {
  open: boolean;
  image: Blob;
  capabilities: UserAvatarCapabilities;
  readOnly?: boolean;
  onOpenChange(open: boolean): void;
  /** Resolves only after the caller's acknowledged save; rejection keeps the crop and actionable retry state. */
  onSave(image: Blob, signal: AbortSignal): Promise<void>;
  onCloseAutoFocus?: DialogContentProps['onCloseAutoFocus'];
  /** Explicitly discard this crop to review newer state; false retains it (for example, a Stay decision). */
  onReviewLatest?(): Promise<boolean>;
  className?: string;
}
/** Fade-only dialog avoids scaling the crop library's measured parent. Circle presentation still stores a square raster. */
export function AvatarCropDialog(props: AvatarCropDialogProps) {
  return <Dialog open={props.open} onOpenChange={props.onOpenChange}>
    {props.open && <AvatarCropDraft key={`${props.capabilities.shape}:${props.capabilities.outputSize}`} {...props} />}
  </Dialog>;
}
function AvatarCropDraft({ image, capabilities, readOnly, onOpenChange, onSave, onCloseAutoFocus, onReviewLatest, className }: AvatarCropDialogProps) {
  const [source, setSource] = useState<string | null>(null), [crop, setCrop] = useState({ x: 0, y: 0 }), [zoom, setZoom] = useState(1);
  const [area, setArea] = useState<Area | null>(null), [error, setError] = useState<string | null>(null), [pending, setPending] = useState(false);
  const [invalidMedia, setInvalidMedia] = useState(false);
  const mounted = useRef(true), operation = useRef<AbortController | null>(null), latest = useRef({ readOnly, image, onSave });
  latest.current = { readOnly, image, onSave }; const reducedMotion = useReducedMotion();
  useEffect(() => {
    mounted.current = true;
    operation.current?.abort(); operation.current = null; setPending(false);
    setArea(null); setCrop({ x: 0, y: 0 }); setZoom(1); setSource(null); setError(null); setInvalidMedia(false);
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(image.type) || !image.size || image.size > capabilities.maxUploadBytes) {
      setInvalidMedia(true); setError('Choose a JPEG, PNG or WebP image within the configured size limit.');
      return () => { mounted.current = false; operation.current?.abort(); };
    }
    const url = URL.createObjectURL(image); setSource(url);
    return () => { mounted.current = false; operation.current?.abort(); URL.revokeObjectURL(url); };
  }, [image, capabilities.maxUploadBytes]);
  useEffect(() => { if (readOnly) { operation.current?.abort(); operation.current = null; setPending(false); } }, [readOnly]);
  const save = async () => {
    if (!area || invalidMedia || readOnly || latest.current.readOnly || operation.current) return;
    const controller = new AbortController(), original = image; operation.current = controller; setPending(true); setError(null);
    const current = () => mounted.current && operation.current === controller && !controller.signal.aborted
      && !latest.current.readOnly && latest.current.image === original;
    try {
      const blob = await exportAvatarCrop(original, area, capabilities, controller.signal);
      if (!current()) return;
      await latest.current.onSave(blob, controller.signal);
      if (current()) onOpenChange(false);
    } catch (cause) {
      if (!current() || cause instanceof DOMException && cause.name === 'AbortError') return;
      reportAuthClientActionFailure('avatarCrop', cause, { codeOnly: true }); setError(userAvatarError(cause));
    } finally { if (operation.current === controller) { operation.current = null; if (mounted.current) setPending(false); } }
  };
  const cancel = () => { operation.current?.abort(); operation.current = null; onOpenChange(false); };
  const review = async () => {
    if (!onReviewLatest || readOnly || operation.current) return;
    const controller = new AbortController(); operation.current = controller; setPending(true);
    try {
      const admitted = await onReviewLatest();
      if (admitted && mounted.current && operation.current === controller && !controller.signal.aborted) onOpenChange(false);
    } catch (cause) {
      if (mounted.current && operation.current === controller && !controller.signal.aborted) {
        reportAuthClientActionFailure('avatarReview', cause, { codeOnly: true }); setError(userAvatarError(cause));
      }
    } finally { if (operation.current === controller) { operation.current = null; if (mounted.current) setPending(false); } }
  };
  return <DialogContent className={cn('zero-avatar-crop-dialog', className)} showCloseButton={false}
    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
    transition={{ duration: reducedMotion ? 0 : .16 }}
    onCloseAutoFocus={onCloseAutoFocus}
    onEscapeKeyDown={event => { event.preventDefault(); cancel(); }} onInteractOutside={event => event.preventDefault()}>
    <header><DialogTitle>Choose your crop</DialogTitle><DialogDescription>Drag the image to position it. Zoom to keep what matters in frame.</DialogDescription></header>
    <div data-slot="avatar-crop-surface" className="zero-avatar-crop-surface" aria-label="Profile picture crop">
      {source && <Cropper image={source} crop={crop} zoom={zoom} rotation={0} aspect={1} minZoom={1} maxZoom={3}
        cropShape={capabilities.shape === 'circle' ? 'round' : 'rect'} showGrid={false} restrictPosition
        disableAutomaticStylesInjection keyboardStep={5}
        mediaProps={{ onError: () => { setInvalidMedia(true); setArea(null); setError('This image could not be read. Choose a valid JPEG, PNG or WebP image.'); } }}
        cropperProps={{ tabIndex: readOnly || pending ? -1 : 0, 'aria-label': 'Move profile picture crop using arrow keys' }}
        onCropChange={value => { if (!readOnly && !pending) setCrop(value); }} onZoomChange={value => { if (!readOnly && !pending) setZoom(value); }}
        onCropAreaChange={(_percent, pixels) => setArea(pixels)}
        onMediaLoaded={media => {
          if (media.naturalWidth * media.naturalHeight > capabilities.maxPixels) {
            setInvalidMedia(true); setArea(null); setError('This image has too many pixels. Choose a smaller image.');
          }
        }} classes={{ containerClassName: 'zero-avatar-crop-container', cropAreaClassName: 'zero-avatar-crop-area' }} />}
    </div>
    <div className="zero-avatar-crop-tools" aria-label="Crop zoom">
      <Button type="button" size="icon" variant="outline" animateIcon={false} aria-label="Zoom out" disabled={readOnly || pending || zoom <= 1}
        onClick={() => setZoom(value => Math.max(1, value - .2))}><Minus /></Button>
      <output aria-live="polite">{Math.round(zoom * 100)}%</output>
      <Button type="button" size="icon" variant="outline" animateIcon={false} aria-label="Zoom in" disabled={readOnly || pending || zoom >= 3}
        onClick={() => setZoom(value => Math.min(3, value + .2))}><Plus /></Button>
    </div>
    {error && <div><p role="alert" className="zero-avatar-editor-error">{error}</p>
      {onReviewLatest && !invalidMedia && <><p className="zero-avatar-editor-hint">Keep this crop and retry, or discard it to review the latest profile.</p>
        <Button type="button" size="sm" variant="ghost" disabled={readOnly || pending} onClick={() => { void review(); }}>Review latest profile</Button></>}
    </div>}
    <DialogFooter><Button type="button" size="sm" variant="ghost" onClick={cancel}>Cancel</Button>
      <Button type="button" size="sm" disabled={readOnly || pending || !area || invalidMedia} onClick={() => { void save(); }}>
        {pending ? 'Saving picture…' : 'Save picture'}</Button></DialogFooter>
  </DialogContent>;
}
