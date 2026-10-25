import { expect, test } from 'bun:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as Blog from './index';
import { resolveImageZoom } from './blog-lightbox';

// Frozen original runtime inventory: portable tests do not depend on the recovered archive.
const recoveredExports = {
  "Typography": "Typography",
  "Prose": "Prose",
  "typographyVariants": "Typography",
  "BlogCard": "BlogCard",
  "BlogCardGrid": "BlogCardGrid",
  "SearchBar": "SearchBar",
  "SearchWithResults": "SearchWithResults",
  "SearchBarWithDropdown": "SearchBarWithDropdown",
  "Pagination": "BlogPagination",
  "CategoryFilter": "CategoryFilter",
  "CategoryBadges": "CategoryBadges",
  "CategoryTooltip": "CategoryTooltip",
  "BlogHero": "BlogHero",
  "BlogHeroCompact": "BlogHeroCompact",
  "BlogHeroContained": "BlogHeroContained",
  "SocialShare": "SocialShare",
  "TableOfContents": "TableOfContents",
  "TableOfContentsSidebar": "TableOfContentsSidebar",
  "TableOfContentsFloating": "TableOfContentsFloating",
  "AuthorCard": "AuthorCard",
  "AuthorCardInline": "AuthorCardInline",
  "AuthorCardFeatured": "AuthorCardFeatured",
  "AuthorAvatar": "AuthorAvatar",
  "AuthorAvatarGroup": "AuthorAvatarGroup",
  "AuthorTooltip": "AuthorTooltip",
  "RelatedPosts": "RelatedPosts",
  "RecentPostsHero": "RecentPostsHero",
  "EmptyBlogHero": "EmptyBlogHero",
  "EmptySearchResults": "EmptySearchResults",
  "EmptyCategoryResults": "EmptyCategoryResults",
  "EmptyState": "EmptyState",
  "BlogListPage": "BlogListPage",
  "BlogListPageMinimal": "BlogListPageMinimal",
  "BlogListPageSidebar": "BlogListPageSidebar",
  "BlogListPageList": "BlogListPageList",
  "BlogPostPage": "BlogPostPage",
  "BlogPostPageWide": "BlogPostPageWide",
  "BlogPostPageWithSidebar": "BlogPostPageWithSidebar",
  "BlogPostPageSplit": "BlogPostPageSplit",
  "ContentImage": "ContentImage",
  "ContentImageFull": "ContentImageFull",
  "ContentImageFloatLeft": "ContentImageFloatLeft",
  "ContentImageFloatRight": "ContentImageFloatRight",
  "ImageGallery": "ImageGallery",
  "ImageCarousel": "ImageCarousel",
  "ImageStack": "ImageStack",
  "CodeBlock": "CodeBlock",
  "CodeBlockGroup": "CodeBlockFiles",
  "InlineCode": "CodeBlockInline",
  "CODE_THEMES": "CodeBlock",
  "THEME_PAIRS": "CodeBlock",
  "getThemesByMode": "CodeBlock",
  "getThemesByCategory": "CodeBlock",
  "VideoPlayer": "VideoPlayer",
  "VideoPlayerContent": "VideoPlayerContent",
  "VideoPlayerControlBar": "VideoPlayerControlBar",
  "VideoPlayerPlayButton": "VideoPlayerPlayButton",
  "VideoPlayerSeekBackwardButton": "VideoPlayerSeekBackwardButton",
  "VideoPlayerSeekForwardButton": "VideoPlayerSeekForwardButton",
  "VideoPlayerTimeRange": "VideoPlayerTimeRange",
  "VideoPlayerTimeDisplay": "VideoPlayerTimeDisplay",
  "VideoPlayerMuteButton": "VideoPlayerMuteButton",
  "VideoPlayerVolumeRange": "VideoPlayerVolumeRange",
  "VideoPlayerFullscreenButton": "VideoPlayerFullscreenButton",
  "VideoPlayerDefault": "VideoPlayerDefault",
  "InlineLink": "InlineLink",
  "InlineLinkPreview": "InlineLinkPreview",
  "DemoLink": "DemoLink",
  "CitationProvider": "CitationProvider",
  "CitationRef": "CitationRef",
  "CitationsList": "CitationsList",
  "Glimpse": "Glimpse",
  "LightboxProvider": "LightboxProvider",
  "LightboxContext": "LightboxContext",
  "useLightbox": "useLightbox",
  "AudioPlayer": "AudioPlayer",
  "AudioPlayerPlayButton": "AudioPlayerPlayButton",
  "AudioPlayerSkipBackwardButton": "AudioPlayerSkipBackwardButton",
  "AudioPlayerSkipForwardButton": "AudioPlayerSkipForwardButton",
  "AudioPlayerMuteButton": "AudioPlayerMuteButton",
  "AudioPlayerLoopButton": "AudioPlayerLoopButton",
  "AudioPlayerVolumeSlider": "AudioPlayerVolumeSlider",
  "AudioPlayerTimeDisplay": "AudioPlayerTimeDisplay",
  "AudioPlayerWaveform": "AudioPlayerWaveform",
  "AudioPlayerProgress": "AudioPlayerProgress",
  "AudioPlayerMinimal": "AudioPlayerMinimal",
  "AudioPlayerSynthwave": "AudioPlayerSynthwave",
  "CommandPaletteProvider": "CommandPaletteProvider",
  "CommandPaletteTrigger": "CommandPaletteTrigger",
  "useCommandPalette": "useCommandPalette",
  "NewsletterSignup": "NewsletterSignup",
  "NewsletterSignupCompact": "NewsletterSignupCompact",
  "BlogProvider": "BlogProvider",
  "useBlogData": null,
  "SpotlightBorder": "SpotlightBorder",
  "CommandPaletteConnected": "BlogSearchPalette",
  "CommandPaletteTriggerConnected": "CommandPaletteTrigger",
  "LightboxConnected": "BlogImageLightbox",
  "LightboxImageTrigger": "LightboxImageTrigger",
  "LightboxGalleryTrigger": "LightboxGalleryTrigger",
  "NewsletterModalConnected": "NewsletterModal",
  "NewsletterTrigger": "NewsletterTrigger",
  "ReadingProgressBar": "ReadingProgressBar",
  "ReadingProgressCircle": "ReadingProgressCircle",
  "ToastContainer": null,
  "BlockRenderer": "BlockRenderer",
  "AnimatedThemeToggle": null,
  "FloatingThemeToggle": null,
  "THEME_TOGGLE_CSS": null
} as const;
test('every recovered runtime export has a documented Zero destination or deliberate exclusion', async () => {
  const guide = await Bun.file(new URL('../../../docs-next/frontend/components/public-pages/blog/migration.md', import.meta.url)).text();
  for (const [original, destination] of Object.entries(recoveredExports)) {
    expect(guide).toContain(original);
    if (destination) expect((Blog as Record<string, unknown>)[destination]).toBeDefined();
  }
});


