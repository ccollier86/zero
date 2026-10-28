'use client';

/** Images and instance-local galleries. The shared manager owns focus, stacking, scroll lock and origin motion. */
import * as React from 'react';
import { ChevronLeft } from '../animate-ui/icons/chevron-left';
import { ChevronRight } from '../animate-ui/icons/chevron-right';
import { Button, type ButtonProps } from '../ui/button';
import { cn } from '../../lib/utils';
import { safeBlogHref } from './blog-utils';
import type { BlogImage } from './blog.types';
import { BlogImageLightbox, type BlogImageLightboxProps } from './blog-lightbox';

export type BlogLightboxOptions = Omit<BlogImageLightboxProps, 'open' | 'image' | 'images' | 'activeIndex' | 'trigger' | 'onOpenChange' | 'onIndexChange'>;
interface ImageOpening { images: readonly BlogImage[]; index: number; trigger?: HTMLElement | null; options?: BlogLightboxOptions }
export interface LightboxController {
  open: boolean; image?: BlogImage; activeIndex: number;
  openImage: (image: BlogImage, trigger?: HTMLElement | null, options?: BlogLightboxOptions) => void;
  openGallery: (images: readonly BlogImage[], index?: number, trigger?: HTMLElement | null, options?: BlogLightboxOptions) => void;
  close: () => void;
}
export const LightboxContext = React.createContext<LightboxController | null>(null);
export function useLightbox() { const value = React.useContext(LightboxContext); if (!value) throw new Error('useLightbox requires a LightboxProvider.'); return value; }
export function LightboxProvider({ children, images: registered = [], options, onImageChange }: { children: React.ReactNode; images?: readonly BlogImage[]; options?: BlogLightboxOptions; onImageChange?: (image: BlogImage, index: number) => void }) {
  const [opening, setOpening] = React.useState<ImageOpening | null>(null);
  const openGallery: LightboxController['openGallery'] = (images, index = 0, trigger, override) => {
    const requested = images[Math.max(0, Math.min(images.length - 1, Number.isFinite(index) ? Math.floor(index) : 0))];
    if (!requested || !safeBlogHref(requested.src)) return;
    const admitted = images.filter(entry => safeBlogHref(entry.src)), at = Math.max(0, admitted.indexOf(requested));
    setOpening({ images: admitted, index: at, trigger, options: override }); onImageChange?.(requested, at);
  };
  const openImage: LightboxController['openImage'] = (image, trigger, override) => { const index = registered.findIndex(entry => entry === image || entry.src === image.src && entry.alt === image.alt); openGallery(index >= 0 ? registered : [image], Math.max(0, index), trigger, override); };
  return <LightboxContext.Provider value={{ open: !!opening, image: opening?.images[opening.index], activeIndex: opening?.index ?? 0, openImage, openGallery, close: () => setOpening(null) }}>
    {children}<BlogImageLightbox {...options} {...opening?.options} open={!!opening} images={opening?.images} activeIndex={opening?.index} trigger={opening?.trigger}
      onIndexChange={index => { setOpening(previous => previous ? { ...previous, index } : previous); if (opening?.images[index]) onImageChange?.(opening.images[index]!, index); }} onOpenChange={open => { if (!open) setOpening(null); }} />
  </LightboxContext.Provider>;
}
export interface ContentImageProps extends BlogImage { variant?: 'full' | 'float-left' | 'float-right'; expandable?: boolean; className?: string; loading?: 'lazy' | 'eager'; aspectRatio?: 'auto' | 'square' | 'video' | '4/3' | '3/2'; lightbox?: BlogLightboxOptions }
export function ContentImage({ variant = 'full', expandable = true, className, loading = 'lazy', aspectRatio = 'auto', lightbox, ...image }: ContentImageProps) {
  const inherited = React.useContext(LightboxContext), [opening, setOpening] = React.useState<{ image: BlogImage; trigger: HTMLElement } | null>(null);
  const src = safeBlogHref(image.src); if (!src) return null;
  const picture = <img src={src} alt={image.alt} width={image.width} height={image.height} loading={loading} decoding="async" />;
  return <figure className={cn('zero-blog-image', className)} data-variant={variant} data-aspect={aspectRatio}>
    {expandable ? <button type="button" className="zero-blog-image-trigger" aria-label={`Expand ${image.alt || 'image'}`} onClick={event => inherited ? inherited.openImage(image, event.currentTarget, lightbox) : setOpening({ image, trigger: event.currentTarget })}>{picture}</button> : picture}
    {image.caption && <figcaption>{image.caption}</figcaption>}
    {!inherited && <BlogImageLightbox {...lightbox} open={!!opening} image={opening?.image} trigger={opening?.trigger} onOpenChange={next => { if (!next) setOpening(null); }} />}
  </figure>;
}
export function ContentImageFull(props: ContentImageProps) { return <ContentImage {...props} variant="full" />; }
export function ContentImageFloatLeft(props: ContentImageProps) { return <ContentImage {...props} variant="float-left" />; }
export function ContentImageFloatRight(props: ContentImageProps) { return <ContentImage {...props} variant="float-right" />; }
export interface ImageGalleryProps { images: readonly BlogImage[]; columns?: 2 | 3 | 4; layout?: 'grid' | 'stack'; className?: string; lightbox?: BlogLightboxOptions }
export function ImageGallery({ images, columns = 2, layout = 'grid', className, lightbox }: ImageGalleryProps) {
  if (!images.length) return null;
  return <LightboxProvider images={images} options={lightbox}><div className={cn('zero-blog-gallery', className)} data-columns={columns} data-layout={layout}>{images.map((image, index) => <ContentImage key={`${image.src}:${index}`} {...image} />)}</div></LightboxProvider>;
}
export function ImageStack(props: Omit<React.ComponentProps<typeof ImageGallery>, 'layout'>) { return <ImageGallery {...props} layout="stack" />; }
export function ImageCarousel({ images, label = 'Article images', className, lightbox }: { images: readonly BlogImage[]; label?: string; className?: string; lightbox?: BlogLightboxOptions }) {
  const [index, setIndex] = React.useState(0), current = Math.min(index, images.length - 1);
  if (!images.length) return null;
  const step = (delta: number) => setIndex(value => (Math.min(value, images.length - 1) + delta + images.length) % images.length);
  return <LightboxProvider images={images} options={lightbox}><section aria-label={label} aria-roledescription="carousel" className={cn('zero-blog-carousel', className)}>
    <ContentImage {...images[current]!} /><div className="zero-blog-carousel-tools">
      <Button type="button" variant="outline" size="icon-sm" aria-label="Previous image" disabled={images.length < 2} onClick={() => step(-1)}><ChevronLeft /></Button>
      <output aria-live="polite">{current + 1} / {images.length}</output><Button type="button" variant="outline" size="icon-sm" aria-label="Next image" disabled={images.length < 2} onClick={() => step(1)}><ChevronRight /></Button>
    </div>
  </section></LightboxProvider>;
}
export function ExpandableImage(props: ContentImageProps) { return <ContentImage aspectRatio="video" {...props} />; }
export function LightboxGalleryTrigger({ images, initialIndex = 0, lightbox, onClick, children, ...props }: ButtonProps & { images: readonly BlogImage[]; initialIndex?: number; lightbox?: BlogLightboxOptions }) {
  const inherited = React.useContext(LightboxContext), [opening, setOpening] = React.useState<HTMLElement | null>(null), [index, setIndex] = React.useState(initialIndex);
  return <><Button type="button" variant="outline" {...props} onClick={event => { onClick?.(event); if (!event.defaultPrevented) { if (inherited) inherited.openGallery(images, initialIndex, event.currentTarget, lightbox); else { setIndex(initialIndex); setOpening(event.currentTarget); } } }}>{children ?? 'View images'}</Button>
    {!inherited && <BlogImageLightbox {...lightbox} open={!!opening} images={images} activeIndex={index} onIndexChange={setIndex} trigger={opening} onOpenChange={open => { if (!open) setOpening(null); }} />}</>;
}
export function LightboxImageTrigger({ image, ...props }: Omit<React.ComponentProps<typeof LightboxGalleryTrigger>, 'images' | 'initialIndex'> & { image: BlogImage }) { return <LightboxGalleryTrigger {...props} images={[image]} />; }
export { BlogImageLightbox } from './blog-lightbox';
export type { BlogImageLightboxProps, ImageLensOptions, ImageZoomOptions } from './blog-lightbox';
