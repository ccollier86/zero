/** Safe browser-visible stream failures. They contain no server body, URL or message content. */
export class MessagingLiveError extends Error {
  readonly code: string;
  constructor(code: 'MESSAGING_LIVE_UNAVAILABLE' | 'MESSAGING_LIVE_INVALIDATED' | 'MESSAGING_LIVE_PROTOCOL' | 'MESSAGING_LIVE_OBSERVER',
    readonly retryable: boolean, readonly status?: number) {
    super(retryable ? 'Live messaging is temporarily unavailable.' : 'Live messaging must be revalidated.');
    this.name = 'MessagingLiveError'; this.code = code;
  }
}
export function messagingLiveHttpFailure(status: number): MessagingLiveError {
  return new MessagingLiveError('MESSAGING_LIVE_UNAVAILABLE', status === 408 || status === 429 || status >= 500, status);
}
