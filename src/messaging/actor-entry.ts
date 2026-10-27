/** Dedicated source worker entry: no main app or inherited dotenv/provider environment. */
import { runMessagingActorIfRequested } from './actor-bootstrap';
try { if (!await runMessagingActorIfRequested()) process.exitCode = 64; } catch { process.exitCode = 70; }