const parts = ['SearchWithResults','SearchBarWithDropdown','AuthorTooltip','CategoryTooltip','TableOfContentsFloating',
  'ReadingProgressProvider','ReadingProgressBar','ReadingProgressCircle','SpotlightBorder','EmptyBlogHero','EmptyCategoryResults',
  'AudioPlayerPlayButton','AudioPlayerSkipBackwardButton','AudioPlayerSkipForwardButton','AudioPlayerMuteButton','AudioPlayerLoopButton',
  'AudioPlayerVolumeSlider','AudioPlayerTimeDisplay','AudioPlayerWaveform','AudioPlayerProgress','AudioPlayerMinimal','AudioPlayerSynthwave',
  'VideoPlayerContent','VideoPlayerControlBar','VideoPlayerPlayButton','VideoPlayerSeekBackwardButton','VideoPlayerSeekForwardButton',
  'VideoPlayerTimeRange','VideoPlayerTimeDisplay','VideoPlayerMuteButton','VideoPlayerVolumeRange','VideoPlayerFullscreenButton','VideoPlayerDefault',
  'LightboxProvider','useLightbox','LightboxImageTrigger','LightboxGalleryTrigger','NewsletterModal','NewsletterTrigger',
  'CommandPaletteProvider','CommandPaletteTrigger','useCommandPalette'] as const;
