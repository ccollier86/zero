/** Async token lookup and single-flight WebSocket reauthentication. */
import type { SyncClientConfig } from '../types';
type Token = string | null | undefined;
interface SyncSocketAuthInput {
  token?: string;
  getToken?: SyncClientConfig['getToken'];
  refreshAuth?: SyncClientConfig['refreshAuth'];
  stopped: () => boolean;
  socketActive: () => boolean;
  open: (token: Token) => void;
  recovered: () => void;
  failed: (message: string) => void;
}
export class SyncSocketAuthClient {
  private generation = 0;
  private connecting = false;
  private recovery: Promise<void> | null = null;
  constructor(private readonly input: SyncSocketAuthInput) {}
  connect(): void {
    if (this.input.stopped() || this.connecting || this.input.socketActive()) return;
    this.connecting = true;
    const generation = ++this.generation;
    let candidate: Token | Promise<Token>;
    try {
      candidate = this.input.getToken ? this.input.getToken() : this.input.token;
    } catch {
      this.failConnect(generation);
      return;
    }
    if (isPromiseLike(candidate)) {
      void Promise.resolve(candidate).then(
        (token) => this.open(generation, token),
        () => this.failConnect(generation),
      );
    } else this.open(generation, candidate);
  }
  cancel(): void {
    this.generation += 1;
    this.connecting = false;
  }
  recover(rejected: Token, event: Pick<CloseEvent, 'code' | 'reason'>): void {
    if (!this.input.refreshAuth && !this.input.getToken) {
      this.input.failed(authFailure(event));
      return;
    }
    if (this.recovery) return;
    const generation = ++this.generation;
    this.connecting = true;
    const operation = this.performRecovery(generation, rejected, event)
      .finally(() => { if (this.recovery === operation) this.recovery = null; });
    this.recovery = operation;
  }

  private async performRecovery(
    generation: number,
    rejected: Token,
    event: Pick<CloseEvent, 'code' | 'reason'>,
  ): Promise<void> {
    try {
      const token = await (this.input.refreshAuth
        ? this.input.refreshAuth()
        : this.input.getToken?.());
      if (!token || token === rejected) return this.failRecovery(generation, authFailure(event));
      if (!this.current(generation)) return;
      this.input.recovered();
      this.open(generation, token);
    } catch {
      this.failRecovery(generation, `Auth refresh failed (code ${event.code}): ${event.reason}`);
    }
  }

  private open(generation: number, token: Token): void {
    if (!this.current(generation)) return;
    this.connecting = false;
    this.input.open(token);
  }

  private failConnect(generation: number): void {
    this.failRecovery(generation, 'Auth token provider failed');
  }

  private failRecovery(generation: number, message: string): void {
    if (!this.current(generation)) return;
    this.connecting = false;
    this.input.failed(message);
  }

  private current(generation: number): boolean {
    return generation === this.generation && !this.input.stopped();
  }
}

function authFailure(event: Pick<CloseEvent, 'code' | 'reason'>): string {
  return `Auth failed (code ${event.code}): ${event.reason}`;
}

function isPromiseLike(value: unknown): value is PromiseLike<Token> {
  return Boolean(value) && typeof (value as PromiseLike<Token>).then === 'function';
}
