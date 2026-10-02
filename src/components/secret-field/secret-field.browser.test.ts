/** Exercises SecretField's reveal, copy, error, and forwarded-ref contracts. */

import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { chromium, type Browser, type Page } from 'playwright';

import { buildPlatformStyles } from '../../frontend/server/style-bundle';

const browserAvailable = existsSync(chromium.executablePath());
const browserTest = browserAvailable ? test : test.skip;
const TEST_TIMEOUT_MS = 60_000;
const GUARDIAN_SECRET = `zero_ak_v1.guardian.${'g'.repeat(43)}`;

let browser: Browser | undefined;
let buildDir: string | undefined;
let bundlePath: string | undefined;
let stylesheetPath: string | undefined;

beforeAll(async () => {
  if (!browserAvailable) return;

  const scratchRoot = join(process.cwd(), '.zero');
  await mkdir(scratchRoot, { recursive: true });
  buildDir = await mkdtemp(join(scratchRoot, 'secret-field-browser-'));
  const entrypoint = join(buildDir, 'entry.tsx');
  bundlePath = join(buildDir, 'bundle.js');
  const componentPath = join(import.meta.dir, 'secret-field.tsx');
  const guardianPath = join(
    import.meta.dir,
    '../auth/api-key-secret-reveal.tsx',
  );

  await writeFile(
    entrypoint,
    browserFixtureSource(componentPath, guardianPath),
  );
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
  stylesheetPath = (
    await buildPlatformStyles(buildDir, join(buildDir, 'missing-app'))
  ).cssPath;

  browser = await chromium.launch({ headless: true });
}, TEST_TIMEOUT_MS);

afterAll(async () => {
  await browser?.close();
  if (buildDir) await rm(buildDir, { recursive: true, force: true });
}, TEST_TIMEOUT_MS);

