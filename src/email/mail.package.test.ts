/** Installed-archive proof: apps use public APIs without installing their own mail engines. */
import { expect, test } from 'bun:test';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { smtpFixture } from './test-support/smtp-fixture';
import { imapFixture } from './test-support/imap-fixture';

test('packed SMTP/IMAP facade resolves, typechecks and sends/receives from a fresh consumer', async () => {
  const scratch = Bun.env.PROJECT_SCRATCH_DIR ?? tmpdir();
  const root = await mkdtemp(join(scratch, 'zero-mail-package-'));
  const consumer = join(root, 'consumer'), archive = join(root, 'framework.tgz');
  const smtp = await smtpFixture(), imap = await imapFixture();
  try {
    await mkdir(consumer);
    await checked(['pm', 'pack', '--ignore-scripts', '--filename', archive], process.cwd());
    await Bun.write(join(consumer, 'package.json'), JSON.stringify({ name: 'zero-mail-proof', private: true, type: 'module',
      dependencies: { '@zero/framework': `file:${archive}`, typescript: '^5.7.0', '@types/bun': 'latest', '@types/react': '^19.2.14', '@types/react-dom': '^19.2.3' },
    }));
    await Bun.write(join(consumer, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'ESNext',
      moduleResolution: 'Bundler', strict: true, skipLibCheck: true, esModuleInterop: true, jsx: 'react-jsx', types: ['bun'] }, include: ['consumer.ts'] }));
    await Bun.write(join(consumer, 'consumer.ts'), CONSUMER);
    await checked(['install', '--ignore-scripts'], consumer);
    const installed = await Bun.file(join(consumer, 'node_modules/@zero/framework/package.json')).json();
    expect(installed.dependencies.nodemailer).toBe('10.2.1'); expect(installed.dependencies.imapflow).toBe('2.9.1');
    for (const file of ['smtp.md', 'mailbox.md']) expect(await Bun.file(join(consumer, 'node_modules/@zero/framework/docs-next/backend/email', file)).exists()).toBe(true);
    await checked(['run', 'node_modules/typescript/bin/tsc', '--noEmit'], consumer);
    const output = await checked(['consumer.ts'], consumer, { TEST_SMTP_PORT: String(smtp.config.port), TEST_IMAP_PORT: String(imap.config.port) });
    expect(output).toContain('[zero-mail-package] complete'); expect(smtp.messages).toHaveLength(1);
  } finally { await smtp.close(); await imap.close(); await rm(root, { recursive: true, force: true }); }
}, 180_000);

async function checked(args: string[], cwd: string, extra: Record<string, string> = {}): Promise<string> {
  const child = Bun.spawn([process.execPath, '--no-env-file', ...args], { cwd, stdout: 'pipe', stderr: 'pipe', env: {
    PATH: process.env.PATH, TMPDIR: Bun.env.PROJECT_SCRATCH_DIR ?? tmpdir(), BUN_INSTALL_CACHE_DIR: '/Volumes/code-bank/caches/bun/install-cache', ...extra,
  } });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; child.kill(); }, 120_000);
  try {
    const [stdout, stderr, status] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    if (status || timedOut) throw new Error(`Installed mail check failed (${timedOut ? 'timeout' : status}):\n${stdout}\n${stderr}`);
    return stdout;
  } finally { clearTimeout(timer); }
}

const CONSUMER = `
import { createEmailRuntime, emailFromEnv, SmtpEmailProvider, ImapMailbox, type MailMessageRef, type MailboxChange } from '@zero/framework/email';
import { SmtpEmailProvider as ServerSmtp, ImapMailbox as ServerImap } from '@zero/framework/server';

if (ServerSmtp !== SmtpEmailProvider || ServerImap !== ImapMailbox) throw new Error('Public server exports diverged');
const config = emailFromEnv({ EMAIL_PROVIDER: 'smtp', EMAIL_FROM: 'sender@example.test',
  SMTP_HOST: '127.0.0.1', SMTP_PORT: process.env.TEST_SMTP_PORT, SMTP_SECURE: 'false', SMTP_REQUIRE_TLS: 'false',
  SMTP_USER: 'user@example.test', SMTP_PASSWORD: 'test-password',
  IMAP_HOST: '127.0.0.1', IMAP_PORT: process.env.TEST_IMAP_PORT, IMAP_SECURE: 'false', IMAP_REQUIRE_TLS: 'false',
  IMAP_USER: 'user@example.test', IMAP_PASSWORD: 'test-password', IMAP_SENT_FOLDER: 'Sent',
});
const runtime = createEmailRuntime(config, {});
try {
  const receipt = await runtime.service.send({ to: 'recipient@example.test', subject: 'Packaged', text: 'Synthetic package proof' });
  if (receipt.provider !== 'smtp' || receipt.sentCopy !== 'saved') throw new Error('Send/copy failed');
  const mailbox = runtime.mailbox;
  if (!mailbox) throw new Error('Receiving was not configured');
  const page = await mailbox.list({ limit: 50 });
  const ref: MailMessageRef = page.messages[0]!;
  const read = await mailbox.read(ref);
  if (!read.text.includes('Body')) throw new Error('Read failed');
  const live = mailbox.watch()[Symbol.asyncIterator]();
  const first = await live.next(); const change: MailboxChange = first.value as MailboxChange;
  if (change.type !== 'resync') throw new Error('Live subscription failed');
  await live.return?.();
} finally { await runtime.close?.(); }
console.log('[zero-mail-package] complete');
`;
