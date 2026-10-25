/** Installs the packed public API without this repository's TypeScript aliases or backend services. */
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test } from 'bun:test';

const SCRATCH = '/Volumes/code-bank/tmp/scratch/zero-platform';
test('packed blog and general command palette expose defaults, CSS and portable SSR/browser imports', async () => {
  await mkdir(SCRATCH, { recursive: true });
  const root = await mkdtemp(join(SCRATCH, 'blog-package-'));
  const consumer = join(root, 'consumer'), archive = process.env.ZERO_BLOG_PACKAGE_ARCHIVE ?? join(root, 'framework.tgz');
  try {
    await mkdir(consumer);
    if (process.env.ZERO_BLOG_PACKAGE_ARCHIVE) {
      if (!await Bun.file(archive).exists()) throw new Error('The supplied blog qualification archive does not exist.');
    } else await checked(['pm', 'pack', '--ignore-scripts', '--filename', archive], process.cwd());
    await Bun.write(join(consumer, 'package.json'), JSON.stringify({
      name: 'zero-blog-public-consumer', private: true, type: 'module',
      dependencies: { '@zero/framework': `file:${archive}`, react: '19.2.4', 'react-dom': '19.2.4' },
    }));
    await Bun.write(join(consumer, 'consumer.tsx'), CONSUMER);
    await Bun.write(join(consumer, 'verify.ts'), VERIFY);
    await checked(['install', '--ignore-scripts', '--backend=hardlink'], consumer, 180_000);
    const result = JSON.parse((await checked(['verify.ts'], consumer)).trim()) as {
      exported: number; browserBytes: number; css: string; html: string; docs: boolean;
    };
    expect(result.exported).toBeGreaterThan(90); expect(result.browserBytes).toBeGreaterThan(0);
    expect(result.css).toContain('--zero-blog-type-prose'); expect(result.css).toContain('--zero-command-palette-width');
    expect(result.css).toContain('[data-variant="editorial"]');
    expect(result.css).toContain('--zero-blog-lens-size'); expect(result.css).toContain('--zero-blog-player-synthwave-from');
    expect(result.html).toContain('data-variant="magazine"'); expect(result.html).toContain('data-variant="with-sidebar"');
    expect(result.html).toContain('href="/journal/welcome"'); expect(result.html).toContain('Readable without JavaScript.');
    expect(result.html).toContain('href="#introduction-1"'); expect(result.html).not.toContain('Share this article');
    expect(result.html).toContain('data-overlay="true"'); expect(result.html).toContain('controls=""');
    expect(result.html).toContain('aria-valuenow="45"');
    expect(result.docs).toBe(true);
  } finally {
    // Only the disposable consumer and archive allocated by this test are removed.
    await rm(root, { recursive: true, force: true });
  }
}, 300_000);

async function checked(arguments_: string[], cwd: string, timeoutMs = 90_000): Promise<string> {
  const child = Bun.spawn([process.execPath, '--no-env-file', ...arguments_], {
    cwd, stdout: 'pipe', stderr: 'pipe',
    env: { PATH: process.env.PATH, TMPDIR: SCRATCH, BUN_INSTALL_CACHE_DIR: '/Volumes/code-bank/caches/bun/install-cache' },
  });
  let expired = false;
  const timeout = setTimeout(() => { expired = true; child.kill(); }, timeoutMs);
  try {
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ]);
    if (expired || code !== 0) throw new Error(`Blog package consumer failed (${expired ? 'timeout' : code}):\n${stdout}\n${stderr}`);
    return stdout;
  } finally { clearTimeout(timeout); }
}

