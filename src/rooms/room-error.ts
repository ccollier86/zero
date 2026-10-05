/** Stable room domain input failures, independent of HTTP transport/authentication. */
export class RoomInputError extends Error {
  readonly code = 'ROOM_INPUT_INVALID';
  readonly status = 400;

  /** Report an application-safe room invariant rejection before persistence. */
  constructor(message: string) {
    super(message);
    this.name = 'RoomInputError';
  }
}
