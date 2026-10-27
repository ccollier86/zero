/** Disposable native websocket peer. Only synthetic test credentials; bounded owned waits and socket cleanup. */
import type { ServerMessage } from '../../sync/types';
export async function messagingTypingSocket(origin: string, token: string) {
  const socket = new WebSocket(origin.replace(/^http/, 'ws') + '/sync'), messages: ServerMessage[] = [];
  socket.addEventListener('message', event => { if (typeof event.data === 'string') messages.push(JSON.parse(event.data)); });
  const wait = async (predicate: (message: ServerMessage) => boolean) => {
    const until = Date.now() + 4000;
    while (Date.now() < until) { const value = messages.find(predicate); if (value) return value; await Bun.sleep(5); }
    throw new Error('Synthetic messaging typing socket did not reach its expected protocol stage.');
  };
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Synthetic typing socket did not connect.')), 4000);
    socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
    socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('Synthetic typing socket connection failed.')); }, { once: true });
  });
  socket.send(JSON.stringify({ type: 'sync.auth', token }));
  try { await wait(message => message.type === 'sync.auth.ready'); } catch (error) { socket.close(); throw error; }
  return { messages, wait, send: (value: object) => socket.send(JSON.stringify(value)), async close() {
    if (socket.readyState === WebSocket.CLOSED) return;
    await new Promise<void>(resolve => { const timer = setTimeout(resolve, 1000); socket.addEventListener('close', () => { clearTimeout(timer); resolve(); }, { once: true }); socket.close(); });
  } };
}
