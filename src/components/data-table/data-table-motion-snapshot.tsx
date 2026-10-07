/** React commit bridge for FLIP: capture old transformed geometry before mutations, play only after refs commit. */
'use client';
import * as React from 'react';
import type { DataTableMotionSnapshot } from './data-table-motion-player';

export interface DataTableMotionSnapshotBridgeProps {
  readonly frameKey: number;
  readonly capture: () => DataTableMotionSnapshot | null;
  readonly commit: (snapshot: DataTableMotionSnapshot | null) => void;
  readonly children: React.ReactNode;
}
/** The bridge renders no DOM and never clones, moves or removes a React-owned row. */
export class DataTableMotionSnapshotBridge extends React.Component<DataTableMotionSnapshotBridgeProps> {
  getSnapshotBeforeUpdate(previous: DataTableMotionSnapshotBridgeProps) {
    return previous.frameKey !== this.props.frameKey ? this.props.capture() : null;
  }
  componentDidMount() { this.props.commit(null); }
  componentDidUpdate(previous: DataTableMotionSnapshotBridgeProps, _state: unknown, snapshot: DataTableMotionSnapshot | null) {
    if (previous.frameKey !== this.props.frameKey) this.props.commit(snapshot);
  }
  render() { return this.props.children; }
}
