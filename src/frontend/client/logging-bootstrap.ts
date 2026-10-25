/** The fixed, empty, same-origin cookie recovery ceremony; no general protected request bypass. */
import { LOGGING_API } from '../../logging/logging-api-contracts';
import type { LoggingAdmissionReceipt } from '../../logging/logging-admission-contracts';

export async function bootstrapLoggingDelivery(policyVersion: string, signal: AbortSignal): Promise<LoggingAdmissionReceipt> {
  if (!policyVersion || policyVersion.length > 100) throw new Error('The server audit policy is unavailable.');
  const response = await fetch(LOGGING_API + '/observations', { method: 'POST', credentials: 'same-origin', signal,
    headers: { 'Content-Type': 'application/json', 'X-Zero-Logging-Recovery': '1' }, body: JSON.stringify({ observations: [], policyVersion }) });
  if (!response.ok) throw new Error('Audit recovery is unavailable.');
  const result = await response.json();
  if (signal.aborted || result?.accepted !== 0 || result.admission?.policyVersion !== policyVersion
    || !Number.isSafeInteger(result.admission.expiresAt) || result.admission.expiresAt <= Date.now() || result.admission.expiresAt > Date.now() + 120000) {
    throw new Error('Audit recovery was not acknowledged.');
  }
  return Object.freeze({ policyVersion, expiresAt: result.admission.expiresAt });
}
