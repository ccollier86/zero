/**
 * playwright-pdf-renderer.ts
 *
 * Implements browser-grade PDF rendering with a lazily launched Playwright
 * Chromium process. This adapter owns browser lifecycle and request blocking;
 * input limits, storage, and app lifecycle remain outside this file.
 */

import type { Browser, BrowserContext, Page, Route } from 'playwright';

import { PdfError } from './pdf-error';
import { applyPdfContentPolicy } from './pdf-content-policy';
import { evaluatePdfResource, sanitizePdfResourceUrl } from './pdf-resource-policy';
import type {
  PdfRenderer,
  PdfRendererResult,
  PdfRendererStatus,
  PreparedPdfRenderInput,
  ResolvedPdfBrowserConfig,
} from './pdf-types';

/** Default browser renderer used by Zero's PDF service. */
export class PlaywrightPdfRenderer implements PdfRenderer {
  readonly name = 'chromium';
  private browser: Browser | null = null;
  private launchPromise: Promise<Browser> | null = null;
  private closed = false;

  constructor(private readonly config: ResolvedPdfBrowserConfig) {}

  /** Render normalized HTML with print media and return in-memory PDF bytes. */
  async render(input: PreparedPdfRenderInput): Promise<PdfRendererResult> {
    if (this.closed) {
      throw new PdfError('The Chromium PDF renderer is closed.', 'PDF_SERVICE_CLOSED');
    }

    const renderState: { context: BrowserContext | null } = { context: null };
    let timedOut = false;
    try {
      return await runWithTimeout(
        (async () => {
          const browser = await this.getBrowser();
          if (timedOut) throw renderTimeout(input.timeoutMs);
          const context = await browser.newContext({
            acceptDownloads: false,
            javaScriptEnabled: this.config.javaScriptEnabled,
            serviceWorkers: 'block',
          });
          renderState.context = context;
          if (timedOut) throw renderTimeout(input.timeoutMs);
          return this.renderInContext(context, input);
        })(),
        input.timeoutMs,
        async () => {
          timedOut = true;
          await closeBrowserContext(renderState.context);
        }
      );
    } catch (error) {
      throw normalizeRendererError(error, input.timeoutMs);
    } finally {
      await closeBrowserContext(renderState.context);
    }
  }

  /** Report whether the shared Chromium process is currently connected. */
  status(): PdfRendererStatus {
    return {
      name: this.name,
      ready: Boolean(this.browser?.isConnected()),
    };
  }

  /** Close the shared browser process and reject future renders. */
  async close(): Promise<void> {
    this.closed = true;
    const browser = this.browser ?? await this.launchPromise?.catch(() => null);
    this.browser = null;
    this.launchPromise = null;
    await browser?.close().catch(() => undefined);
  }

  private async renderInContext(
    context: BrowserContext,
    input: PreparedPdfRenderInput
  ): Promise<PdfRendererResult> {
    const denied = createDeniedResourceCollector();
    await context.route('**/*', (route) => this.handleRoute(route, input, denied));
    const page = await context.newPage();
    page.on('console', (message) => {
      if (/content security policy/i.test(message.text())) {
        recordDeniedResource(denied, '[inline-or-embedded-resource]', 'content-security-policy');
      }
    });
    configurePageTimeouts(page, input.timeoutMs);
    await page.emulateMedia({ media: 'print' });
    const html = applyPdfContentPolicy(
      input.html,
      input.baseUrl,
      input.resources,
      this.config.javaScriptEnabled
    );
    const contentLoad = page.setContent(html, {
      waitUntil: 'load',
      timeout: input.timeoutMs,
    });
    if (input.resources.deniedBehavior === 'error') {
      await Promise.race([contentLoad, denied.firstDenied]);
      if (denied.count > 0) {
        // Closing the context in `render()` will cancel any load that Chromium
        // kept pending for the rejected resource. Observe that cancellation so
        // it cannot become an unhandled rejection after this prompt failure.
        void contentLoad.catch(() => undefined);
        throw deniedResourceError(denied);
      }
    } else {
      await contentLoad;
    }

    if (input.waitForFonts) {
      await page.evaluate(async () => {
        if ('fonts' in document) await document.fonts.ready;
      });
    }
    if (denied.count > 0 && input.resources.deniedBehavior === 'error') {
      throw deniedResourceError(denied);
    }

    const bytes = await page.pdf({
      displayHeaderFooter: input.options.displayHeaderFooter,
      footerTemplate: input.options.footerTemplate,
      format: input.options.format,
      headerTemplate: input.options.headerTemplate,
      height: input.options.height,
      landscape: input.options.landscape,
      margin: input.options.margin,
      outline: input.options.outline,
      pageRanges: input.options.pageRanges,
      preferCSSPageSize: input.options.preferCSSPageSize,
      printBackground: input.options.printBackground,
      scale: input.options.scale,
      tagged: input.options.tagged,
      width: input.options.width,
    });

    return { bytes: new Uint8Array(bytes), renderer: this.name };
  }

