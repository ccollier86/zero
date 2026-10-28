/** Opt-in workstation qualification with real focus/visibility, not Playwright's default focus override. */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, type Browser, type ConnectOverCDPTransport } from 'playwright';
const scratch = '/Volumes/code-bank/tmp/scratch/zero-platform';

export async function launchNativeWindowBrowser() {
  const profile = await mkdtemp(join(scratch, 'native-window-browser-'));
  const child = Bun.spawn([chromium.executablePath(), '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0',
    '--user-data-dir=' + profile, '--disk-cache-dir=' + join(profile, 'cache'), '--no-first-run', '--no-default-browser-check',
    '--disable-background-networking', '--disable-component-update', '--disable-extensions', '--disable-sync', '--disable-default-apps',
    '--disable-crash-reporter', '--password-store=basic', '--use-mock-keychain', 'about:blank'],
  { stdout: 'ignore', stderr: 'ignore', env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: scratch } });
  let browser: Browser | undefined, socket: WebSocket | undefined;
  const close = async () => {
    try { await browser?.close(); } finally {
      socket?.close(); child.kill('SIGTERM'); const timer = setTimeout(() => child.kill('SIGKILL'), 2000);
      try { await child.exited; } finally { clearTimeout(timer); await rm(profile, { recursive: true, force: true }); }
    }
  };
  try {
    const deadline = Date.now() + 20000;
    let endpoint = '';
    while (!endpoint) {
      if (child.exitCode !== null || Date.now() >= deadline) throw new Error('Synthetic native-window Chromium did not become ready.');
      const candidate = await readFile(join(profile, 'DevToolsActivePort'), 'utf8').catch(() => '');
      const [first = '', path = ''] = candidate.split('\n');
      if (/^[0-9]+$/.test(first) && Number(first) > 0 && Number(first) <= 65535 && /^\/devtools\/browser\/[a-f0-9-]+$/.test(path)) endpoint = 'ws://127.0.0.1:' + first + path;
      else await new Promise(resolve => setTimeout(resolve, 50));
    }
    // This public option applies only to the existing default context. Calling
    // browser.newContext() would enable focus emulation again. Disabling it in
    // a second CDP session does not retire Playwright's own emulation session.
    // Use the public transport adapter with Bun's native WebSocket for this
    // separate CDP attachment. The browser protocol and page APIs are unchanged.
    socket = new WebSocket(endpoint);
    const nativeSocket = socket;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { nativeSocket.close(); reject(new Error('Synthetic native-window CDP socket timed out.')); }, 10000);
      nativeSocket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      nativeSocket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('Synthetic native-window CDP socket failed.')); }, { once: true });
    });
    const transport: ConnectOverCDPTransport = { send: message => nativeSocket.send(JSON.stringify(message)), close: () => nativeSocket.close() };
    nativeSocket.addEventListener('message', event => { if (typeof event.data === 'string') transport.onmessage?.(JSON.parse(event.data)); });
    nativeSocket.addEventListener('close', () => transport.onclose?.());
    browser = await chromium.connectOverCDP(transport, { noDefaults: true, isLocal: true, timeout: 20000 });
    const context = browser.contexts()[0];
    if (!context) throw new Error('Synthetic native-window Chromium has no default context.');
    return { browser, context, close };
  } catch (error) { await close(); throw error; }
}
