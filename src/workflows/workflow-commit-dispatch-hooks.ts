/** Lifecycle hooks for durable commands whose acknowledgement need not await workflow execution. */
export interface WorkflowCommitDispatchHooks {
  /** Assert live service/runtime ownership before admitting a command. */
  beginOperation(): void;
  /** Retained eager behavior: join the current execution frontier. */
  advance(instanceId: string): Promise<void>;
  /** Kick an owned frontier without awaiting activities; shutdown/recovery still own its durable run. */
  dispatch(instanceId: string): void;
}
