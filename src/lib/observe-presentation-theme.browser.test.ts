/** Native MutationObserver qualification of known shadow boundaries; no application/bootstrap/stylesheet replacement. */
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { acquirePlaywrightTestBrowser, playwrightTestBrowserAvailable, type PlaywrightTestBrowserLease } from '../test-support/playwright-test-browser';

const browserTest = playwrightTestBrowserAvailable ? test : test.skip;
let lease: PlaywrightTestBrowserLease | undefined, script = '';
beforeAll(async () => {
  if (!playwrightTestBrowserAvailable) return;
  const build = await Bun.build({ entrypoints: [new URL('./observe-presentation-theme.browser-fixture.ts', import.meta.url).pathname], target: 'browser', format: 'iife' });
  if (!build.success) throw new Error(build.logs.map(log => log.message).join('\n'));
  script = await build.outputs[0]!.text(); lease = await acquirePlaywrightTestBrowser();
});
afterAll(() => lease?.release());

interface Evidence {
  source: HTMLElement;
  shadow: ShadowRoot;
  dispose: () => void;
  samples: { connected: boolean; paint: string }[];
}
declare global { interface Window { __presentationEvidence: Evidence } }

browserTest('closed shadow boundaries follow scoped attributes, removal and later same-branch reinsertion', async () => {
  const page = await lease!.browser.newPage();
  try {
    await page.setContent('<!doctype html><html style="--sample:root"><body><div id="host" data-zero-mode="light"></div></body></html>');
    await page.addStyleTag({ content: '#host{--sample:light}#host[data-zero-mode="dark"]{--sample:dark}' });
    await page.addScriptTag({ content: script });
    await page.evaluate(() => {
      const shadow = document.querySelector('#host')!.attachShadow({ mode: 'closed' });
      const source = document.createElement('span'); shadow.append(source);
      const samples: Evidence['samples'] = [];
      const dispose = window.__observePresentationTheme(source, () => {
        const target = source.isConnected ? source : source.ownerDocument.documentElement;
        samples.push({ connected: source.isConnected, paint: target.ownerDocument.defaultView!.getComputedStyle(target).getPropertyValue('--sample').trim() });
      });
      window.__presentationEvidence = { source, shadow, samples, dispose };
    });
    await page.locator('#host').evaluate(element => element.setAttribute('data-zero-mode', 'dark'));
    await page.waitForFunction(() => window.__presentationEvidence.samples.at(-1)?.paint === 'dark');
    await page.evaluate(() => window.__presentationEvidence.source.remove());
    await page.waitForFunction(() => window.__presentationEvidence.samples.at(-1)?.connected === false);
    expect(await page.evaluate(() => window.__presentationEvidence.samples.at(-1))).toEqual({ connected: false, paint: 'root' });
    await page.evaluate(() => window.__presentationEvidence.shadow.append(window.__presentationEvidence.source));
    await page.waitForFunction(() => window.__presentationEvidence.samples.at(-1)?.connected === true);
    expect(await page.evaluate(() => window.__presentationEvidence.samples.at(-1))).toEqual({ connected: true, paint: 'dark' });
    const count = await page.evaluate(() => window.__presentationEvidence.samples.length);
    await page.evaluate(() => {
      window.__presentationEvidence.source.append(document.createElement('span'));
      document.querySelector('#host')!.setAttribute('data-content-only', 'unchanged-paint');
    });
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
    expect(await page.evaluate(() => window.__presentationEvidence.samples.length)).toBe(count);
    await page.evaluate(() => {
      window.__presentationEvidence.dispose();
      document.querySelector('#host')!.setAttribute('data-zero-mode', 'light');
      window.__presentationEvidence.source.remove();
    });
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
    expect(await page.evaluate(() => window.__presentationEvidence.samples.length)).toBe(count);
  } finally { await page.close(); }
}, 20_000);

