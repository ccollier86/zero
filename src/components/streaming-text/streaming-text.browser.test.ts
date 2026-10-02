/**
 * Exercises StreamingText's effect-driven lifecycle in a real browser. The
 * server-rendering tests own initial markup; this suite owns async source,
 * replay, callback, announcement, and source-replacement behavior.
 */

import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { chromium, type Browser, type Page } from 'playwright';

const browserAvailable = existsSync(chromium.executablePath());
const browserTest = browserAvailable ? test : test.skip;

let browser: Browser | undefined;
let buildDir: string | undefined;
let bundlePath: string | undefined;

beforeAll(async () => {
  if (!browserAvailable) return;

  const scratchRoot = join(process.cwd(), '.zero');
  await mkdir(scratchRoot, { recursive: true });
  buildDir = await mkdtemp(join(scratchRoot, 'streaming-text-browser-'));
  const entrypoint = join(buildDir, 'entry.tsx');
  bundlePath = join(buildDir, 'bundle.js');
  const componentPath = join(import.meta.dir, 'streaming-text.tsx');

  await writeFile(entrypoint, browserFixtureSource(componentPath));
  const result = await Bun.build({
    entrypoints: [entrypoint],
    root: process.cwd(),
    outdir: buildDir,
    naming: 'bundle.js',
    target: 'browser',
    format: 'iife',
  });
  if (!result.success) {
    throw new Error(result.logs.map((log) => log.message).join('\n'));
  }

  browser = await chromium.launch({ headless: true });
});

afterAll(async () => {
  await browser?.close();
  if (buildDir) await rm(buildDir, { recursive: true, force: true });
});

describe('StreamingText browser lifecycle', () => {
  browserTest('appends async iterable chunks and completes exactly once', async () => {
    const page = await openHarness();
    try {
      await page.evaluate(() => {
        window.__streamingTextHarness.stream(['Hello', ' world.'], 20);
      });
      await waitForStatus(page, 'done');

      expect(await snapshot(page)).toEqual({
        status: 'done',
        value: 'Hello world.',
        cursor: false,
        valueHidden: false,
        live: '',
        done: ['Hello world.'],
        errors: [],
        statuses: ['streaming', 'done'],
      });
    } finally {
      await page.close();
    }
  });

  browserTest('preserves received text and reports a rejected source', async () => {
    const page = await openHarness();
    try {
      await page.evaluate(() => {
        window.__streamingTextHarness.stream(['Partial'], 10, 'provider failed');
      });
      await waitForStatus(page, 'error');

      expect(await snapshot(page)).toEqual({
        status: 'error',
        value: 'Partial',
        cursor: false,
        valueHidden: false,
        live: 'Partial',
        done: [],
        errors: ['provider failed'],
        statuses: ['streaming', 'error'],
      });
    } finally {
      await page.close();
    }
  });

  browserTest('announces completed sentences before a live source finishes', async () => {
    const page = await openHarness();
    try {
      await page.evaluate(() => {
        window.__streamingTextHarness.stream(['First sentence.', ' Tail'], 250);
      });
      await page.waitForFunction(() => (
        document.querySelector('[aria-live="polite"]')?.textContent === 'First sentence.'
      ));

      expect(await page.locator('[data-slot="streaming-text-value"]').textContent())
        .toBe('First sentence.');
      await waitForStatus(page, 'done');
      expect((await snapshot(page)).value).toBe('First sentence. Tail');
    } finally {
      await page.close();
    }
  });

  browserTest('replays known text and supports caller-owned streaming state', async () => {
    const page = await openHarness();
    try {
      await page.evaluate(() => {
        window.__streamingTextHarness.replay('Replay complete', 240);
      });
      await waitForStatus(page, 'done');
      expect((await snapshot(page)).done).toEqual(['Replay complete']);

      await page.evaluate(() => {
        window.__streamingTextHarness.controlled('Still arriving', true);
      });
      await page.waitForFunction(() => document.querySelector(
        '[data-slot="streaming-text-cursor"]'
      ) != null);
      expect((await snapshot(page)).valueHidden).toBe(true);

      await page.evaluate(() => {
        window.__streamingTextHarness.controlled('Finished answer', false);
      });
      await page.waitForFunction(() => document.querySelector(
        '[data-slot="streaming-text-cursor"]'
      ) == null);
      const settled = await snapshot(page);
      expect(settled.value).toBe('Finished answer');
      expect(settled.valueHidden).toBe(false);
    } finally {
      await page.close();
    }
  });

  browserTest('ignores late chunks after the source identity changes', async () => {
    const page = await openHarness();
    try {
      await page.evaluate(() => window.__streamingTextHarness.replaceSource());
      await page.waitForFunction(() => {
        const root = document.querySelector('[data-slot="streaming-text"]');
        const value = document.querySelector('[data-slot="streaming-text-value"]');
        return root?.getAttribute('data-status') === 'done' && value?.textContent === 'new';
      });
      await page.waitForTimeout(150);

      const state = await snapshot(page);
      expect(state.value).toBe('new');
      expect(state.done).toEqual(['new']);
      expect(state.value).not.toContain('old');
      expect(state.value).not.toContain('late');
    } finally {
      await page.close();
    }
  });
});

