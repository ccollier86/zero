/** Loopback-only SMTP server. No provider accounts, external mail, or production secrets. */
import { SMTPServer, type SMTPServerOptions } from 'smtp-server';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

export async function smtpFixture(options: SMTPServerOptions = {}) {
  const messages: string[] = [];
  const server = new SMTPServer({
    logger: false, hideSTARTTLS: true, allowInsecureAuth: true,
    closeTimeout: 200, authOptional: false,
    onAuth(auth, _session, callback) {
      callback(auth.username === 'user@example.test' && auth.password === 'test-password'
        ? null : Object.assign(new Error('Synthetic authentication failure'), { responseCode: 535 }), { user: 'test-user' });
    },
    onData(stream, _session, callback) {
      const chunks: Buffer[] = [];
      stream.on('data', chunk => chunks.push(Buffer.from(chunk)));
      stream.on('end', () => { messages.push(Buffer.concat(chunks).toString()); callback(null, 'Synthetic message accepted'); });
    },
    ...options,
  });
  server.on('error', () => {});
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.server.address();
  if (!address || typeof address === 'string') throw new Error('Expected a loopback test port');
  return { server, messages, config: { host: '127.0.0.1', port: address.port, secure: false, requireTLS: false, auth: { user: 'user@example.test', pass: 'test-password' } },
    async close() { await new Promise<void>(resolve => server.close(resolve)); },
  };
}

export async function testCertificate() {
  const directory = await mkdtemp(join(Bun.env.PROJECT_SCRATCH_DIR ?? tmpdir(), 'zero-mail-tls-'));
  const key = join(directory, 'test.key'), cert = join(directory, 'test.crt');
  const child = Bun.spawn(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert,
    '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1'], { stdout: 'ignore', stderr: 'pipe' });
  const code = await child.exited;
  if (code) { await rm(directory, { recursive: true, force: true }); throw new Error('Could not create disposable TLS fixture'); }
  return { key: await readFile(key), cert: await readFile(cert), async close() { await rm(directory, { recursive: true, force: true }); } };
}

/** Real TLS SMTP peer, isolated from Bun's unsupported server-side raw TLSSocket wrapping. */
export async function tlsSmtpFixture(certificate: { key: Buffer; cert: Buffer }, secure: boolean) {
  const child = Bun.spawn(['node', new URL('./smtp-tls-server.mjs', import.meta.url).pathname], {
    stdin: 'pipe', stdout: 'pipe', stderr: 'ignore',
  });
  child.stdin.write(JSON.stringify({ key: certificate.key.toString(), cert: certificate.cert.toString(), secure }));
  child.stdin.end();
  const reader = child.stdout.getReader();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const value = await Promise.race([
      reader.read(),
      new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('TLS fixture did not start')), 5000); }),
    ]);
    if (value.done) throw new Error('TLS fixture exited before listening');
    const { port } = JSON.parse(new TextDecoder().decode(value.value)) as { port: number };
    return {
      config: { host: '127.0.0.1', port, secure, requireTLS: true, auth: { user: 'test-user', pass: 'test-password' }, timeoutMs: 3000 },
      async close() { child.kill('SIGTERM'); await child.exited; reader.releaseLock(); },
    };
  } catch (error) { child.kill(); await child.exited; reader.releaseLock(); throw error; }
  finally { clearTimeout(timer); }
}