browserTest('connected adoption into another document rebinds its realm and old ancestors stop publishing', async () => {
  const page = await lease!.browser.newPage();
  try {
    await page.setContent('<!doctype html><html><body><div id="before" style="--sample:before"><span id="source"></span></div><iframe id="frame"></iframe></body></html>');
    await page.addScriptTag({ content: script });
    await page.evaluate(() => {
      const source = document.querySelector<HTMLElement>('#source')!, samples: Evidence['samples'] = [];
      const dispose = window.__observePresentationTheme(source, () => samples.push({ connected: source.isConnected,
        paint: source.ownerDocument.defaultView!.getComputedStyle(source.isConnected ? source : source.ownerDocument.documentElement).getPropertyValue('--sample').trim() }));
      const frame = document.querySelector<HTMLIFrameElement>('#frame')!.contentDocument!;
      frame.body.style.setProperty('--sample', 'adopted'); frame.body.append(source);
      window.__presentationEvidence = { source, samples, dispose, shadow: null as unknown as ShadowRoot };
    });
    await page.waitForFunction(() => window.__presentationEvidence.samples.at(-1)?.paint === 'adopted');
    await page.frameLocator('#frame').locator('body').evaluate(element => {
      (element as HTMLElement).style.setProperty('--sample', 'live-frame'); element.setAttribute('data-zero-density', 'touch');
    });
    await page.waitForFunction(() => window.__presentationEvidence.samples.at(-1)?.paint === 'live-frame');
    const count = await page.evaluate(() => window.__presentationEvidence.samples.length);
    await page.locator('#before').evaluate(element => (element as HTMLElement).style.setProperty('--sample', 'stale'));
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
    expect(await page.evaluate(() => window.__presentationEvidence.samples.length)).toBe(count);
    await page.evaluate(() => window.__presentationEvidence.dispose());
  } finally { await page.close(); }
}, 20_000);

browserTest('accessible slots follow flattened inheritance, reassignment and cleanup without unrelated notifications', async () => {
  const page = await lease!.browser.newPage();
  page.setDefaultTimeout(3_000);
  try {
    await page.setContent('<!doctype html><html><body><div id="host" style="--sample:host"><span id="source" slot="missing"></span></div></body></html>');
    await page.addScriptTag({ content: script });
    await page.evaluate(() => {
      const host = document.querySelector('#host')!, source = document.querySelector<HTMLElement>('#source')!;
      const shadow = host.attachShadow({ mode: 'open' });
      shadow.innerHTML = '<div id="a" style="--sample:light"><slot name="a"></slot></div><div id="b" style="--sample:other"><slot name="b"></slot></div>';
      const samples: Evidence['samples'] = [];
      const dispose = window.__observePresentationTheme(source, () => samples.push({ connected: source.isConnected,
        paint: source.ownerDocument.defaultView!.getComputedStyle(source).getPropertyValue('--sample').trim() }));
      window.__presentationEvidence = { source, shadow, samples, dispose };
    });
    await page.locator('#source').evaluate(element => element.setAttribute('slot', 'a'));
    await page.waitForFunction(() => window.__presentationEvidence.samples.at(-1)?.paint === 'light');
    await page.evaluate(() => (window.__presentationEvidence.shadow.querySelector('#a') as HTMLElement).style.setProperty('--sample', 'dark'));
    await page.waitForFunction(() => window.__presentationEvidence.samples.at(-1)?.paint === 'dark');
    await page.locator('#source').evaluate(element => element.setAttribute('slot', 'b'));
    await page.waitForFunction(() => window.__presentationEvidence.samples.at(-1)?.paint === 'other');
    const count = await page.evaluate(() => window.__presentationEvidence.samples.length);
    await page.evaluate(() => {
      (window.__presentationEvidence.shadow.querySelector('#a') as HTMLElement).style.setProperty('--sample', 'stale');
      const unrelated = document.createElement('span'); unrelated.slot = 'a'; document.querySelector('#host')!.append(unrelated);
    });
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
    expect(await page.evaluate(() => window.__presentationEvidence.samples.length)).toBe(count);
    await page.locator('#source').evaluate(element => element.setAttribute('slot', 'missing'));
    await page.waitForFunction(previous => window.__presentationEvidence.samples.length > previous, count);
    // Unassigned slottables are absent from the flattened render tree; use the
    // native computed value rather than assuming ordinary DOM-parent inheritance.
    expect(await page.evaluate(() => window.__presentationEvidence.samples.at(-1)?.paint)).toBe(
      await page.locator('#source').evaluate(element => getComputedStyle(element).getPropertyValue('--sample').trim()));
    await page.locator('#source').evaluate(element => element.setAttribute('slot', 'b'));
    await page.waitForFunction(() => window.__presentationEvidence.samples.at(-1)?.paint === 'other');
    const disposedCount = await page.evaluate(() => window.__presentationEvidence.samples.length);
    await page.evaluate(() => {
      window.__presentationEvidence.dispose(); window.__presentationEvidence.source.slot = 'a';
      (window.__presentationEvidence.shadow.querySelector('#b') as HTMLElement).style.setProperty('--sample', 'disposed');
    });
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
    expect(await page.evaluate(() => window.__presentationEvidence.samples.length)).toBe(disposedCount);
  } finally { await page.close(); }
}, 20_000);
