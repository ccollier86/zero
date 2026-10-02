/** Browser-safe contract shared by the Torrent proof registration and UI. */

export const TORRENT_PROOF_WORKFLOW = 'proof.task-review';
export const TORRENT_PROOF_RESPONSE_EVENT = 'proof.task-review.responded';

export interface TorrentProofInput {
  readonly taskId: string;
  readonly title: string;
}

export interface TorrentProofResponse {
  readonly approved: boolean;
}
