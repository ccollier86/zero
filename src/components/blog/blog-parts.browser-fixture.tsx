import * as React from 'react';
import { SearchWithResults, AuthorTooltip, CategoryTooltip, ImageGallery, AudioPlayerSynthwave, AudioPlayerMinimal,
  AudioPlayerPlayButton, AudioPlayerProgress, AudioPlayerTimeDisplay, VideoPlayer, VideoPlayerContent, VideoPlayerControlBar, VideoPlayerPlayButton, VideoPlayerTimeRange, VideoPlayerFullscreenButton,
  ReadingProgressProvider, ReadingProgressBar, ReadingProgressCircle, SpotlightBorder, NewsletterTrigger, type BlogPost, type BlogCategory, type BlogAuthor } from './index';
import { CommandPaletteProvider, CommandPaletteTrigger, useCommandPalette, type CommandPaletteItem } from '../command-palette';
import { ScrollArea } from '../ui/scroll-area';

function ScopedResult({ item }: { item: CommandPaletteItem }) { const controller = useCommandPalette(); return <span data-testid="provider-context">{item.label} · {controller.query}</span>; }
export function BlogPartsExamples({ posts, categories, author, fail, onSelect }: { posts: readonly BlogPost[]; categories: readonly BlogCategory[]; author: BlogAuthor; fail: boolean; onSelect: (value: string) => void }) {
  const [target, setTarget] = React.useState<HTMLDivElement | null>(null), [container, setContainer] = React.useState<HTMLDivElement | null>(null), [source, setSource] = React.useState('/tone.wav');
  return <section className="zero-blog-parts-fixture" style={{ display: 'grid', gap: 28, padding: 24, maxWidth: 1000, margin: 'auto', '--zero-blog-lens-size': '132px' } as React.CSSProperties}>
    <h2>Blog parts</h2><SearchWithResults label="Inline articles" posts={posts} onSelect={async post => { await new Promise(resolve => setTimeout(resolve, 20)); if (fail) throw new Error('PRIVATE_INLINE_FAILURE'); onSelect(post.id); }} />
    <div style={{ display: 'flex', gap: 16 }}><AuthorTooltip author={{ ...author, socialLinks: [{ id: 'site', label: 'Website', href: 'https://example.test/author' }] }} postCount={18} onViewPosts={() => onSelect('author-posts')}><button type="button">Author details</button></AuthorTooltip>
      <CategoryTooltip categories={categories} onCategoryClick={category => onSelect(category.id)}><button type="button">Category details</button></CategoryTooltip></div>
    <ImageGallery images={[{ src: '/cover.svg', alt: 'Gallery one', caption: 'First image' }, { src: '/detail.svg', alt: 'Gallery two', caption: 'Second image' }]} lightbox={{ zoom: { max: 2 }, lens: { shape: 'square' } }} />
    <AudioPlayerSynthwave title="Measured audio" src={source} preload="metadata" peaks={[.1,.3,.5,.9,.6,.2,.4,.8,.3,.5]} skipSeconds={1} />
    <button type="button" onClick={() => setSource(value => value === '/tone.wav' ? '/missing.wav' : '/tone.wav')}>Change media source</button>
    <AudioPlayerMinimal title="Custom audio" src="/tone.wav" preload="metadata"><VideoPlayerControlBar><AudioPlayerPlayButton /><AudioPlayerProgress /><AudioPlayerTimeDisplay /></VideoPlayerControlBar></AudioPlayerMinimal>
    <VideoPlayer title="Custom video" src="/video.webm" preload="metadata" controlsLayout="overlay" controlsAutoHideMs={500}><VideoPlayerContent><VideoPlayerControlBar><VideoPlayerPlayButton /><VideoPlayerTimeRange /><VideoPlayerFullscreenButton /></VideoPlayerControlBar></VideoPlayerContent></VideoPlayer>
    <ReadingProgressProvider target={target} container={container}><ReadingProgressBar position="inline" showPercentage /><ReadingProgressCircle />
      <ScrollArea style={{ height: 180 }} viewportRef={setContainer}><div ref={setTarget} style={{ height: 1200 }}>Article-relative progress content</div></ScrollArea>
    </ReadingProgressProvider>
    <SpotlightBorder><button type="button" onClick={() => onSelect('spotlight')}>Spotlight action</button></SpotlightBorder>
    <NewsletterTrigger newsletter={{ title: 'Join the journal', onSubscribe: async () => { await new Promise(resolve => setTimeout(resolve, 100)); if (fail) throw new Error('PRIVATE_SUBSCRIBE_FAILURE'); onSelect('subscribed'); } }}>Open newsletter</NewsletterTrigger>
    <NewsletterTrigger newsletter={{}}>Missing newsletter integration</NewsletterTrigger>
    <CommandPaletteProvider title="Scoped commands" items={[{ id: 'help', label: 'Help centre' }]} renderItem={item => <ScopedResult item={item} />} onSelect={item => onSelect(item.id)}>
      <CommandPaletteTrigger>Open scoped commands</CommandPaletteTrigger>
    </CommandPaletteProvider>
  </section>;
}
