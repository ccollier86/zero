/** Dedicated logging child entry. Never starts an app, inherits credentials, or accepts another realm. */
import { runLoggingActorIfRequested } from './logging-actor-bootstrap';

try {
  if (!await runLoggingActorIfRequested()) process.exitCode = 64;
} catch {
  // The parent receives a safe protocol/startup failure; do not print paths or event bodies.
  process.exitCode = 70;
}