const CONSUMER = `
import * as React from 'react';
import * as Root from '@zero/framework';
import * as Blog from '@zero/framework/blog';
import * as Alias from '@zero/framework/components/blog';
import * as Commands from '@zero/framework/components/command-palette';
import * as Popovers from '@zero/framework/components/popover';
import type { BlogPost, AudioPlayerPlayButtonProps, LightboxProviderProps, BlogProviderProps } from '@zero/framework/blog';
const exported = ['BlogProvider', 'BlogListPage', 'BlogPostPage', 'BlogHero',
  'BlogCard', 'BlogCardGrid', 'BlogSearchPalette', 'BlogPagination', 'BlogImageLightbox'] as const;
for (const name of exported) {
  if (typeof Blog[name] !== 'function' || Blog[name] !== Root[name] || Blog[name] !== Alias[name]) throw new Error('Missing Blog export: ' + name);
}
for (const name of ['CommandPalette', 'CommandPaletteTrigger', 'filterCommandPaletteItems', 'CommandPaletteProvider', 'useCommandPalette'] as const) {
  if (typeof Commands[name] !== 'function' || Commands[name] !== Root[name]) throw new Error('Missing command export: ' + name);
}
if (typeof Popovers.PopoverAnchor !== 'function' || Popovers.PopoverAnchor !== Root.PopoverAnchor) throw new Error('Missing anchored input facade');
const focusedParts = ["Typography","Prose","BlogCard","BlogCardGrid","SearchBar","SearchWithResults","SearchBarWithDropdown","BlogPagination","CategoryFilter","CategoryBadges","CategoryTooltip","BlogHero","BlogHeroCompact","BlogHeroContained","SocialShare","TableOfContents","TableOfContentsSidebar","TableOfContentsFloating","AuthorCard","AuthorCardInline","AuthorCardFeatured","AuthorAvatar","AuthorAvatarGroup","AuthorTooltip","RelatedPosts","RecentPostsHero","EmptyBlogHero","EmptySearchResults","EmptyCategoryResults","EmptyState","BlogListPage","BlogListPageMinimal","BlogListPageSidebar","BlogListPageList","BlogPostPage","BlogPostPageWide","BlogPostPageWithSidebar","BlogPostPageSplit","ContentImage","ContentImageFull","ContentImageFloatLeft","ContentImageFloatRight","ImageGallery","ImageCarousel","ImageStack","CodeBlock","CodeBlockFiles","CodeBlockInline","VideoPlayer","VideoPlayerContent","VideoPlayerControlBar","VideoPlayerPlayButton","VideoPlayerSeekBackwardButton","VideoPlayerSeekForwardButton","VideoPlayerTimeRange","VideoPlayerTimeDisplay","VideoPlayerMuteButton","VideoPlayerVolumeRange","VideoPlayerFullscreenButton","VideoPlayerDefault","InlineLink","InlineLinkPreview","DemoLink","CitationProvider","CitationRef","CitationsList","Glimpse","LightboxProvider","LightboxContext","useLightbox","AudioPlayer","AudioPlayerPlayButton","AudioPlayerSkipBackwardButton","AudioPlayerSkipForwardButton","AudioPlayerMuteButton","AudioPlayerLoopButton","AudioPlayerVolumeSlider","AudioPlayerTimeDisplay","AudioPlayerWaveform","AudioPlayerProgress","AudioPlayerMinimal","AudioPlayerSynthwave","CommandPaletteProvider","CommandPaletteTrigger","useCommandPalette","NewsletterSignup","NewsletterSignupCompact","BlogProvider","SpotlightBorder","BlogSearchPalette","BlogImageLightbox","LightboxImageTrigger","LightboxGalleryTrigger","NewsletterModal","NewsletterTrigger","ReadingProgressBar","ReadingProgressCircle","BlockRenderer"] as const;
for (const name of focusedParts) if (!Blog[name] || Blog[name] !== Alias[name]) throw new Error('Missing focused part: ' + name);
export const exportedCount = focusedParts.length + 6;
const post: BlogPost = { id: 'welcome', slug: 'welcome', title: 'Welcome', featuredImage: '/cover.svg', blocks: [
  { type: 'heading', text: 'Introduction', level: 2 }, { type: 'paragraph', text: 'Readable without JavaScript.' },
] };
export function Consumer() {
  return <Blog.BlogProvider baseUrl="/journal"><Blog.BlogListPage posts={[post]} />
    <Blog.BlogPostPage post={post} /><Blog.BlogPagination currentPage={1} totalPages={4} />
    <Blog.AudioPlayerSynthwave src="/tone.wav" /><Blog.VideoPlayer src="/video.webm" />
    <Blog.ReadingProgressCircle value={45} /><Blog.SearchWithResults posts={[post]} />
    <Commands.CommandPaletteProvider title="Commands" items={[]}><Commands.CommandPaletteTrigger>Commands</Commands.CommandPaletteTrigger></Commands.CommandPaletteProvider>
  </Blog.BlogProvider>;
}
`;
const VERIFY = `
import * as React from 'react';
import { renderToString } from 'react-dom/server';
import { Consumer, exportedCount } from './consumer';
const build = await Bun.build({ entrypoints: ['./consumer.tsx'], target: 'browser', format: 'esm' });
if (!build.success) throw new Error(build.logs.map(log => log.message).join('\\n'));
const css = (await Promise.all(build.outputs.filter(item => item.path.endsWith('.css')).map(item => item.text()))).join('\\n');
const docsRoot = './node_modules/@zero/framework/docs-next/';
const docs = await Bun.file(docsRoot + 'frontend/components/public-pages/blog/index.md').exists()
  && await Bun.file(docsRoot + 'frontend/components/controls/command-palette.md').exists()
  && await Bun.file(docsRoot + 'frontend/components/public-pages/blog/media.md').exists()
  && await Bun.file(docsRoot + 'frontend/components/public-pages/blog/migration.md').exists()
  && await Bun.file(docsRoot + 'frontend/components/public-pages/blog/images-and-previews.md').exists();
console.log(JSON.stringify({ exported: exportedCount, browserBytes: build.outputs.reduce((sum, item) => sum + item.size, 0), css, docs, html: renderToString(React.createElement(Consumer)) }));
`;