test('remaining presentation families have real public implementations, not placeholders', () => {
  for (const name of parts) expect(typeof Blog[name]).toBe('function');
  expect(Blog.SearchBarWithDropdown).toBe(Blog.SearchWithResults);
  expect(Blog.VideoPlayerDefault).toBe(Blog.VideoPlayer);
});
test('article-relative reading values are bounded and short content invents no progress', () => {
  expect(Blog.calculateReadingProgress(50, 100)).toEqual({ progress: 50, scrollable: true });
  expect(Blog.calculateReadingProgress(-1, 100).progress).toBe(0); expect(Blog.calculateReadingProgress(500, 100).progress).toBe(100);
  expect(Blog.calculateReadingProgress(0, 0)).toEqual({ progress: 0, scrollable: false });
  expect(Blog.calculateReadingProgress(Infinity, 100).scrollable).toBe(false);
  const html = renderToStaticMarkup(<Blog.ReadingProgressCircle value={120} />);
  expect(html).toContain('aria-valuenow="100"'); expect(html).toContain('stroke-dasharray="100 100"');
});
test('weighted local search handles independent terms, explicit match modes, limits and stable order', () => {
  const posts = [{ id: 'a', slug: 'a', title: 'Design systems', excerpt: 'Useful tools' }, { id: 'b', slug: 'b', title: 'Tools', excerpt: 'Design systems' }];
  expect(Blog.searchBlogPosts(posts, 'design systems')[0]?.id).toBe('a');
  expect(Blog.searchBlogPosts(posts, 'design absent')).toHaveLength(0); expect(Blog.searchBlogPosts(posts, 'design absent', 1, 'any')).toHaveLength(1);
  expect(Blog.searchBlogPosts(posts, '')).toEqual([]); expect(posts[0]!.id).toBe('a');
});
test('zoom options preserve useful defaults and reject nonfinite or unbounded geometry', () => {
  expect(resolveImageZoom()).toEqual({ enabled: true, min: 1, max: 3, step: .5, initial: 1 });
  expect(resolveImageZoom(false).enabled).toBe(false);
  expect(resolveImageZoom({ max: Infinity, defaultZoom: 99 }).initial).toBe(3);
  expect(resolveImageZoom({ max: -1, min: .5, step: 100 })).toMatchObject({ min: .5, max: .5, step: 2, initial: .5 });
});
test('media formatting is finite and SSR retains native controls without a client controller', () => {
  expect(Blog.formatMediaTime(3661)).toBe('1:01:01'); expect(Blog.formatMediaTime(NaN)).toBe('0:00');
  const html = renderToStaticMarkup(<Blog.BlogProvider><Blog.AudioPlayerSynthwave src="/tone.wav" /><Blog.VideoPlayer src="/video.webm" /><Blog.SearchWithResults posts={[]} /></Blog.BlogProvider>);
  expect(html).toContain('data-variant="synthwave"'); expect(html).toContain('<audio'); expect(html).toContain('<video'); expect(html).toContain('controls=""');
  expect(html).not.toContain('autoplay=""'); expect(renderToStaticMarkup(<Blog.AudioPlayer src="javascript:bad()" />)).toBe('');
  expect(renderToStaticMarkup(<Blog.NewsletterTrigger newsletter={{}}>Unavailable</Blog.NewsletterTrigger>)).toBe('');
});
