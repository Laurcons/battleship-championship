import { Logger } from '@nestjs/common';
import { createApp, serveWeb } from './bootstrap.js';
import { loadConfig } from './config.js';

const log = new Logger('process');
process.on('unhandledRejection', (reason) => log.error(`unhandled rejection: ${reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)}`));
process.on('uncaughtException', (error) => log.error(`uncaught exception: ${error.stack ?? error.message}`));

const config = loadConfig();
const app = await createApp({ config });
if (config.webDist) serveWeb(app, config.webDist);
await app.listen(config.port, config.host);
new Logger('main').log(`Listening on http://${config.host}:${config.port} (${config.databaseUrl ? 'MariaDB' : 'in-memory data'})`);
