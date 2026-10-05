/** Synthetic deferred OTP callbacks: no account, transport or actual code. */

import React from 'react';
import { createRoot } from 'react-dom/client';
import { OTPVerification } from './otp-verification';

type Pending = { resolve(): void; reject(error: Error): void };
const state = { verified: [] as string[], resent: 0, pending: [] as Pending[] };
function defer(): Promise<void> {
  return new Promise((resolve, reject) => state.pending.push({ resolve, reject }));
}
const root = createRoot(document.getElementById('root')!);
root.render(<OTPVerification destination="synthetic@example.test" resendCooldown={2}
  onVerify={async (code) => { state.verified.push(code); await defer(); }}
  onResend={async () => { state.resent++; await defer(); }} />);

Object.assign(window, { otpTest: {
  snapshot: () => ({ verified: [...state.verified], resent: state.resent }),
  resolve: () => state.pending.shift()?.resolve(),
  reject: () => state.pending.shift()?.reject(new Error('Synthetic rejection')),
  unmount: () => root.unmount(),
} });
