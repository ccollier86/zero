// Node owns only the test server: smtp-server's raw TLSSocket wrapping is not Bun-compatible.
// Zero's production SMTP client still runs in Bun in every test.
import { SMTPServer } from 'smtp-server';

let input = '';
for await (const chunk of process.stdin) input += chunk;
const { key, cert, secure } = JSON.parse(input);
const server = new SMTPServer({
  secure, key, cert, logger: false, closeTimeout: 100,
  onAuth(_auth, _session, callback) { callback(null, { user: 'test-user' }); },
  onData(stream, _session, callback) { stream.resume(); stream.on('end', () => callback()); },
});
server.on('error', () => {});
server.listen(0, '127.0.0.1', () => {
  process.stdout.write(JSON.stringify({ port: server.server.address().port }) + '\n');
});
process.on('SIGTERM', () => server.close(() => process.exit(0)));