describe('SecretField browser contract', () => {
  browserTest('supports uncontrolled and controlled masking while sealed fields stay hidden', async () => {
    const page = await openHarness();
    try {
      const uncontrolled = page.locator('#uncontrolled');
      const controlled = page.locator('#controlled');
      const sealed = page.locator('#sealed');

      expect(await uncontrolled.getAttribute('data-masked')).toBe('true');
      await uncontrolled.getByRole('button', { name: 'Show API key' }).click();
      expect(await uncontrolled.getAttribute('data-masked')).toBe('false');
      expect(await uncontrolled.getByText('zero_live_uncontrolled').count()).toBe(1);
      expect(await uncontrolled.getByText('API key showing.').count()).toBe(1);
      expect(
        await uncontrolled.getByRole('button', { name: 'Hide API key' }).getAttribute('aria-pressed'),
      ).toBe('true');

      expect(await controlled.getAttribute('data-masked')).toBe('true');
      await controlled.getByRole('button', { name: 'Show Access token' }).click();
      expect(await controlled.getAttribute('data-masked')).toBe('false');
      expect(await page.evaluate(() => window.__secretFieldHarness.maskChanges))
        .toEqual([false]);

      expect(await sealed.getAttribute('data-masked')).toBe('true');
      expect(await sealed.locator('[data-slot="secret-field-reveal"]').count()).toBe(0);
      expect(await sealed.textContent()).not.toContain('zero_live_sealed');
    } finally {
      await page.close();
    }
  }, TEST_TIMEOUT_MS);

  browserTest('copies the complete masked value, reports failures, and exposes its copy control through the root ref', async () => {
    const page = await openHarness();
    try {
      const root = page.locator('#uncontrolled');
      const copy = root.locator('[data-slot="secret-field-copy"]');

      await page.evaluate(() => window.__secretFieldHarness.focusCopy());
      expect(await copy.evaluate((element) => document.activeElement === element)).toBe(true);

      await copy.click();
      await page.waitForFunction(() => window.__secretFieldHarness.copied === 1);
      expect(await page.evaluate(() => window.__secretFieldHarness.writes))
        .toEqual(['zero_live_uncontrolled']);
      expect(await page.evaluate(() => window.__secretFieldHarness.copiedArgumentCounts))
        .toEqual([0]);
      expect(await copy.getAttribute('aria-label')).toBe('API key copied');
      expect(await root.getByRole('status').textContent())
        .toBe('API key copied to clipboard.');

      await page.evaluate(() => window.__secretFieldHarness.rejectCopies(true));
      await copy.click();
      await page.waitForFunction(() => window.__secretFieldHarness.copyErrors === 1);
      expect(await root.getAttribute('data-copy-state')).toBe('error');
      expect(await copy.getAttribute('aria-label')).toBe('Copy API key failed');
      expect(await root.getByRole('status').textContent())
        .toBe('API key could not be copied.');
      expect(await page.evaluate(() => window.__secretFieldHarness.copyErrorMessages))
        .toEqual(['Clipboard write failed.']);
      expect(
        await page.evaluate(() =>
          window.__secretFieldHarness.copyErrorMessages.some((message) =>
            message.includes('zero_live_uncontrolled'),
          ),
        ),
      ).toBe(false);
    } finally {
      await page.close();
    }
  }, TEST_TIMEOUT_MS);

  browserTest('retires an in-flight copy when the displayed value changes', async () => {
    const page = await openHarness();
    try {
      const root = page.locator('#uncontrolled');
      const copy = root.locator('[data-slot="secret-field-copy"]');

      await root.getByRole('button', { name: 'Show API key' }).click();
      expect(await root.getAttribute('data-masked')).toBe('false');

      await page.evaluate(() => window.__secretFieldHarness.deferCopies(true));
      await copy.click();
      await page.waitForFunction(() => window.__secretFieldHarness.pendingCopies === 1);

      await page.evaluate(() =>
        window.__secretFieldHarness.setSecret('zero_live_replacement'),
      );
      await page.waitForFunction(() =>
        document.querySelector('#uncontrolled')?.getAttribute('data-masked') === 'true',
      );
      expect(await root.getAttribute('data-masked')).toBe('true');
      expect(await root.textContent()).not.toContain('zero_live_replacement');
      await page.evaluate(() => window.__secretFieldHarness.resolveCopies());
      await page.waitForTimeout(50);

      expect(await root.getAttribute('data-copy-state')).toBe('idle');
      expect(await page.evaluate(() => window.__secretFieldHarness.copied)).toBe(0);
      expect(await page.evaluate(() => window.__secretFieldHarness.copyErrors)).toBe(0);
      expect(await root.getByRole('status').textContent()).toBe('');
    } finally {
      await page.close();
    }
  }, TEST_TIMEOUT_MS);

  browserTest('gives Guardian a keyboard-safe manual-copy fallback and clears the secret on dismissal', async () => {
    const page = await openHarness();
    try {
      const guardian = page.locator('#guardian');
      const field = guardian.locator('[data-slot="secret-field"]');
      const copy = field.locator('[data-slot="secret-field-copy"]');

      expect(await field.getAttribute('data-masked')).toBe('true');
      expect(await guardian.textContent()).not.toContain(GUARDIAN_SECRET);

      await page.evaluate(() => window.__secretFieldHarness.rejectCopies(true));
      await copy.click();
      await guardian.getByRole('alert').waitFor();
      await page.waitForFunction(() =>
        document.activeElement?.getAttribute('data-slot') ===
          'secret-field-value',
      );

      expect(await field.getAttribute('data-masked')).toBe('false');
      expect(await guardian.getByRole('alert').textContent()).toContain(
        'revealed, focused, and selected',
      );
      expect(
        await page.evaluate(() => ({
          activeSlot: document.activeElement?.getAttribute('data-slot'),
          selection: window.getSelection()?.toString(),
        })),
      ).toEqual({
        activeSlot: 'secret-field-value',
        selection: GUARDIAN_SECRET,
      });

      await guardian
        .getByRole('button', { name: 'Dismiss and clear from page' })
        .click();
      expect(await field.count()).toBe(0);
      expect(await guardian.textContent()).not.toContain(GUARDIAN_SECRET);
      expect(await page.evaluate(() => window.__secretFieldHarness.dismissed))
        .toBe(1);
    } finally {
      await page.close();
    }
  }, TEST_TIMEOUT_MS);

  browserTest('uses Zero semantic surfaces in light and dark themes', async () => {
    const page = await openHarness();
    try {
      const light = await readThemeColors(page);
      expect(light.surface).toBe(light.expectedSurface);
      expect(light.foreground).toBe(light.expectedForeground);
      expect(light.border).toBe(light.expectedBorder);

      await page.evaluate(() => document.documentElement.classList.add('dark'));
      await page.evaluate(() =>
        new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
      );
      const dark = await readThemeColors(page);
      expect(dark.surface).toBe(dark.expectedSurface);
      expect(dark.foreground).toBe(dark.expectedForeground);
      expect(dark.border).toBe(dark.expectedBorder);
      expect(dark.surface).not.toBe(light.surface);
      expect(dark.foreground).not.toBe(light.foreground);
    } finally {
      await page.close();
    }
  }, TEST_TIMEOUT_MS);
});

