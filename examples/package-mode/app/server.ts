/**
 * server.ts
 *
 * App-owned server entry for a package-mode Zero app. This file should stay
 * small: import config, create the Zero app, and listen.
 */

import { createApp } from '@zero/framework/server';
import config from '../zero.config';

const app = await createApp(config);

app.listen(config.port);
