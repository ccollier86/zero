/** Establish real source-created schema/identities/messages/private bytes before the official bundle boots. */
import { createApp } from '@zero/framework/server';
import config from './zero.config';
import { request, acknowledge, upload, PASSWORD } from './transport';
const app = await createApp(config); app.listen({ hostname: '127.0.0.1', port: 4111 }); const origin = 'http://127.0.0.1:4111';
try {
  const admin = await request(origin, '/auth/register', undefined, { username: 'installed-admin', email: 'installed-admin@example.test', password: PASSWORD });
  const peer = await request(origin, '/auth/register', undefined, { username: 'installed-peer', email: 'installed-peer@example.test', password: PASSWORD });
  await acknowledge(origin, admin.accessToken); await acknowledge(origin, peer.accessToken);
  const conversation = await request(origin, '/api/messaging/conversations', admin.accessToken, { userIds: [peer.user.userId] }, 'installed-source-open');
  const file = await upload(origin, admin.accessToken, conversation.id);
  const body = { text: 'Synthetic source-created retained message', attachmentIds: [file.id] };
  const message = await request(origin, '/api/messaging/conversations/' + conversation.id + '/messages', admin.accessToken, body, 'installed-source-send');
  // Contains only disposable credentials. It is never copied into the report or source archive.
  await Bun.write('./seed.json', JSON.stringify({ admin, peer, conversation, file, body, message }));
  console.log(JSON.stringify({ sourcePrepared: true, nativePrivateFile: true }));
} finally { await app.stop(true); }