async function openHarness(): Promise<Page> {
  if (!browser || !bundlePath) throw new Error('StreamingText browser harness was not initialized');
  const page = await browser.newPage();
  await page.setContent('<div id="root"></div>');
  await page.addScriptTag({ path: bundlePath });
  await page.waitForFunction(() => typeof window.__streamingTextHarness === 'object');
  return page;
}

async function waitForStatus(page: Page, status: string): Promise<void> {
  await page.waitForFunction((expected) => (
    document.querySelector('[data-slot="streaming-text"]')?.getAttribute('data-status') === expected
  ), status);
}

async function snapshot(page: Page): Promise<{
  status: string | null;
  value: string;
  cursor: boolean;
  valueHidden: boolean;
  live: string;
  done: string[];
  errors: string[];
  statuses: string[];
}> {
  return page.evaluate(() => {
    const root = document.querySelector('[data-slot="streaming-text"]');
    const value = document.querySelector('[data-slot="streaming-text-value"]');
    return {
      status: root?.getAttribute('data-status') ?? null,
      value: value?.textContent ?? '',
      cursor: document.querySelector('[data-slot="streaming-text-cursor"]') != null,
      valueHidden: value?.getAttribute('aria-hidden') === 'true',
      live: document.querySelector('[aria-live="polite"]')?.textContent ?? '',
      done: [...window.__streamingTextState.done],
      errors: [...window.__streamingTextState.errors],
      statuses: [...window.__streamingTextState.statuses],
    };
  });
}

function browserFixtureSource(componentPath: string): string {
  return `
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { StreamingText } from ${JSON.stringify(componentPath)};

const root = createRoot(document.getElementById('root'));
const state = { done: [], errors: [], statuses: [] };
window.__streamingTextState = state;

const callbacks = {
  onDone(value) { state.done.push(value); },
  onError(error) { state.errors.push(error instanceof Error ? error.message : String(error)); },
  onStatusChange(status) { state.statuses.push(status); },
};

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const sourceFrom = (chunks, delayMs, failure) => (async function* () {
  for (const chunk of chunks) {
    yield chunk;
    if (delayMs > 0) await sleep(delayMs);
  }
  if (failure) throw new Error(failure);
})();

window.__streamingTextHarness = {
  stream(chunks, delayMs = 0, failure) {
    state.done.length = 0;
    state.errors.length = 0;
    state.statuses.length = 0;
    root.render(React.createElement(StreamingText, {
      source: sourceFrom(chunks, delayMs, failure),
      ...callbacks,
    }));
  },
  replay(text, speed) {
    state.done.length = 0;
    state.errors.length = 0;
    state.statuses.length = 0;
    root.render(React.createElement(StreamingText, { text, speed, ...callbacks }));
  },
  controlled(text, streaming) {
    root.render(React.createElement(StreamingText, { text, streaming, ...callbacks }));
  },
  replaceSource() {
    state.done.length = 0;
    state.errors.length = 0;
    state.statuses.length = 0;
    const oldSource = sourceFrom(['old-', 'late'], 100);
    const newSource = sourceFrom(['new'], 0);
    root.render(React.createElement(StreamingText, { source: oldSource, ...callbacks }));
    setTimeout(() => {
      root.render(React.createElement(StreamingText, { source: newSource, ...callbacks }));
    }, 20);
  },
};
`;
}

declare global {
  interface Window {
    __streamingTextHarness: {
      stream(chunks: string[], delayMs?: number, failure?: string): void;
      replay(text: string, speed: number): void;
      controlled(text: string, streaming: boolean): void;
      replaceSource(): void;
    };
    __streamingTextState: {
      done: string[];
      errors: string[];
      statuses: string[];
    };
  }
}
