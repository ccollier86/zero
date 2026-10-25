'use client';

/** Images and instance-local galleries. The shared manager owns focus, stacking, scroll lock and origin motion. */
import * as React from 'react';
import { ChevronLeft, ChevronRight, Minus, Plus } from 'lucide-react';
import { Button } from '../ui/button';
import { ScrollArea } from '../ui/scroll-area';
import { ControlledModal } from '../../modals/modal-controlled';
import { cn } from '../../lib/utils';
import { safeBlogHref } from './blog-utils';
import type { BlogImage } from './blog.types';

interface ImageOpening { image: BlogImage; trigger: HTMLElement }
const ImageContext = React.createContext<((opening: ImageOpening) => void) | null>(null);
export function LightboxProvider({ children }: { children: React.ReactNode }) {
  const [opening, setOpening] = React.useState<ImageOpening | null>(null);
  return <ImageContext.Provider value={setOpening}>{children}<BlogImageLightbox open={!!opening} image={opening?.image} trigger={opening?.trigger} onOpenChange={open => { if (!open) setOpening(null); }} /></ImageContext.Provider>;
}
export interface BlogImageLightboxProps { open: boolean; image?: BlogImage; trigger?: HTMLElement | null; onOpenChange: (open: boolean) => void }
export function BlogImageLightbox({ open, image, trigger, onOpenChange }: BlogImageLightboxProps) {
  return <ControlledModal open={open && !!image && !!safeBlogHref(image.src)} onOpenChange={onOpenChange} identityKey={image?.src}
    descriptor={{ title: image?.caption ?? image?.alt ?? 'Image preview', trigger, size: 'xl', className: 'zero-blog-overlay zero-public zero-blog-lightbox',
      body: image ? <LightboxImage key={image.src} image={image} /> : null }} />;
}
function LightboxImage({ image }: { image: BlogImage }) {
  const [zoom, setZoom] = React.useState(1);
  return <div className="zero-blog-lightbox-content"><ScrollArea className="zero-blog-lightbox-viewport" orientation="both"><img src={safeBlogHref(image.src)} alt={image.alt} style={{ transform: `scale(${zoom})` }} /></ScrollArea>
    <div className="zero-blog-lightbox-tools"><Button type="button" variant="ghost" size="icon-sm" aria-label="Zoom out" disabled={zoom <= 1} onClick={() => setZoom(value => Math.max(1, value - .5))}><Minus /></Button>
      <output aria-live="polite">{Math.round(zoom * 100)}%</output><Button type="button" variant="ghost" size="icon-sm" aria-label="Zoom in" disabled={zoom >= 3} onClick={() => setZoom(value => Math.min(3, value + .5))}><Plus /></Button>
      <Button type="button" variant="ghost" size="sm" onClick={() => setZoom(1)}>Reset</Button></div>
  </div>;
}
export interface ContentImageProps extends BlogImage { variant?: 'full' | 'float-left' | 'float-right'; expandable?: boolean; className?: string; loading?: 'lazy' | 'eager' }
export function ContentImage({ variant = 'full', expandable = true, className, loading = 'lazy', ...image }: ContentImageProps) {
  const inherited = React.useContext(ImageContext), [opening, setOpening] = React.useState<ImageOpening | null>(null);
  const src = safeBlogHref(image.src); if (!src) return null;
  const picture = <img src={src} alt={image.alt} width={image.width} height={image.height} loading={loading} decoding="async" />;
  return <figure className={cn('zero-blog-image', className)} data-variant={variant}>
    {expandable ? <button type="button" className="zero-blog-image-trigger" aria-label={`Expand ${image.alt || 'image'}`} onClick={event => (inherited ?? setOpening)({ image, trigger: event.currentTarget })}>{picture}</button> : picture}
    {image.caption && <figcaption>{image.caption}</figcaption>}
    {!inherited && <BlogImageLightbox open={!!opening} image={opening?.image} trigger={opening?.trigger} onOpenChange={next => { if (!next) setOpening(null); }} />}
  </figure>;
}
export function ContentImageFull(props: ContentImageProps) { return <ContentImage {...props} variant="full" />; }
export function ContentImageFloatLeft(props: ContentImageProps) { return <ContentImage {...props} variant="float-left" />; }
export function ContentImageFloatRight(props: ContentImageProps) { return <ContentImage {...props} variant="float-right" />; }
export function ImageGallery({ images, columns = 2, layout = 'grid', className }: { images: readonly BlogImage[]; columns?: 2 | 3 | 4; layout?: 'grid' | 'stack'; className?: string }) {
  if (!images.length) return null;
  return <LightboxProvider><div className={cn('zero-blog-gallery', className)} data-columns={columns} data-layout={layout}>{images.map((image, index) => <ContentImage key={`${image.src}:${index}`} {...image} />)}</div></LightboxProvider>;
}
export function ImageStack(props: Omit<React.ComponentProps<typeof ImageGallery>, 'layout'>) { return <ImageGallery {...props} layout="stack" />; }
export function ImageCarousel({ images, label = 'Article images', className }: { images: readonly BlogImage[]; label?: string; className?: string }) {
  const [index, setIndex] = React.useState(0), current = Math.min(index, images.length - 1);
  if (!images.length) return null;
  const step = (delta: number) => setIndex(value => (Math.min(value, images.length - 1) + delta + images.length) % images.length);
  return <section aria-label={label} aria-roledescription="carousel" className={cn('zero-blog-carousel', className)}>
    <ContentImage {...images[current]!} /><div className="zero-blog-carousel-tools">
      <Button type="button" variant="outline" size="icon-sm" aria-label="Previous image" disabled={images.length < 2} onClick={() => step(-1)}><ChevronLeft /></Button>
      <output aria-live="polite">{current + 1} / {images.length}</output><Button type="button" variant="outline" size="icon-sm" aria-label="Next image" disabled={images.length < 2} onClick={() => step(1)}><ChevronRight /></Button>
    </div>
  </section>;
}
export { ContentImage as ExpandableImage };
