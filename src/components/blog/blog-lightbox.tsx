'use client';

import * as React from 'react';
import { Minus, ScanSearch } from 'lucide-react';
import { ChevronLeft } from '../animate-ui/icons/chevron-left';
import { ChevronRight } from '../animate-ui/icons/chevron-right';
import { Plus } from '../animate-ui/icons/plus';
import { Button } from '../ui/button';
import { ScrollArea } from '../ui/scroll-area';
import { ControlledModal } from '../../modals/modal-controlled';
import type { ModalMotionOptions } from '../../modals/modal-motion-types';
import type { ModalSize } from '../../modals/modal.types';
import { cn } from '../../lib/utils';
import { safeBlogHref } from './blog-utils';
import type { BlogImage } from './blog.types';

export interface ImageZoomOptions { enabled?: boolean; min?: number; max?: number; step?: number; defaultZoom?: number }
export interface ImageLensOptions { enabled?: boolean; defaultActive?: boolean; size?: number; magnification?: number; shape?: 'circle' | 'square' }
const bounded = (value: number | undefined, fallback: number, min: number, max: number) => Number.isFinite(value) ? Math.max(min, Math.min(max, value!)) : fallback;
export function resolveImageZoom(value?: false | ImageZoomOptions) {
  const options = value || {}, enabled = value !== false && options.enabled !== false;
  const min = bounded(options.min, 1, .5, 2), max = bounded(options.max, 3, min, 8);
  return { enabled, min, max, step: bounded(options.step, .5, .1, 2), initial: enabled ? bounded(options.defaultZoom, Math.max(min, Math.min(max, 1)), min, max) : 1 };
}
export interface BlogImageLightboxProps {
  open: boolean; image?: BlogImage; images?: readonly BlogImage[]; activeIndex?: number; onIndexChange?: (index: number) => void;
  trigger?: HTMLElement | null; onOpenChange: (open: boolean) => void; zoom?: false | ImageZoomOptions; lens?: false | ImageLensOptions;
  loop?: boolean; showThumbnails?: boolean; maxThumbnails?: number; download?: boolean; size?: ModalSize; motion?: ModalMotionOptions; className?: string;
}
export function BlogImageLightbox({ open, image, images: supplied, activeIndex, onIndexChange, trigger, onOpenChange, zoom, lens, loop = false, showThumbnails = true, maxThumbnails = 40, download = false, size = 'xl', motion, className }: BlogImageLightboxProps) {
  const [localIndex, setIndex] = React.useState(0), images = supplied?.length ? supplied : image ? [image] : [];
  const index = Math.floor(bounded(activeIndex ?? localIndex, 0, 0, Math.max(0, images.length - 1))), current = images[index];
  const select = (next: number) => { if (activeIndex === undefined) setIndex(next); onIndexChange?.(next); };
  const step = (delta: number) => select(loop ? (index + delta + images.length) % images.length : Math.max(0, Math.min(images.length - 1, index + delta)));
  return <ControlledModal open={open && !!current && !!safeBlogHref(current.src)} onOpenChange={onOpenChange}
    descriptor={{ title: current?.caption ?? current?.alt ?? 'Image preview', trigger, size, motion,
      className: cn('zero-blog-overlay zero-public zero-blog-lightbox', className),
      body: current ? <ImageViewer image={current} images={images} index={index} select={select} step={step} zoom={zoom} lens={lens}
        loop={loop} showThumbnails={showThumbnails} maxThumbnails={maxThumbnails} download={download} /> : null }} />;
}
function ImageViewer({ image, images, index, select, step, zoom: zoomOptions, lens: lensOptions, loop, showThumbnails, maxThumbnails, download }: {
  image: BlogImage; images: readonly BlogImage[]; index: number; select: (index: number) => void; step: (delta: number) => void;
  zoom?: false | ImageZoomOptions; lens?: false | ImageLensOptions; loop: boolean; showThumbnails: boolean; maxThumbnails: number; download: boolean;
}) {
  const limits = resolveImageZoom(zoomOptions), lens = lensOptions || {}, hasLens = lensOptions !== false && lens.enabled !== false;
  const [zoom, setZoom] = React.useState(limits.initial), [lensActive, setLens] = React.useState(Boolean(lens.defaultActive)), [point, setPoint] = React.useState<React.CSSProperties | null>(null);
  const [viewport, setViewport] = React.useState<HTMLDivElement | null>(null), imageRef = React.useRef<HTMLImageElement | null>(null), scene = React.useRef<HTMLDivElement | null>(null);
  const pan = React.useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const maximum = Math.floor(bounded(maxThumbnails, 40, 1, 100)), start = Math.max(0, Math.min(index - Math.floor(maximum / 2), images.length - maximum));
  const changeZoom = (next: number) => setZoom(Math.max(limits.min, Math.min(limits.max, next)));
  React.useEffect(() => { setZoom(limits.initial); setLens(Boolean(lens.defaultActive)); setPoint(null); pan.current = null; viewport?.scrollTo(0, 0); }, [image.src]);
  React.useEffect(() => { setZoom(value => limits.enabled ? Math.max(limits.min, Math.min(limits.max, value)) : 1); if (!hasLens) { setLens(false); setPoint(null); } }, [limits.enabled, limits.min, limits.max, hasLens]);
  const locate = (event: React.PointerEvent) => {
    if (!scene.current || !imageRef.current?.naturalWidth) return;
    const tokens = getComputedStyle(scene.current);
    const lensSize = bounded(lens.size ?? parseFloat(tokens.getPropertyValue('--zero-blog-lens-size')), 160, 60, 400);
    const magnification = bounded(lens.magnification ?? parseFloat(tokens.getPropertyValue('--zero-blog-lens-magnification')), 2, 1.1, 6);
    const r = imageRef.current.getBoundingClientRect(), box = scene.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(r.width, event.clientX - r.left)), y = Math.max(0, Math.min(r.height, event.clientY - r.top));
    setPoint({ left: event.clientX - box.left - lensSize / 2, top: event.clientY - box.top - lensSize / 2,
      width: lensSize, height: lensSize, backgroundImage: `url(${JSON.stringify(safeBlogHref(image.src))})`,
      backgroundSize: `${r.width * magnification}px ${r.height * magnification}px`, backgroundPosition: `${lensSize / 2 - x * magnification}px ${lensSize / 2 - y * magnification}px` });
  };
  return <div className="zero-blog-lightbox-content" tabIndex={0} onKeyDown={event => {
    if ((event.target as HTMLElement).closest('input,textarea,select')) return;
    if (event.key === 'ArrowLeft' && images.length > 1) { event.preventDefault(); step(-1); } else if (event.key === 'ArrowRight' && images.length > 1) { event.preventDefault(); step(1); }
    else if (limits.enabled && ['+', '=', '-', '0'].includes(event.key)) { event.preventDefault(); changeZoom(event.key === '0' ? limits.initial : zoom + (event.key === '-' ? -limits.step : limits.step)); }
    else if (hasLens && event.key.toLowerCase() === 'l') { event.preventDefault(); setLens(value => !value); setPoint(null); }
  }}>
    <ScrollArea className="zero-blog-lightbox-viewport" orientation="both" viewportRef={setViewport}>
      <div ref={scene} className="zero-blog-lightbox-scene" data-pan={zoom > 1 && !lensActive || undefined}
        onPointerDown={event => { if (hasLens && lensActive) { locate(event); if (event.pointerType === 'touch') event.currentTarget.setPointerCapture(event.pointerId); }
          else if (zoom > 1 && viewport && event.pointerType !== 'touch' && event.button === 0) { event.preventDefault(); pan.current = { x: event.clientX, y: event.clientY, left: viewport.scrollLeft, top: viewport.scrollTop }; event.currentTarget.setPointerCapture(event.pointerId); } }}
        onPointerMove={event => { if (hasLens && lensActive) locate(event); else if (pan.current && viewport) { viewport.scrollLeft = pan.current.left + pan.current.x - event.clientX; viewport.scrollTop = pan.current.top + pan.current.y - event.clientY; } }}
        onPointerUp={event => { pan.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); if (event.pointerType === 'touch') setPoint(null); }}
        onPointerCancel={() => { pan.current = null; setPoint(null); }} onPointerLeave={() => { if (!pan.current) setPoint(null); }}>
        <img ref={imageRef} src={safeBlogHref(image.src)} alt={image.alt} draggable={false} style={{ transform: `scale(${zoom})` }} />
        {hasLens && lensActive && point && <div className="zero-blog-image-lens" data-shape={lens.shape ?? 'circle'} style={point} aria-hidden="true" />}
      </div>
    </ScrollArea>
    <div className="zero-blog-lightbox-tools">
      {images.length > 1 && <><Button type="button" variant="ghost" size="icon-sm" aria-label="Previous image" disabled={!loop && index === 0} onClick={() => step(-1)}><ChevronLeft /></Button><span role="status">{index + 1} / {images.length}</span><Button type="button" variant="ghost" size="icon-sm" aria-label="Next image" disabled={!loop && index === images.length - 1} onClick={() => step(1)}><ChevronRight /></Button></>}
      {limits.enabled && <><Button type="button" variant="ghost" size="icon-sm" aria-label="Zoom out" disabled={zoom <= limits.min} onClick={() => changeZoom(zoom - limits.step)}><Minus /></Button>
        <output aria-label="Image zoom" aria-live="polite">{Math.round(zoom * 100)}%</output><Button type="button" variant="ghost" size="icon-sm" aria-label="Zoom in" disabled={zoom >= limits.max} onClick={() => changeZoom(zoom + limits.step)}><Plus /></Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => changeZoom(limits.initial)}>Reset</Button></>}
      {hasLens && <Button type="button" variant="ghost" size="sm" aria-label="Magnifying lens" aria-pressed={lensActive} onClick={() => { setLens(value => !value); setPoint(null); }}><ScanSearch />Lens</Button>}
      {download && <a href={safeBlogHref(image.src)} download target="_blank" rel="noopener noreferrer">Download image</a>}
    </div>
    {showThumbnails && images.length > 1 && <ScrollArea orientation="horizontal" className="zero-blog-lightbox-thumbnails"><div>{images.slice(start, start + maximum).map((entry, offset) => { const at = start + offset; return <button type="button" key={`${entry.src}:${at}`} aria-label={`View image ${at + 1}`} aria-pressed={at === index} onClick={() => select(at)}><img src={safeBlogHref(entry.src)} alt="" loading="lazy" /></button>; })}</div></ScrollArea>}
  </div>;
}