async function openHarness(): Promise<Page> {
  if (!browser || !bundlePath || !stylesheetPath) {
    throw new Error('SecretField browser harness was not initialized.');
  }

  const page = await browser.newPage();
  await page.setContent('<div id="root"></div>');
  await page.addStyleTag({ path: stylesheetPath });
  await page.evaluate(() => {
    let defer = false;
    let reject = false;
    const writes: string[] = [];
    const pending: Array<() => void> = [];

    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        async writeText(value: string) {
          if (reject) throw new DOMException('Permission denied', 'NotAllowedError');
          if (defer) {
            await new Promise<void>((resolve) => {
              pending.push(() => {
                writes.push(value);
                resolve();
              });
            });
            return;
          }
          writes.push(value);
        },
      },
    });

    window.__secretClipboardControl = {
      writes,
      get pendingCopies() {
        return pending.length;
      },
      setDeferred(value: boolean) {
        defer = value;
      },
      setReject(value: boolean) {
        reject = value;
      },
      resolveCopies() {
        defer = false;
        pending.splice(0).forEach((resolve) => resolve());
      },
    };
  });
  await page.addScriptTag({ path: bundlePath });
  await page.waitForFunction(() => typeof window.__secretFieldHarness === 'object');
  return page;
}

async function readThemeColors(page: Page): Promise<{
  surface: string;
  foreground: string;
  border: string;
  expectedSurface: string;
  expectedForeground: string;
  expectedBorder: string;
}> {
  return page.evaluate(() => {
    const root = document.querySelector<HTMLElement>('#uncontrolled');
    if (!root) throw new Error('SecretField root is missing.');

    const probe = document.createElement('div');
    probe.className = 'absolute border border-border/80 bg-card text-card-foreground';
    document.body.append(probe);

    const actual = getComputedStyle(root);
    const expected = getComputedStyle(probe);
    const colors = {
      surface: actual.backgroundColor,
      foreground: actual.color,
      border: actual.borderTopColor,
      expectedSurface: expected.backgroundColor,
      expectedForeground: expected.color,
      expectedBorder: expected.borderTopColor,
    };
    probe.remove();
    return colors;
  });
}

