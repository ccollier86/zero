/** Real compiled Zero controls, shared modal ownership and token/viewport contracts; no backend or external requests. */
import { beforeAll, afterAll, expect, test } from 'bun:test';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import type { Page } from 'playwright';
import { buildPlatformStyles } from '../../frontend/server/style-bundle';
import { acquirePlaywrightTestBrowser, playwrightTestBrowserAvailable, type PlaywrightTestBrowserLease } from '../../test-support/playwright-test-browser';

const browserTest = playwrightTestBrowserAvailable ? test : test.skip;
const evidence = '/Volumes/code-bank/artifacts/zero-platform/diagnostics/blog-ui';
// Locally generated two-second, 64×64 VP8 clip. No remote media or codec dependency at test time.
const video = Buffer.from('GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQJChYECGFOAZwEAAAAAAAJMEU2bdLpNu4tTq4QVSalmU6yBoU27i1OrhBZUrmtTrIHYTbuMU6uEElTDZ1OsggElTbuMU6uEHFO7a1OsggI27AEAAAAAAABZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVSalmsirXsYMPQkBNgI1MYXZmNjIuMTIuMTAxV0GNTGF2ZjYyLjEyLjEwMUSJiECfQAAAAAAAFlSua8iuAQAAAAAAAD/XgQFzxYjIeLL5a0oB95yBACK1nIN1bmSIgQCGhVZfVlA4g4EBI+ODhB3NZQDgkLCBQLqBQJqBAlWwhFW5gQESVMNn/HNzoGPAgGfImkWjh0VOQ09ERVJEh41MYXZmNjIuMTIuMTAxc3PWY8CLY8WIyHiy+WtKAfdnyKFFo4dFTkNPREVSRIeUTGF2YzYyLjI4LjEwMSBsaWJ2cHhnyKFFo4hEVVJBVElPTkSHkzAwOjAwOjAyLjAwMDAwMDAwMAAfQ7Z1QIrngQCjvYEAAICQAwCdASpAAEAAAEcIhYWIhYSIAgICdaoD+AIG6EFcMdITAFVYAP735J//PTNeYP8nP/izkYjsvACjloEB9ADRAQABEBAAGAAYWC/0AAiOgACjloED6ADRAQABEBAAGAAYWC/0AAiOgACjloEF3ADRAQABEBAAGAAYWC/0AAiOgAAcU7trkbuPs4EAt4r3gQHxggGm8IED', 'base64');
let lease: PlaywrightTestBrowserLease | undefined, script = '', css = '';
beforeAll(async () => {
  if (!playwrightTestBrowserAvailable) return;
  const root = await mkdtemp('/Volumes/code-bank/tmp/scratch/zero-platform/blog-ui-');
  try {
    const built = await Bun.build({ entrypoints: [`${import.meta.dir}/blog.browser-fixture.tsx`], target: 'browser', format: 'iife', define: { 'process.env.NODE_ENV': JSON.stringify('test') } });
    if (!built.success) throw new Error(built.logs.map(log => log.message).join('\n'));
    script = await built.outputs.find(output => output.path.endsWith('.js'))!.text();
    css = await Bun.file((await buildPlatformStyles(root, `${root}/absent`, [], { themeFoundation: 'next' })).cssPath).text();
    for (const output of built.outputs.filter(output => output.path.endsWith('.css'))) css += '\n' + await output.text();
  } finally { await rm(root, { recursive: true, force: true }); }
  await mkdir(evidence, { recursive: true }); lease = await acquirePlaywrightTestBrowser();
}, 60_000);
afterAll(() => lease?.release());
async function mount(width = 1440, reduced = true): Promise<Page> {
  const page = await lease!.browser.newPage({ viewport: { width, height: 960 }, reducedMotion: reduced ? 'reduce' : 'no-preference' }); page.setDefaultTimeout(8000);
  await page.route('**/*', route => {
    if (route.request().url().endsWith('/video.webm')) return route.fulfill({ contentType: 'video/webm', body: video });
    if (/\/(?:cover|detail)\.svg$/u.test(route.request().url())) return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="700"><rect width="1200" height="700" fill="#536889"/><circle cx="760" cy="280" r="210" fill="#8296b3"/></svg>' });
    if (route.request().url().endsWith('/tone.wav')) {
      const body = tone(), range = route.request().headers().range?.match(/^bytes=(\d+)-(\d*)$/u);
      if (range) { const start = Number(range[1]), end = Math.min(body.length - 1, range[2] ? Number(range[2]) : body.length - 1); return route.fulfill({ status: 206, contentType: 'audio/wav', headers: { 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${body.length}` }, body: body.subarray(start, end + 1) }); }
      return route.fulfill({ contentType: 'audio/wav', headers: { 'Accept-Ranges': 'bytes' }, body });
    }
    return route.abort();
  });
  await page.setContent('<!doctype html><html><head><base href="http://zero-blog.test/"></head><body><div id="root"></div></body></html>'); await page.addStyleTag({ content: css }); await page.addScriptTag({ content: script });
  await page.getByTestId('blog-fixture').waitFor(); return page;
}
function tone(): Buffer {
  const samples = 8000 * 8, bytes = Buffer.alloc(44 + samples * 2); bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8); bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(8000, 24); bytes.writeUInt32LE(16000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) bytes.writeInt16LE(Math.round(Math.sin(i / 8000 * Math.PI * 440 * 2) * 800), 44 + i * 2); return bytes;
}
browserTest('Magazine defaults, scoped overrides, local filters, pagination and bounded layouts', async () => {
  const page = await mount();
  try {
    expect(await page.locator('.zero-blog-list').getAttribute('data-variant')).toBe('magazine');
    expect(await page.locator('.zero-blog-recent-grid').evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length)).toBe(2);
    await page.waitForFunction(() => { const image = document.querySelector<HTMLImageElement>('.zero-blog-card-media img'); return image?.complete && image.naturalWidth > 0; });
    await page.addStyleTag({ content: '.fixture-toolbar{display:none!important}' });
    await page.screenshot({ path: `${evidence}/magazine-light.png`, fullPage: false });
    const filter = page.getByRole('group', { name: 'Article categories', exact: true });
    await filter.getByRole('button', { name: 'Design', exact: true }).click();
    expect(await page.locator('.zero-blog-all-posts .zero-blog-card').count()).toBe(9);
    expect(await filter.getByRole('button', { name: 'Design', exact: true }).getAttribute('aria-pressed')).toBe('true');
    await page.getByRole('button', { name: 'All articles', exact: true }).click();
    await page.getByRole('link', { name: 'Page 2', exact: true }).click();
    expect(await page.getByRole('link', { name: 'Page 2', exact: true }).getAttribute('aria-current')).toBe('page');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { await page.close(); }
}, 25_000);
browserTest('inline search keeps focus, uses the owned dropdown and accepts keyboard choices', async () => {
  const page = await mount();
  try {
    await page.getByRole('button', { name: 'Show parts', exact: true }).click();
    const input = page.getByRole('combobox', { name: 'Inline articles', exact: true }); await input.fill('dependable');
    await page.locator('.zero-blog-search-dropdown [role="option"]').first().waitFor();
    expect(await input.getAttribute('aria-expanded')).toBe('true'); expect(await input.evaluate(element => element === document.activeElement)).toBe(true);
    expect(await page.locator('.zero-blog-search-preview').isVisible()).toBe(true);
    await input.press('ArrowDown'); await input.press('Enter'); await page.waitForFunction(() => document.querySelector('[data-testid="selection"]')?.textContent?.startsWith('post-'));
    expect(await page.locator('.zero-blog-search-dropdown').count()).toBe(0);
  } finally { await page.close(); }
}, 25_000);
browserTest('rich author and category previews remain interactive and close through the shared surface', async () => {
  const page = await mount();
  try {
    await page.getByRole('button', { name: 'Show parts', exact: true }).click(); await page.getByRole('button', { name: 'Author details', exact: true }).click();
    const preview = page.locator('.zero-blog-rich-preview'); await preview.waitFor();
    expect(await preview.getByRole('link', { name: 'Website', exact: true }).getAttribute('href')).toBe('https://example.test/author');
    await preview.getByRole('button', { name: 'View all posts', exact: true }).click(); expect(await page.getByTestId('selection').textContent()).toBe('author-posts');
    await page.keyboard.press('Escape'); await preview.waitFor({ state: 'detached' });
    await page.getByRole('button', { name: 'Category details', exact: true }).click(); await preview.waitFor();
    await preview.getByRole('button', { name: 'Design', exact: true }).click(); await preview.waitFor({ state: 'detached' });
    expect(await page.getByTestId('selection').textContent()).toBe('design');
  } finally { await page.close(); }
}, 25_000);
browserTest('gallery keeps one modal while changing images and exposes token-driven lens and bounded zoom', async () => {
  const page = await mount();
  try {
    await page.getByRole('button', { name: 'Show parts', exact: true }).click(); await page.getByRole('button', { name: 'Expand Gallery one', exact: true }).click();
    const dialog = page.getByRole('dialog'); await dialog.waitFor(); const identity = await dialog.getAttribute('data-zero-modal-id');
    await dialog.getByRole('button', { name: 'Next image', exact: true }).click(); await page.getByRole('dialog', { name: 'Second image', exact: true }).waitFor();
    expect(await dialog.getAttribute('data-zero-modal-id')).toBe(identity); expect(await page.locator('.zero-modal-backdrop').count()).toBe(1);
    await dialog.getByRole('button', { name: 'Zoom in', exact: true }).click(); await dialog.getByRole('button', { name: 'Zoom in', exact: true }).click();
    expect(await dialog.getByRole('button', { name: 'Zoom in', exact: true }).isDisabled()).toBe(true);
    await dialog.getByRole('button', { name: 'Reset', exact: true }).click(); await dialog.getByRole('button', { name: 'Magnifying lens', exact: true }).click();
    await dialog.locator('.zero-blog-lightbox-scene img').hover(); await dialog.locator('.zero-blog-image-lens').waitFor();
    expect(await dialog.locator('.zero-blog-image-lens').evaluate(element => getComputedStyle(element).width)).toBe('132px');
    await page.screenshot({ path: `${evidence}/gallery-lens.png`, fullPage: false });
    await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'detached' });
  } finally { await page.close(); }
}, 25_000);
browserTest('reading indicators observe their real viewport and spotlight paint never intercepts actions', async () => {
  const page = await mount();
  try {
    await page.getByRole('button', { name: 'Show parts', exact: true }).click();
    const viewport = page.locator('.zero-blog-parts-fixture > [data-slot="scroll-area"] [data-radix-scroll-area-viewport]');
    await viewport.evaluate(element => { element.scrollTop = (element.scrollHeight - element.clientHeight) / 2; });
    await page.waitForFunction(() => Number(document.querySelector('.zero-blog-reading-bar')?.getAttribute('aria-valuenow')) > 40);
    expect(Number(await page.locator('.zero-blog-reading-circle').getAttribute('aria-valuenow'))).toBeGreaterThan(40);
    await page.getByRole('button', { name: 'Spotlight action', exact: true }).hover();
    expect(await page.locator('.zero-blog-spotlight').getAttribute('data-active')).toBe('true');
    await page.getByRole('button', { name: 'Spotlight action', exact: true }).click(); expect(await page.getByTestId('selection').textContent()).toBe('spotlight');
  } finally { await page.close(); }
}, 25_000);
browserTest('media parts operate the same real element, retain isolation and report source errors safely', async () => {
  const page = await mount();
  try {
    await page.getByRole('button', { name: 'Show parts', exact: true }).click();
    const player = page.getByRole('group', { name: 'Measured audio', exact: true });
    await page.waitForFunction(() => document.querySelector<HTMLAudioElement>('[aria-label="Measured audio"] audio')?.duration === 8);
    await player.getByRole('button', { name: 'Play', exact: true }).click(); await player.getByRole('button', { name: 'Pause', exact: true }).waitFor();
    await player.getByRole('button', { name: 'Pause', exact: true }).click();
    await player.getByRole('button', { name: 'Forward 1 seconds', exact: true }).click(); expect(await player.locator('audio').evaluate((element: HTMLAudioElement) => element.currentTime)).toBeGreaterThanOrEqual(1);
    await player.getByRole('button', { name: 'Mute', exact: true }).click(); expect(await player.locator('audio').evaluate((element: HTMLAudioElement) => element.muted)).toBe(true);
    await player.getByRole('button', { name: 'Loop playback', exact: true }).click(); expect(await player.locator('audio').evaluate((element: HTMLAudioElement) => element.loop)).toBe(true);
    expect(await page.getByRole('group', { name: 'Custom audio', exact: true }).locator('audio').evaluate((element: HTMLAudioElement) => element.paused)).toBe(true);
    const retired = await player.locator('audio').elementHandle();
    await page.getByRole('button', { name: 'Change media source', exact: true }).click(); await player.getByRole('alert').waitFor();
    expect(await retired!.evaluate(element => !element.isConnected && (element as HTMLAudioElement).paused)).toBe(true);
    expect(await player.textContent()).not.toContain('/missing.wav');
  } finally { await page.close(); }
}, 25_000);
browserTest('video decodes locally and custom controls own playback and fullscreen', async () => {
  const page = await mount();
  try {
    await page.getByRole('button', { name: 'Show parts', exact: true }).click();
    const player = page.getByRole('group', { name: 'Custom video', exact: true });
    await page.waitForFunction(() => document.querySelector<HTMLVideoElement>('[aria-label="Custom video"] video')?.videoWidth === 64);
    await player.getByRole('button', { name: 'Play', exact: true }).click(); await player.getByRole('button', { name: 'Pause', exact: true }).click();
    expect(await player.locator('video').evaluate((element: HTMLVideoElement) => element.paused)).toBe(true);
    await player.getByRole('button', { name: 'Fullscreen video', exact: true }).click();
    await page.waitForFunction(() => document.fullscreenElement?.getAttribute('aria-label') === 'Custom video');
    await player.getByRole('button', { name: 'Exit fullscreen', exact: true }).click(); await page.waitForFunction(() => !document.fullscreenElement);
  } finally { await page.close(); }
}, 25_000);
browserTest('a late play resolution pauses the retired source without affecting its replacement', async () => {
  const page = await mount();
  try {
    await page.getByRole('button', { name: 'Show parts', exact: true }).click();
    const player = page.getByRole('group', { name: 'Measured audio', exact: true }), retired = await player.locator('audio').elementHandle();
    await retired!.evaluate(element => {
      const media = element as HTMLAudioElement & { resolveDeferred?: () => void };
      media.play = () => new Promise<void>(resolve => { media.resolveDeferred = resolve; });
      media.pause = () => { media.dataset.pauseCalls = String(Number(media.dataset.pauseCalls ?? 0) + 1); };
    });
    await player.getByRole('button', { name: 'Play', exact: true }).click();
    await page.getByRole('button', { name: 'Change media source', exact: true }).click(); await player.getByRole('alert').waitFor();
    const pauses = await retired!.evaluate(async element => {
      (element as HTMLAudioElement & { resolveDeferred?: () => void }).resolveDeferred?.();
      await new Promise(resolve => setTimeout(resolve, 0)); return Number((element as HTMLElement).dataset.pauseCalls);
    });
    expect(pauses).toBeGreaterThanOrEqual(2); expect(await player.getByRole('button', { name: 'Play', exact: true }).isEnabled()).toBe(true);
  } finally { await page.close(); }
}, 25_000);
browserTest('inline selection and newsletter failures remain safe and retryable on mobile', async () => {
  const page = await mount(390);
  try {
    await page.getByRole('checkbox', { name: 'Fail command', exact: true }).check(); await page.getByRole('button', { name: 'Show parts', exact: true }).click();
    const input = page.getByRole('combobox', { name: 'Inline articles', exact: true }); await input.fill('dependable');
    await page.locator('.zero-blog-search-dropdown [role="option"]').first().click(); await page.locator('.zero-blog-search-dropdown [role="alert"]').waitFor();
    expect(await page.locator('.zero-blog-search-dropdown').textContent()).not.toContain('PRIVATE_INLINE_FAILURE');
    expect(await input.isEnabled()).toBe(true); expect(await page.locator('.zero-blog-search-preview').isVisible()).toBe(false);
    await input.press('Escape');
    await page.getByRole('button', { name: 'Open newsletter', exact: true }).click(); const dialog = page.getByRole('dialog', { name: 'Join the journal', exact: true });
    await dialog.getByRole('textbox', { name: 'Email address', exact: true }).fill('reader@example.test'); await dialog.getByRole('button', { name: 'Subscribe', exact: true }).click();
    await dialog.getByRole('status').filter({ hasText: 'Subscription could not be completed' }).waitFor(); expect(await dialog.textContent()).not.toContain('PRIVATE_SUBSCRIBE_FAILURE');
    expect(await dialog.getByRole('button', { name: 'Subscribe', exact: true }).isEnabled()).toBe(true);
    await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'detached' });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { await page.close(); }
}, 25_000);
browserTest('newsletter and provider-trigger commands use accepted managed openings with scope-local state', async () => {
  const page = await mount();
  try {
    await page.getByRole('button', { name: 'Show parts', exact: true }).click();
    expect(await page.getByRole('button', { name: 'Missing newsletter integration', exact: true }).count()).toBe(0);
    await page.getByRole('button', { name: 'Open newsletter', exact: true }).click();
    const newsletter = page.getByRole('dialog', { name: 'Join the journal', exact: true }); await newsletter.waitFor();
    await newsletter.getByRole('textbox', { name: 'Email address', exact: true }).fill('reader@example.test'); await newsletter.getByRole('button', { name: 'Subscribe', exact: true }).click();
    await newsletter.waitFor({ state: 'detached' }); expect(await page.getByTestId('selection').textContent()).toBe('subscribed');
    await page.getByRole('button', { name: 'Open scoped commands', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Scoped commands', exact: true }); await dialog.waitFor(); await dialog.getByRole('combobox').fill('Help');
    expect(await dialog.getByTestId('provider-context').textContent()).toContain('Help');
    await dialog.getByRole('option').click(); await dialog.waitFor({ state: 'detached' }); expect(await page.getByTestId('selection').textContent()).toBe('help');
  } finally { await page.close(); }
}, 25_000);
browserTest('rich search uses the shared manager, groups, magnetic highlight and keyboard selection', async () => {
  const page = await mount();
  try {
    await page.getByRole('button', { name: 'Search articles', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Search articles', exact: true }); await dialog.waitFor();
    expect(await page.locator('.zero-modal-backdrop').count()).toBe(1);
    await dialog.getByRole('combobox').fill('@Avery');
    await dialog.getByRole('option', { name: /Avery Brooks/ }).waitFor();
    await dialog.getByRole('combobox').press('ArrowDown'); await dialog.getByRole('combobox').press('Enter');
    await dialog.waitFor({ state: 'detached' }); expect(await page.getByTestId('selection').textContent()).toBe('avery');
    await page.getByRole('button', { name: 'Search articles', exact: true }).click(); await dialog.waitFor();
    await page.addStyleTag({ content: '.fixture-toolbar,[data-testid="selection"]{visibility:hidden!important}' });
    await page.screenshot({ path: `${evidence}/rich-search.png`, fullPage: false });
    await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'detached' });
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Search articles');
  } finally { await page.close(); }
}, 25_000);
browserTest('article defaults auto TOC, real ScrollArea, inherited type and origin-managed image preview', async () => {
  const page = await mount();
  try {
    await page.getByRole('button', { name: 'Show article', exact: true }).click();
    expect(await page.locator('.zero-blog-post').getAttribute('data-variant')).toBe('with-sidebar');
    await page.locator('.zero-blog-article-sidebar a[href="#introduction"]').waitFor();
    expect(await page.locator('.zero-blog-hero h1').evaluate(element => getComputedStyle(element).fontSize)).toBe('36px');
    expect(await page.locator('.zero-blog-hero').getAttribute('data-overlay')).toBe('true');
    await page.addStyleTag({ content: '.fixture-toolbar{display:none!important}' });
    await page.screenshot({ path: `${evidence}/article-hero.png`, fullPage: false });
    expect(await page.locator('.zero-blog-prose').evaluate(element => getComputedStyle(element).fontSize)).toBe('19px');
    expect(await page.locator('.zero-blog-article-sidebar [data-slot="scroll-area"]').count()).toBe(1);
    expect(await page.locator('.zero-blog-article-sidebar [data-radix-scroll-area-viewport]').evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
    await page.locator('.zero-blog-article-body').evaluate(element => element.scrollIntoView());
    await page.screenshot({ path: `${evidence}/article-sidebar.png`, fullPage: false });
    await page.getByRole('button', { name: 'Expand Editorial detail', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'A shared managed lightbox', exact: true }); await dialog.waitFor();
    expect(await page.locator('.zero-modal-backdrop').count()).toBe(1);
    await dialog.getByRole('button', { name: 'Zoom in', exact: true }).click(); expect(await dialog.locator('output').textContent()).toBe('150%');
    expect(await dialog.locator('[data-radix-scroll-area-viewport]').evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
    await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'detached' });
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Expand Editorial detail');
  } finally { await page.close(); }
}, 25_000);
browserTest('mobile/dark inherit the app, preserve readable layout and obey reduced motion', async () => {
  const page = await mount(390);
  try {
    await page.evaluate(() => document.documentElement.classList.add('dark'));
    await page.getByRole('button', { name: 'Show article', exact: true }).click();
    expect(await page.locator('.zero-blog-article-sidebar').isVisible()).toBe(false);
    expect(await page.locator('.zero-blog-inline-toc').isVisible()).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await page.locator('.zero-blog-post').evaluate(element => parseFloat(getComputedStyle(element).getPropertyValue('--zero-blog-duration-enter')))).toBe(0);
    await page.addStyleTag({ content: '.fixture-toolbar{display:none!important}' });
    await page.screenshot({ path: `${evidence}/article-mobile-dark.png`, fullPage: false });
  } finally { await page.close(); }
}, 25_000);
browserTest('generic commands keep failures local and retryable without exposing exception content', async () => {
  const page = await mount();
  try {
    await page.getByRole('checkbox', { name: 'Fail command', exact: true }).check(); await page.getByRole('button', { name: 'App commands', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'App commands', exact: true }); await dialog.waitFor();
    expect(await dialog.evaluate(element => getComputedStyle(element).width)).toBe('576px');
    await dialog.getByRole('option', { name: /Open billing/ }).click(); await dialog.getByRole('alert').waitFor();
    expect(await dialog.textContent()).not.toContain('PRIVATE_COMMAND_ERROR'); expect(await dialog.getByRole('combobox').isEnabled()).toBe(true);
    await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'detached' });
  } finally { await page.close(); }
}, 25_000);
browserTest('blog search awaits rejected callbacks and retains a retryable managed opening', async () => {
  const page = await mount();
  try {
    await page.getByRole('checkbox', { name: 'Fail command', exact: true }).check();
    await page.getByRole('button', { name: 'Search articles', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Search articles', exact: true }); await dialog.waitFor();
    await dialog.getByRole('option').first().click(); await dialog.getByRole('alert').waitFor();
    expect(await dialog.textContent()).not.toContain('PRIVATE_BLOG_ERROR');
    expect(await dialog.getByRole('combobox').isEnabled()).toBe(true);
    await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'detached' });
    await page.getByRole('checkbox', { name: 'Fail command', exact: true }).uncheck();
    await page.getByRole('button', { name: 'Search articles', exact: true }).click(); await dialog.waitFor();
    await dialog.getByRole('option').first().click(); await dialog.waitFor({ state: 'detached' });
    expect(await page.getByTestId('selection').textContent()).toBe('post-0');
  } finally { await page.close(); }
}, 25_000);
