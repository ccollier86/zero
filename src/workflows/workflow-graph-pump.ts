/** Lossless per-instance trigger coalescing for graph workflows. */

export class WorkflowGraphPump {
  private readonly pumps = new Map<string, Promise<void>>();
  private readonly kickVersions = new Map<string, number>();
  private stopped = false;

  constructor(private readonly drive: (instanceId: string) => Promise<void>) {}

  /**
   * Coalesce work for one instance without losing a trigger that arrives at
   * the boundary between the final version check and mapped-promise cleanup.
   */
  async advance(instanceId: string): Promise<void> {
    if (this.stopped) return;
    this.kickVersions.set(instanceId, (this.kickVersions.get(instanceId) ?? 0) + 1);
    const existing = this.pumps.get(instanceId);
    if (existing) {
      await existing;
      const successor = this.pumps.get(instanceId);
      if (successor) return successor;
      if (!this.stopped) return this.advance(instanceId);
      return;
    }

    let pump!: Promise<void>;
    pump = this.run(instanceId).finally(() => {
      if (this.pumps.get(instanceId) === pump) this.pumps.delete(instanceId);
      this.kickVersions.delete(instanceId);
    });
    this.pumps.set(instanceId, pump);
    return pump;
  }

  stop(): void {
    this.stopped = true;
  }

  async drain(): Promise<void> {
    await Promise.allSettled(this.pumps.values());
    this.pumps.clear();
    this.kickVersions.clear();
  }

  private async run(instanceId: string): Promise<void> {
    let observedVersion: number;
    do {
      observedVersion = this.kickVersions.get(instanceId) ?? 0;
      await this.drive(instanceId);
    } while (!this.stopped
      && (this.kickVersions.get(instanceId) ?? 0) !== observedVersion);
  }
}
