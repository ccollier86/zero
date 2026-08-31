import { createSyncAuthMessage } from '../sync-auth-message';

type Token = string | null | undefined;
const MAX_BUFFERED_BYTES = 1_048_576;
interface SyncSocketConnectionInput {
  url: string;
  message: (socket: WebSocket, event: MessageEvent) => void;
  closed: (token: Token, event: CloseEvent) => void;
}

/** Owns the active WebSocket and its pre-authenticated transport lifecycle. */
export class SyncSocketConnection {
  private socket: WebSocket | null = null;
  private ready = false;
  constructor(private readonly input: SyncSocketConnectionInput) {}

  get active(): boolean {
    return Boolean(this.socket && (
      this.socket.readyState === WebSocket.CONNECTING ||
      this.socket.readyState === WebSocket.OPEN
    ));
  }

  isAuthenticated(socket: WebSocket): boolean {
    return this.socket === socket && this.ready;
  }

  open(token: Token): void {
    this.ready = false;
    const socket = new WebSocket(this.input.url);
    this.socket = socket;
    socket.onopen = () => {
      socket.send(JSON.stringify(createSyncAuthMessage(token)));
    };
    socket.onmessage = (event) => this.input.message(socket, event);
    socket.onclose = (event) => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.ready = false;
      this.input.closed(token, event);
    };
    socket.onerror = () => {};
  }

  authenticate(socket: WebSocket): boolean {
    if (this.socket !== socket || this.ready) return false;
    this.ready = true;
    return true;
  }

  send(message: string): boolean {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN || !this.ready) {
      return false;
    }
    if (this.socket.bufferedAmount > MAX_BUFFERED_BYTES) {
      this.socket.close(1013, 'Client send backpressure');
      return false;
    }
    try {
      this.socket.send(message);
      return true;
    } catch {
      this.socket.close(1013, 'Client send failed');
      return false;
    }
  }

  close(reason: string): void {
    const current = this.socket;
    this.socket = null;
    this.ready = false;
    if (!current) return;
    current.onclose = null;
    current.close(1000, reason);
  }
}
