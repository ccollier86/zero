/** Fresh installed package proof. No app config, provider, production data or live messaging backend. */
import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';

const scratch = '/Volumes/code-bank/tmp/scratch/zero-platform';
const evidence = '/Volumes/code-bank/artifacts/zero-platform/diagnostics/messaging-polish';

test('messaging installs from an archive, SSR-renders its real hook and browser-builds through public exports', async () => {
  await mkdir(scratch, { recursive: true });
  const root = await mkdtemp(join(scratch, 'messaging-package-'));
  const consumer = join(root, 'consumer');
  const archive = process.env.ZERO_MESSAGING_ARCHIVE ?? join(root, 'framework.tgz');
  try {
    await mkdir(consumer);
    if (!process.env.ZERO_MESSAGING_ARCHIVE) await checked(['pm', 'pack', '--ignore-scripts', '--filename', archive, '--quiet'], process.cwd());
    await Bun.write(join(consumer, 'package.json'), JSON.stringify({ name: 'zero-messaging-consumer', private: true, type: 'module', dependencies: {
      '@zero/framework': `file:${archive}`, react: '19.2.4', 'react-dom': '19.2.4',
      typescript: '^5.9.3', '@types/bun': '1.3.14', '@types/react': '^19.2.14', '@types/react-dom': '^19.2.3',
    } }));
    await Bun.write(join(consumer, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler',
      strict: true, skipLibCheck: true, esModuleInterop: true, jsx: 'react-jsx', types: ['bun'], lib: ['ES2022', 'DOM', 'DOM.Iterable'] }, include: ['consumer.tsx'] }));
    await Bun.write(join(consumer, 'consumer.tsx'), CONSUMER);
    await Bun.write(join(consumer, 'verify.ts'), VERIFY);
    await Bun.write(join(consumer, 'zero.config.ts'), "throw new Error('MESSAGING_PACKAGE_MUST_NOT_LOAD_APP_CONFIG');\n");
    await checked(['install', '--ignore-scripts'], consumer);
    await checked(['run', 'node_modules/typescript/bin/tsc', '--noEmit'], consumer);
    const result = JSON.parse((await checked(['verify.ts'], consumer)).trim());
    expect(result.browserBytes).toBeGreaterThan(0); expect(result.browserClean).toBe(true);
    expect(result.css).toBe(true); expect(result.publicAliases).toBe(true); expect(result.hookSsr).toBe(true);
    expect(result.html).toContain('Messaging workspace'); expect(result.html).toContain('Customer conversation');
    expect(result.html).toContain('aria-label="Message"'); expect(result.html).toContain('&lt;fixture text&gt;');
    expect(result.html).not.toContain('href='); expect(result.privatePathsRejected).toBe(4);
    const installed = join(consumer, 'node_modules/@zero/framework');
    for (const file of [
      'src/components/messaging/index.ts', 'src/components/messaging/messaging.css', 'src/components/messaging/use-conversation-typing.ts',
      'src/frontend/client/typing-indicator-hooks.ts', 'src/frontend/client/typing-indicator-model.ts',
      'src/sync/client/ephemeral-client.ts', 'src/sync/client/ephemeral-store.ts', 'src/sync/ephemeral-channel.ts',
      'docs-next/frontend/messaging/index.md', 'docs-next/backend/messaging/index.md',
    ]) expect(await Bun.file(join(installed, file)).text()).toBe(await Bun.file(join(process.cwd(), file)).text());
    expect([...new Bun.Glob('*.{db,sqlite,sqlite3}').scanSync({ cwd: consumer })]).toEqual([]);
    const commit = await git(['rev-parse', 'HEAD']), dirty = (await git(['status', '--porcelain'])).length > 0;
    await mkdir(evidence, { recursive: true });
    await Bun.write(join(evidence, 'installed-archive-evidence.json'), JSON.stringify({
      commit, dirty, archive, sha256: createHash('sha256').update(new Uint8Array(await Bun.file(archive).arrayBuffer())).digest('hex'),
      version: result.version, verifiedAt: new Date().toISOString(), ...result,
      scope: 'presentation and authorized room typing; durable chat backend is not implemented',
      configTripwireNotExecuted: true, liveProviderOperations: false,
    }, null, 2));
  } finally {
    // Only this newly allocated disposable consumer is removed. An explicitly supplied release archive is read-only.
    await rm(root, { recursive: true, force: true });
  }
}, 240_000);

