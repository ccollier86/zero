/** Private source launch for Blog Fabric workers. This entry cannot boot an application. */
import { runBlogActorIfRequested } from './content-actor-bootstrap';
try { if (!await runBlogActorIfRequested()) process.exitCode = 64; }
catch { process.exitCode = 70; }
