/** Explicit matching-package source launch, with no main-app bootstrap or inherited synthetic provider secret. */
import { runLoggingActorIfRequested } from '@zero/framework/server';
if (process.env.ZERO_SYNTHETIC_PROVIDER_SECRET || process.env.ZERO_SYNTHETIC_DOTENV_SECRET) throw new Error('Synthetic secret crossed the actor boundary.');
if (!await runLoggingActorIfRequested()) throw new Error('Synthetic actor was not requested.');
