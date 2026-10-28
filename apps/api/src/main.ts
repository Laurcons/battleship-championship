import { Logger } from '@nestjs/common';
import { createApp, serveWeb } from './bootstrap.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const app = await createApp({ config });
if (config.webDist) serveWeb(app, config.webDist);
await app.listen(config.port, config.host);
new Logger('main').log(`Listening on http://${config.host}:${config.port} (${config.databaseUrl ? 'MariaDB' : 'in-memory data'})`);
