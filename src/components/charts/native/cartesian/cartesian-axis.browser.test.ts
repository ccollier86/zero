/** Actual SVG text-box regression for the public ComposedChart axis report, including phone/theme/font/format variants. */
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { buildPlatformStyles } from '../../../../frontend/server/style-bundle';
import { acquirePlaywrightTestBrowser, playwrightTestBrowserAvailable, type PlaywrightTestBrowserLease } from '../../../../test-support/playwright-test-browser';
const browserTest = playwrightTestBrowserAvailable ? test : test.skip;
const artifacts = process.env.ZERO_CHART_REVIEW_ARTIFACTS;
let lease: PlaywrightTestBrowserLease | undefined, bundle = '', css = '';
beforeAll(async () => {
  if (!playwrightTestBrowserAvailable) return;
  const directory = await mkdtemp(join(tmpdir(), 'zero-chart-axis-'));
  try {
    const result = await Bun.build({ entrypoints: [import.meta.dir + '/cartesian-axis.browser-fixture.tsx'], target: 'browser', format: 'iife', outdir: directory });
    if (!result.success) throw new Error(result.logs.map(log => log.message).join('\n'));
    bundle = await result.outputs[0]!.text(); css = await Bun.file((await buildPlatformStyles(directory, join(directory, 'absent-app'))).cssPath).text();
  } finally { await rm(directory, { recursive: true, force: true }); }
  lease = await acquirePlaywrightTestBrowser(); if (artifacts) await mkdir(artifacts, { recursive: true });
}, 60000);
afterAll(() => lease?.release());
for (const width of [390, 1100]) for (const dark of [false, true]) browserTest(`axis captions and formatted ticks remain separated and bounded at ${width}px ${dark ? 'dark' : 'light'}`, async () => {
  const page = await lease!.browser.newPage({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  try {
    await page.setContent(`<!doctype html><html data-theme="${dark ? 'dark' : 'light'}"${dark ? ' class="dark"' : ''}><body><div id="root"></div></body></html>`);
    await page.addStyleTag({ content: css + 'body{margin:0;background:var(--background);color:var(--foreground)}main{padding:16px;max-width:1100px;margin:auto}.axis-gallery{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,420px),1fr));gap:16px}.axis-card{min-width:0;padding:12px;background:var(--card);border:1px solid var(--border);border-radius:14px}' });
    await page.addScriptTag({ content: bundle }); await page.getByRole('heading', { name: 'Cartesian axis layout review' }).waitFor();
    await page.evaluate(() => document.fonts.ready);
    await page.waitForFunction(() => document.querySelectorAll('[data-axis-case]').length === 48);
    const measurements = await page.locator('[data-axis-case]').evaluateAll(cards => cards.map(card => {
      const svg = card.querySelector('svg')!, svgBox = svg.getBoundingClientRect();
      const labels = Array.from(svg.querySelectorAll('text.zero-native-chart__axis')).map(text => {
        const rect = text.getBoundingClientRect(); return { text: Array.from(text.childNodes).filter(node => node.nodeType === 3).map(node => node.textContent).join(''), caption: text.hasAttribute('data-chart-axis-caption'), x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      }).filter(label => label.text && label.width > 0 && label.height > 0);
      const overlaps: unknown[] = []; for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) {
        const a = labels[i]!, b = labels[j]!, x = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x), y = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
        if (x > .5 && y > .5) overlaps.push({ a: a.text, b: b.text, x, y, caption: a.caption || b.caption });
      }
      const clipped = labels.filter(label => label.x < svgBox.x - .5 || label.y < svgBox.y - .5 || label.x + label.width > svgBox.right + .5 || label.y + label.height > svgBox.bottom + .5);
      const units = JSON.parse(card.getAttribute('data-unit-labels')!) as string[], table = card.querySelector('table')!;
      return { id: card.getAttribute('data-axis-case'), overlaps, clipped, captionCount: labels.filter(label => label.caption).length, expectedCaptionCount: units.length + 1,
        exactUnitsRetained: units.every(unit => table.textContent!.includes(unit)), periodRetained: table.textContent!.includes('Billing period'), exactValues: Array.from(table.querySelectorAll('tbody td')).map(cell => cell.textContent), labels };
    }));
    if (artifacts) {
      await Bun.write(join(artifacts, `measurements-${width}-${dark ? 'dark' : 'light'}.json`), JSON.stringify(measurements, null, 2) + '\n');
      await page.screenshot({ path: join(artifacts, `axis-review-${width}-${dark ? 'dark' : 'light'}.png`), fullPage: false });
    }
    expect(measurements.filter(row => row.overlaps.length || row.clipped.length)).toEqual([]);
    for (const row of measurements) { expect(row.captionCount).toBe(row.expectedCaptionCount); expect(row.exactUnitsRetained && row.periodRetained).toBe(true); expect(row.exactValues.length).toBeGreaterThanOrEqual(6); }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); expect(errors).toEqual([]);
    const familyOverflow = await page.locator('[data-text-case]').evaluateAll(cards => cards.flatMap(card => {
      const frame = card.getBoundingClientRect(), findings: unknown[] = [];
      for (const label of card.querySelectorAll('svg text, .zero-arc-line-chart__axisLabel, .zero-arc-line-chart__tickText, .zero-arc-bar-chart__axisLabel, .zero-arc-bar-chart__tickText')) {
        const box = label.getBoundingClientRect(); if (box.width && box.height && (box.left < frame.left - .5 || box.right > frame.right + .5)) findings.push({family:card.getAttribute('data-text-case'),text:label.textContent,left:box.left-frame.left,right:box.right-frame.right});
      }
      return findings;
    }));
    expect(familyOverflow).toEqual([]);
    const arcOverlap=await page.locator('[data-text-case="arc-line"] .zero-arc-line-chart__axisLabel').evaluateAll(labels=>labels.flatMap((label,index)=>{
      if(!index)return[];const a=labels[index-1]!.getBoundingClientRect(),b=label.getBoundingClientRect();return a.right>b.left+.5?[{left:labels[index-1]!.textContent,right:label.textContent,overlap:a.right-b.left}]:[];
    }));expect(arcOverlap).toEqual([]);
    if (artifacts) await page.locator('[data-text-case="arc-line"]').screenshot({path:join(artifacts,`arc-labels-${width}-${dark?'dark':'light'}.png`)});
  } finally { await page.close(); }
}, 45000);
browserTest('late observations and typography changes remeasure labels without resetting exact data', async () => {
  const page = await lease!.browser.newPage({viewport:{width:390,height:900},reducedMotion:'reduce'});
  try {
    await page.setContent('<!doctype html><html><body><div id="root"></div></body></html>');
    await page.addStyleTag({content:css+'body{margin:0}.axis-card{margin:12px;padding:12px;min-width:0}.axis-gallery{display:none}'});
    await page.addScriptTag({content:bundle});
    await page.getByRole('button',{name:'Load synthetic measurements'}).click();
    const dynamic=page.locator('[data-dynamic-axis]');
    await page.waitForFunction(()=>document.querySelectorAll('[data-dynamic-axis] table')[1]?.querySelectorAll('tbody tr').length===2);
    expect(await dynamic.locator('table').last().locator('tbody tr').count()).toBe(2);
    const labelFits=()=>dynamic.locator('svg').evaluateAll(svgs=>svgs.flatMap(svg=>{
      const frame=svg.getBoundingClientRect();return Array.from(svg.querySelectorAll('text')).flatMap(text=>{
        const box=text.getBoundingClientRect();return box.width>0&&(box.left<frame.left-.5||box.right>frame.right+.5)?[{text:text.textContent,left:box.left-frame.left,right:box.right-frame.right}]:[];
      });
    }));
    expect(await labelFits()).toEqual([]);
    await page.getByRole('button',{name:'Change axis typography'}).click();
    expect(await labelFits()).toEqual([]);
    expect(await dynamic.locator('table').first().textContent()).toContain('-50');
    expect(await dynamic.locator('table').last().textContent()).toContain('Long international service category');
    expect(await dynamic.locator('svg text').first().evaluate(text=>getComputedStyle(text).fontSize)).toBe('22px');
  } finally {await page.close();}
},45000);