async function checked(args: string[], cwd: string): Promise<string> {
  const child = Bun.spawn([process.execPath, '--no-env-file', ...args], { cwd, stdout: 'pipe', stderr: 'pipe',
    env: { PATH: process.env.PATH, TMPDIR: scratch, BUN_INSTALL_CACHE_DIR: '/Volumes/code-bank/caches/bun/install-cache' } });
  let expired = false;
  const timer = setTimeout(() => { expired = true; child.kill(); }, 180_000);
  try {
    const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    if (expired || code !== 0) throw new Error(`Messaging package consumer failed (${expired ? 'timeout' : code}):\n${stdout}\n${stderr}`);
    return stdout;
  } finally { clearTimeout(timer); }
}
async function git(args: string[]): Promise<string> {
  const child = Bun.spawn(['git', ...args], { cwd: process.cwd(), stdout: 'pipe', stderr: 'pipe' });
  const [stdout, code] = await Promise.all([new Response(child.stdout).text(), child.exited]);
  if (code) throw new Error('Cannot identify the qualified source checkout');
  return stdout.trim();
}

const CONSUMER = `
import * as React from 'react';
import * as Root from '@zero/framework';
import * as Frontend from '@zero/framework/react';
import * as Parts from '@zero/framework/messaging';
import * as Alias from '@zero/framework/components/messaging';
import type { UseConversationTypingReturn, MessageBubbleProps, MessageDeliveryIndicatorProps, ConversationAssistantActivityProps,
  MessagingComposerProps, MessagingAttachment, MessagingMessage } from '@zero/framework/messaging';
const names = ['MessagingLayout', 'ConversationList', 'ConversationListHeading', 'ConversationHeader', 'ConversationSeparator',
  'ConversationTypingIndicator', 'ConversationAssistantActivity', 'MessageBubble', 'MessageDeliveryIndicator', 'MessagingComposer',
  'useConversationTyping', 'conversationActivityLabel', 'conversationActivityMembers'] as const;
export const publicAliases = names.every(name => Parts[name] === Root[name] && Parts[name] === Frontend[name] && Parts[name] === Alias[name]);
export const message: MessagingMessage = { id: 'fixture-message', author: { id: 'fixture-user', kind: 'user', label: 'Customer' },
  text: '<fixture text>', createdAt: Date.UTC(2026, 9, 24, 12), delivery: 'accepted' };
const props: MessageBubbleProps = { message };
const delivery: MessageDeliveryIndicatorProps = { state: 'accepted' };
const assistant: ConversationAssistantActivityProps = { activity: null };
export let hookSsr = false;
function Input() {
  const typing: UseConversationTypingReturn = Parts.useConversationTyping('room-fixture');
  hookSsr = !typing.isTyping && !typing.isAnyoneTyping && typing.participants.length === 0 && typing.resetError() === false;
  const composer: MessagingComposerProps = { value: '', onChange() {}, onSubmit() {}, onTyping: typing.onTextChange };
  return <Parts.MessagingComposer {...composer} />;
}
export function Consumer() {
  return <Root.AppProvider url="https://fixture.invalid" tables={{}} auth>
    <Parts.MessagingLayout sidebar={<Parts.ConversationList conversations={[]} onSelect={() => {}} />}
      sidebarHeader={<Parts.ConversationListHeading title="Messages" />}
      header={<Parts.ConversationHeader participant={message.author} subtitle="Customer conversation" />}
      composer={<Input />}>
      <Parts.ConversationSeparator>Today</Parts.ConversationSeparator><Parts.MessageBubble {...props} />
      <Parts.MessageDeliveryIndicator {...delivery} /><Parts.ConversationAssistantActivity {...assistant} />
    </Parts.MessagingLayout>
  </Root.AppProvider>;
}
`;
const VERIFY = `
import * as React from 'react';
import { renderToString } from 'react-dom/server';
import manifest from '@zero/framework/package.json';
import { Consumer, publicAliases, hookSsr } from './consumer';
const html = renderToString(React.createElement(Consumer));
const built = await Bun.build({ entrypoints: ['./consumer.tsx'], target: 'browser', format: 'esm' });
if (!built.success) throw new Error(built.logs.map(log => log.message).join('\\n'));
const scripts = await Promise.all(built.outputs.filter(output => output.path.endsWith('.js')).map(output => output.text()));
const styles = await Promise.all(built.outputs.filter(output => output.path.endsWith('.css')).map(output => output.text()));
const browserClean = !/bun:sqlite|node:fs|nodemailer|imapflow|stripe-node/.test(scripts.join('\\n'));
let privatePathsRejected = 0;
for (const path of ['messaging/use-conversation-typing', 'messaging/messaging.browser-fixture', 'components/messaging/messaging.browser-fixture', 'components/messaging/messaging.package.test']) {
  try { Bun.resolveSync('@zero/framework/' + path, process.cwd()); } catch { privatePathsRejected++; }
}
console.log(JSON.stringify({ html, publicAliases, hookSsr, privatePathsRejected, version: manifest.version,
  browserClean, css: styles.join('\\n').includes('zero-messaging-layout'), browserBytes: built.outputs.reduce((n, output) => n + output.size, 0) }));
`;
