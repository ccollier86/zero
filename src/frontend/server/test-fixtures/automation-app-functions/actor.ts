/** Real Bun actor entry point for the app-function trigger integration fixture. */
import { runDatabaseActorIfRequested } from '../../../server';
import { appFunctionRealm } from './realm';

process.exitCode = await runDatabaseActorIfRequested({ realm: appFunctionRealm }) ? 0 : 65;