function browserFixtureSource(
  componentPath: string,
  guardianPath: string,
): string {
  return `
    import * as React from 'react';
    import { createRoot } from 'react-dom/client';
    import { SecretField } from ${JSON.stringify(componentPath)};
    import { ApiKeySecretReveal } from ${JSON.stringify(guardianPath)};

    function Harness() {
      const [masked, setMasked] = React.useState(true);
      const [secret, setSecret] = React.useState('zero_live_uncontrolled');
      const [guardianIssued, setGuardianIssued] = React.useState({
        secret: ${JSON.stringify(GUARDIAN_SECRET)},
        apiKey: {
          keyId: 'guardian-key',
          userId: 'guardian-user',
          label: 'Guardian browser key',
          hint: 'gggg',
          scopeKind: 'application',
          scopeId: 'application',
          tenantId: null,
          membershipId: null,
          createdByUserId: 'guardian-user',
          createdVia: 'self',
          createdAt: 1,
          expiresAt: 2,
          lastUsedAt: null,
          revokedAt: null,
          status: 'active',
        },
      });
      const rootRef = React.useRef(null);
      const stateRef = React.useRef({
        copied: 0,
        copiedArgumentCounts: [],
        copyErrors: 0,
        copyErrorMessages: [],
        maskChanges: [],
        dismissed: 0,
      });

      React.useEffect(() => {
        window.__secretFieldHarness = {
          get writes() { return window.__secretClipboardControl.writes; },
          get copied() { return stateRef.current.copied; },
          get copiedArgumentCounts() { return stateRef.current.copiedArgumentCounts; },
          get copyErrors() { return stateRef.current.copyErrors; },
          get copyErrorMessages() { return stateRef.current.copyErrorMessages; },
          get maskChanges() { return stateRef.current.maskChanges; },
          get dismissed() { return stateRef.current.dismissed; },
          get pendingCopies() { return window.__secretClipboardControl.pendingCopies; },
          deferCopies(value) { window.__secretClipboardControl.setDeferred(value); },
          rejectCopies(value) { window.__secretClipboardControl.setReject(value); },
          resolveCopies() { window.__secretClipboardControl.resolveCopies(); },
          setSecret,
          focusCopy() {
            rootRef.current?.querySelector('[data-slot="secret-field-copy"]')?.focus();
          },
        };
      }, []);

      return <>
        <SecretField
          ref={rootRef}
          id="uncontrolled"
          label="API key"
          value={secret}
          visiblePrefix={10}
          onCopied={(...args) => {
            stateRef.current.copied += 1;
            stateRef.current.copiedArgumentCounts.push(args.length);
          }}
          onCopyError={(error) => {
            stateRef.current.copyErrors += 1;
            stateRef.current.copyErrorMessages.push(error.message);
          }}
        />
        <SecretField
          id="controlled"
          label="Access token"
          value="zero_live_controlled"
          masked={masked}
          onMaskedChange={(next) => {
            stateRef.current.maskChanges.push(next);
            setMasked(next);
          }}
        />
        <SecretField
          id="sealed"
          label="Signing secret"
          value="zero_live_sealed"
          masked={false}
          revealable={false}
        />
        <div id="guardian">
          {guardianIssued ? (
            <ApiKeySecretReveal
              issued={guardianIssued}
              onDismiss={() => {
                stateRef.current.dismissed += 1;
                setGuardianIssued(null);
              }}
            />
          ) : (
            <span>Guardian secret cleared.</span>
          )}
        </div>
      </>;
    }

    createRoot(document.getElementById('root')).render(<Harness />);
  `;
}

declare global {
  interface Window {
    __secretClipboardControl: {
      writes: string[];
      pendingCopies: number;
      setDeferred(value: boolean): void;
      setReject(value: boolean): void;
      resolveCopies(): void;
    };
    __secretFieldHarness: {
      writes: string[];
      copied: number;
      copiedArgumentCounts: number[];
      copyErrors: number;
      copyErrorMessages: string[];
      maskChanges: boolean[];
      dismissed: number;
      pendingCopies: number;
      deferCopies(value: boolean): void;
      rejectCopies(value: boolean): void;
      resolveCopies(): void;
      setSecret(value: string): void;
      focusCopy(): void;
    };
  }
}
