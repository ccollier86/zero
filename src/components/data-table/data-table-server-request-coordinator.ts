/** Per-table abort and response-order boundary for server queries. */

export interface DataTableServerRequestTicket {
  readonly id: number;
  readonly boundaryKey: string;
  readonly queryKey: string;
  readonly signal: AbortSignal;
}

export class DataTableServerRequestCoordinator {
  private revision = 0;
  private active: {
    ticket: DataTableServerRequestTicket;
    controller: AbortController;
  } | null = null;

  begin(boundaryKey: string, queryKey: string): DataTableServerRequestTicket {
    this.cancel();
    const controller = new AbortController();
    const ticket = Object.freeze({
      id: this.revision,
      boundaryKey,
      queryKey,
      signal: controller.signal,
    });
    this.active = { ticket, controller };
    return ticket;
  }

  isCurrent(
    ticket: DataTableServerRequestTicket,
    boundaryKey: string,
    ready: boolean,
  ): boolean {
    return ready
      && !ticket.signal.aborted
      && this.active?.ticket.id === ticket.id
      && ticket.boundaryKey === boundaryKey;
  }

  finish(ticket: DataTableServerRequestTicket): void {
    if (this.active?.ticket.id === ticket.id) this.active = null;
  }

  cancel(): void {
    this.revision += 1;
    this.active?.controller.abort();
    this.active = null;
  }
}
