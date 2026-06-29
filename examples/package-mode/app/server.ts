/**
 * server.ts
 *
 * App-owned server entry for the package-mode fixture. This file should stay
 * small: import config, create the Zero app, and listen.
 */

import { createApp } from '@zero/framework/server';
import config from '../zero.config';

const app = await createApp(config);

app.listen(config.port);

console.log(`Zero fixture listening on http://localhost:${config.port}`);
