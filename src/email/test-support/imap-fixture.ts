/** Small loopback IMAP fixture for real client protocol/IDLE tests, never a production server. */
import { createServer, type Socket } from 'node:net';
import MailComposer from 'nodemailer/lib/mail-composer';

interface TestMail { uid: number; flags: string[]; source: Buffer }
export async function imapFixture(options: { idle?: boolean; stall?: boolean } = {}) {
  const inbox: TestMail[] = [];
  for (const uid of [1, 3]) inbox.push({ uid, flags: [], source: await new MailComposer({
    from: 'Sender <sender@example.test>', to: 'receiver@example.test', subject: `Message ${uid}`, text: `Body ${uid}`,
    messageId: `<message-${uid}@example.test>`,
    attachments: [{ filename: 'sample.txt', content: Buffer.from('attachment bytes'), contentType: 'text/plain' }],
  }).compile().build() });
  const folders = new Map<string, TestMail[]>([['INBOX', inbox], ['Sent', []], ['Trash', []]]);
  const clients = new Set<{ socket: Socket; folder: string; idleTag?: string }>();
  let validity = 123, nextUid = 4, commands = 0, connections = 0, loginAttempts = 0;
  const capabilities = `IMAP4rev1 UIDPLUS MOVE${options.idle === false ? '' : ' IDLE'}`;
  const server = createServer(socket => {
    connections++;
    const client = { socket, folder: '' } as { socket: Socket; folder: string; idleTag?: string };
    clients.add(client); socket.on('error', () => {}); socket.on('close', () => clients.delete(client));
    if (options.stall) return;
    socket.write(`* OK [CAPABILITY ${capabilities}] Synthetic test server\r\n`);
    let buffer = Buffer.alloc(0);
    let literal: { tag: string; folder: string; length: number; flags: string[] } | undefined;
    const send = (tag: string, text = 'OK synthetic') => socket.write(`${tag} ${text}\r\n`);
    socket.on('data', chunk => {
      buffer = Buffer.concat([buffer, Buffer.from(chunk)]);
      while (buffer.length) {
        if (literal) {
          if (buffer.length < literal.length + 2) return;
          const list = folders.get(literal.folder) ?? []; const uid = nextUid++;
          list.push({ uid, flags: literal.flags, source: buffer.subarray(0, literal.length) }); folders.set(literal.folder, list);
          buffer = buffer.subarray(literal.length + 2); send(literal.tag, `OK [APPENDUID ${validity} ${uid}] appended`); literal = undefined; continue;
        }
        const end = buffer.indexOf('\r\n'); if (end < 0) return;
        const line = buffer.subarray(0, end).toString(); buffer = buffer.subarray(end + 2);
        if (line === 'DONE') { send(client.idleTag!); client.idleTag = undefined; continue; }
        const match = line.match(/^(\S+)\s+(\S+)(?:\s+(.*))?$/); if (!match) continue;
        const [, tag, rawCommand, rest = ''] = match;
        const command = rawCommand!.toUpperCase(); commands++;
        if (command === 'CAPABILITY') { socket.write(`* CAPABILITY ${capabilities}\r\n`); send(tag!); }
        else if (command === 'LOGIN') { loginAttempts++; send(tag!); }
        else if (command === 'NOOP') send(tag!);
        else if (command === 'LOGOUT') { socket.write('* BYE closing\r\n'); send(tag!); socket.end(); }
        else if (command === 'LIST' || command === 'LSUB') {
          if (rest === '"" ""') {
            socket.write('* ' + command + ' (\\Noselect) "/" ""\r\n'); send(tag!); continue;
          }
          for (const folder of folders.keys()) socket.write(`* ${command} (\\HasNoChildren${folder === 'Sent' ? ' \\Sent' : folder === 'Trash' ? ' \\Trash' : ''}) "/" "${folder}"\r\n`);
          send(tag!);
        } else if (command === 'EXAMINE' || command === 'SELECT') {
          client.folder = rest.replace(/\s+\(.*$/, '').replace(/^"|"$/g, '');
          const list = folders.get(client.folder);
          if (!list) { send(tag!, 'NO missing folder'); continue; }
          socket.write(`* FLAGS (\\Seen \\Flagged \\Answered)\r\n* ${list.length} EXISTS\r\n* 0 RECENT\r\n* OK [UIDVALIDITY ${validity}] stable\r\n* OK [UIDNEXT ${nextUid}] next\r\n`);
          send(tag!, `OK [${command === 'EXAMINE' ? 'READ-ONLY' : 'READ-WRITE'}] opened`);
        } else if (command === 'IDLE') { client.idleTag = tag; socket.write('+ idling\r\n'); }
        else if (command === 'APPEND') {
          const parsed = rest.match(/^(?:"([^"]+)"|(\S+)).*\{(\d+)\+?\}$/);
          if (!parsed) { send(tag!, 'BAD append'); continue; }
          if (!folders.has(parsed[1] ?? parsed[2]!)) { send(tag!, 'NO missing folder'); continue; }
          literal = { tag: tag!, folder: parsed[1] ?? parsed[2]!, length: Number(parsed[3]), flags: rest.match(/\(([^)]*)\)/)?.[1]?.split(/\s+/).filter(Boolean) ?? [] };
          if (!rest.endsWith('+}')) socket.write('+ send literal\r\n');
        } else if (command === 'UID') {
          const sub = rest.match(/^(FETCH|SEARCH|STORE|MOVE)\s+(.+)$/i);
          if (!sub) { send(tag!, 'BAD unknown UID operation'); continue; }
          const action = sub[1]!.toUpperCase(), args = sub[2]!;
          const list = folders.get(client.folder) ?? [];
          const range = args.match(/(?:^|\bUID\s+)(\d+(?::\d+)?)/i)?.[1] ?? '';
          const [low = 0, high = low] = range.split(':').map(Number);
          const selected = list.filter(item => item.uid >= low && item.uid <= high);
          if (action === 'SEARCH') { socket.write(`* SEARCH ${selected.map(item => item.uid).join(' ')}\r\n`); send(tag!); }
          else if (action === 'FETCH') {
            for (const mail of selected) {
              const seq = list.indexOf(mail) + 1;
              const partial = args.match(/<(\d+)\.(\d+)>/);
              if (/BODY(?:\.PEEK)?\[\]/i.test(args)) {
                const start = Number(partial?.[1] ?? 0), length = Number(partial?.[2] ?? mail.source.length);
                const bytes = mail.source.subarray(start, start + length);
                socket.write(`* ${seq} FETCH (UID ${mail.uid} RFC822.SIZE ${mail.source.length} BODY[]${partial ? `<${start}>` : ''} {${bytes.length}}\r\n`);
                socket.write(bytes); socket.write(')\r\n');
              } else {
                const sender = '(("Sender" NIL "sender" "example.test"))';
                const to = '((NIL NIL "receiver" "example.test"))';
                socket.write(`* ${seq} FETCH (UID ${mail.uid} FLAGS (${mail.flags.join(' ')}) RFC822.SIZE ${mail.source.length} INTERNALDATE "22-Oct-2026 12:00:00 +0000" ENVELOPE ("Thu, 22 Oct 2026 12:00:00 +0000" "Message ${mail.uid}" ${sender} NIL NIL ${to} NIL NIL NIL "<message-${mail.uid}@example.test>"))\r\n`);
              }
            }
            send(tag!);
          } else if (action === 'STORE') {
            const flags = args.match(/\(([^)]*)\)/)?.[1]?.split(/\s+/).filter(Boolean) ?? [];
            for (const mail of selected) {
              mail.flags = args.includes('+FLAGS') ? [...new Set([...mail.flags, ...flags])] : mail.flags.filter(flag => !flags.includes(flag));
              for (const target of clients) if (target.folder === client.folder) target.socket.write(`* ${list.indexOf(mail) + 1} FETCH (UID ${mail.uid} FLAGS (${mail.flags.join(' ')}))\r\n`);
            }
            send(tag!);
          } else if (action === 'MOVE') {
            const destination = args.replace(/^\S+\s+/, '').replace(/^"|"$/g, '');
            const target = folders.get(destination);
            if (!selected[0] || !target) { send(tag!, 'NO missing'); continue; }
            const moved = { ...selected[0], uid: nextUid++ }; target.push(moved); list.splice(list.indexOf(selected[0]), 1);
            send(tag!, `OK [COPYUID ${validity} ${selected[0].uid} ${moved.uid}] moved`);
          }
        } else send(tag!, 'BAD unsupported test command');
      }
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Expected loopback IMAP port');
  return { config: { host: '127.0.0.1', port: address.port, secure: false, requireTLS: false, auth: { user: 'user@example.test', pass: 'test-password' }, timeoutMs: 3000 },
    get commands() { return commands; }, get connections() { return connections; }, get openConnections() { return clients.size; }, get loginAttempts() { return loginAttempts; },
    async ready() { const until = performance.now() + 2000; while (![...clients].some(client => client.idleTag) && performance.now() < until) await Bun.sleep(5); if (![...clients].some(client => client.idleTag)) throw new Error('IDLE did not start'); },
    arrive() {
      inbox.push({ uid: nextUid++, flags: [], source: Buffer.from('Subject: New\r\n\r\nNew arrival') });
      for (const client of clients) if (client.folder === 'INBOX') client.socket.write(`* ${inbox.length} EXISTS\r\n`);
    },
    flags(uid: number) { for (const client of clients) if (client.folder === 'INBOX') client.socket.write(`* 1 FETCH (UID ${uid} FLAGS (\\Seen))\r\n`); },
    expunge() { inbox.shift(); for (const client of clients) if (client.folder === 'INBOX') client.socket.write('* 1 EXPUNGE\r\n'); },
    disconnect(reset = false) { if (reset) validity++; for (const client of clients) client.socket.destroy(); },
    async close() { for (const client of clients) client.socket.destroy(); await new Promise<void>(resolve => server.close(() => resolve())); },
  };
}