  private async handleRoute(
    route: Route,
    input: PreparedPdfRenderInput,
    denied: DeniedResourceCollector
  ): Promise<void> {
    const url = route.request().url();
    const decision = evaluatePdfResource(url, input.baseUrl, input.resources);
    if (decision.allowed) {
      await route.continue();
      return;
    }

    recordDeniedResource(
      denied,
      sanitizePdfResourceUrl(url),
      decision.reason ?? 'denied'
    );
    await route.abort('blockedbyclient');
  }

  private async getBrowser(): Promise<Browser> {
    if (this.browser?.isConnected()) return this.browser;
    if (!this.launchPromise) this.launchPromise = this.launchBrowser();
    const pendingLaunch = this.launchPromise;
    try {
      const browser = await pendingLaunch;
      if (this.closed) {
        await browser.close().catch(() => undefined);
        throw new PdfError('The Chromium PDF renderer is closed.', 'PDF_SERVICE_CLOSED');
      }
      if (this.browser !== browser) {
        this.browser = browser;
        browser.on('disconnected', () => {
          if (this.browser === browser) this.browser = null;
        });
      }
      return browser;
    } finally {
      if (this.launchPromise === pendingLaunch) this.launchPromise = null;
    }
  }

  private async launchBrowser(): Promise<Browser> {
    try {
      const { chromium } = await loadPlaywright();
      return await chromium.launch({
        headless: this.config.headless,
        executablePath: this.config.executablePath,
        args: [...this.config.launchArgs],
        timeout: this.config.launchTimeoutMs,
      });
    } catch (error) {
      throw new PdfError(
        'Chromium could not start. Run `zero pdf install` or configure pdf.browser.executablePath.',
        'PDF_BROWSER_UNAVAILABLE',
        {},
        { cause: error }
      );
    }
  }
}

interface DeniedResourceCollector {
  count: number;
  resources: Array<{ url: string; reason: string }>;
  firstDenied: Promise<void>;
  notifyDenied: () => void;
}

function createDeniedResourceCollector(): DeniedResourceCollector {
  let notifyDenied = () => {};
  const firstDenied = new Promise<void>((resolve) => {
    notifyDenied = resolve;
  });
  return { count: 0, resources: [], firstDenied, notifyDenied };
}

function recordDeniedResource(
  collector: DeniedResourceCollector,
  url: string,
  reason: string
): void {
  collector.count += 1;
  if (collector.resources.length < 10) collector.resources.push({ url, reason });
  collector.notifyDenied();
}

function deniedResourceError(collector: DeniedResourceCollector): PdfError {
  return new PdfError(
    'PDF rendering blocked one or more document resources.',
    'PDF_RESOURCE_DENIED',
    { resources: collector.resources, deniedCount: collector.count }
  );
}

async function loadPlaywright(): Promise<typeof import('playwright')> {
  // Keep Playwright external in Bun server bundles. Chromium and provider
  // internals must be resolved from the deployed node_modules tree at runtime.
  const runtimePackage = ['play', 'wright'].join('');
  return import(runtimePackage) as Promise<typeof import('playwright')>;
}

function configurePageTimeouts(page: Page, timeoutMs: number): void {
  page.setDefaultTimeout(timeoutMs);
  page.setDefaultNavigationTimeout(timeoutMs);
}

async function closeBrowserContext(context: BrowserContext | null): Promise<void> {
  await context?.close().catch(() => undefined);
}

function normalizeRendererError(error: unknown, timeoutMs: number): PdfError {
  if (error instanceof PdfError) return error;
  if (error instanceof Error && /timeout/i.test(`${error.name} ${error.message}`)) {
    return new PdfError(
      `PDF rendering exceeded ${timeoutMs}ms.`,
      'PDF_RENDER_TIMEOUT',
      { timeoutMs },
      { cause: error }
    );
  }
  return new PdfError('Chromium failed to render the PDF.', 'PDF_RENDER_FAILED', {}, {
    cause: error,
  });
}

function renderTimeout(timeoutMs: number): PdfError {
  return new PdfError(
    `PDF rendering exceeded ${timeoutMs}ms.`,
    'PDF_RENDER_TIMEOUT',
    { timeoutMs }
  );
}

async function runWithTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  onTimeout: () => Promise<unknown>
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      void onTimeout();
      reject(renderTimeout(timeoutMs));
    }, timeoutMs);
  });

  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
