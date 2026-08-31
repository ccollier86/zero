/** System-browser OIDC authorization with cold-start callback continuation. */

import { NativeAuthorizationCompletion } from './authorization-completion';
import type { NativeAuthorizationContext } from './authorization-context';
import { NativeAuthorizationRun } from './authorization-run';
import type { NativeSignInOptions, NativeSignUpOptions } from './client-types';
import { NativeAuthError, toNativeAuthError } from './errors';
import { isSupersededOperation, supersededOperation } from './lifecycle';

export class NativeAuthorizationFlow {
  private active: NativeAuthorizationRun | null = null;
  private readonly completion: NativeAuthorizationCompletion;

  constructor(private readonly input: NativeAuthorizationContext) {
    this.completion = new NativeAuthorizationCompletion(input);
  }

  signIn(options: NativeSignInOptions = {}, generation?: number): Promise<void> {
    return this.begin('signIn', options, generation);
  }

  signUp(options: NativeSignUpOptions = {}, generation?: number): Promise<void> {
    return this.begin('signUp', options, generation);
  }

  async completeAuthorization(
    callbackUrl: string,
    signal?: AbortSignal,
    generation = this.input.lifecycle.capture(),
  ): Promise<void> {
    if (this.completion.isCompleted()) return;
    this.input.lifecycle.assertCurrent(generation);
    this.input.state.setAuthorizing();
    try {
      await this.completion.run(callbackUrl, signal, generation);
    } catch (error) {
      throw this.report(error, generation);
    }
  }

  cancel(): void {
    this.active?.cancel();
  }

  private async begin(
    action: 'signIn' | 'signUp',
    options: NativeSignInOptions | NativeSignUpOptions,
    startedGeneration?: number,
  ): Promise<void> {
    if (this.active) {
      throw new NativeAuthError('Authorization is already active.', 'OIDC_IN_PROGRESS');
    }
    const generation = startedGeneration ?? this.input.lifecycle.capture();
    this.input.lifecycle.assertCurrent(generation);
    this.completion.resetCompleted();
    this.input.state.setAuthorizing();
    const run = new NativeAuthorizationRun(
      this.input, this.completion, generation, action, options,
    );
    this.active = run;
    try {
      await run.execute();
    } catch (error) {
      throw this.report(error, generation);
    } finally {
      if (this.active === run) this.active = null;
    }
  }

  private report(error: unknown, generation: number): NativeAuthError {
    const superseded = isSupersededOperation(error)
      || !this.input.lifecycle.isCurrent(generation);
    const authError = superseded
      ? supersededOperation()
      : toNativeAuthError(error, 'OIDC_AUTHORIZATION_FAILED');
    if (!superseded) this.input.state.setError(authError);
    return authError;
  }
}
